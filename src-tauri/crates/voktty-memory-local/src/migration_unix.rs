use super::{open_at, same_file, Directory};
use crate::publication::Migration;
use crate::{
    MemoryReadAccess, MemoryWriteAccess, PublicationError, ReadControl, ReadError, RecoveryFile,
};
use std::collections::BTreeMap;
use std::ffi::{CString, OsStr};
use std::fs::{self, File};
use std::io::{self, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileExt, MetadataExt, PermissionsExt};
use std::path::{Component, Path};

const MAX_TEXT: usize = 256 * 1024;
const MAX_ATTRIBUTES: usize = 64 * 1024;
type Attributes = BTreeMap<Vec<u8>, Vec<u8>>;

fn checked_text(
    file: &File,
    control: &ReadControl,
) -> Result<(String, fs::Metadata), PublicationError> {
    control.check()?;
    let before = file.metadata().map_err(|_| PublicationError::Io)?;
    if !before.is_file() || before.nlink() != 1 || before.len() > MAX_TEXT as u64 {
        return Err(ReadError::Unavailable.into());
    }
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 8192];
    while bytes.len() <= MAX_TEXT {
        control.check()?;
        let limit = (MAX_TEXT + 1 - bytes.len()).min(buffer.len());
        let n = file
            .read_at(&mut buffer[..limit], bytes.len() as u64)
            .map_err(|_| PublicationError::Io)?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..n]);
    }
    let after = file.metadata().map_err(|_| PublicationError::Io)?;
    if bytes.len() > MAX_TEXT || !same_file(&before, &after) {
        return Err(PublicationError::Conflict);
    }
    let text = String::from_utf8(bytes).map_err(|_| PublicationError::Conflict)?;
    if text.contains('\0') {
        return Err(PublicationError::Conflict);
    }
    control.check()?;
    Ok((text, after))
}

fn attributes(file: &File, control: &ReadControl) -> Result<Attributes, PublicationError> {
    control.check()?;
    let mut names = vec![0u8; MAX_ATTRIBUTES + 1];
    let n = unsafe { libc::flistxattr(file.as_raw_fd(), names.as_mut_ptr().cast(), names.len()) };
    if n < 0 || n as usize > MAX_ATTRIBUTES {
        return Err(ReadError::Unsupported.into());
    }
    names.truncate(n as usize);
    if !names.is_empty() && names.last() != Some(&0) {
        return Err(PublicationError::Conflict);
    }
    let mut values = vec![0u8; MAX_ATTRIBUTES + 1];
    let mut total = names.len();
    let mut result = BTreeMap::new();
    for name in names
        .split(|byte| *byte == 0)
        .filter(|name| !name.is_empty())
    {
        control.check()?;
        if name.len() > 255 || result.len() >= 128 || name == b"security.capability" {
            return Err(ReadError::Unsupported.into());
        }
        let c_name = CString::new(name).map_err(|_| PublicationError::Conflict)?;
        let n = unsafe {
            libc::fgetxattr(
                file.as_raw_fd(),
                c_name.as_ptr(),
                values.as_mut_ptr().cast(),
                values.len(),
            )
        };
        if n < 0 {
            return Err(PublicationError::Conflict);
        }
        total = total
            .checked_add(n as usize)
            .filter(|total| *total <= MAX_ATTRIBUTES)
            .ok_or(ReadError::Limit)?;
        if result
            .insert(name.to_vec(), values[..n as usize].to_vec())
            .is_some()
        {
            return Err(PublicationError::Conflict);
        }
    }
    Ok(result)
}

fn copy_metadata(
    source: &fs::Metadata,
    attrs: &Attributes,
    staging: &File,
    control: &ReadControl,
) -> Result<(), PublicationError> {
    if source.mode() & 0o7000 != 0 {
        return Err(ReadError::Unsupported.into());
    }
    control.check()?;
    if unsafe { libc::fchown(staging.as_raw_fd(), source.uid(), source.gid()) } != 0 {
        return Err(ReadError::Denied.into());
    }
    for name in attributes(staging, control)?
        .keys()
        .filter(|name| !attrs.contains_key(*name))
    {
        control.check()?;
        let name = CString::new(name.clone()).map_err(|_| PublicationError::Conflict)?;
        if unsafe { libc::fremovexattr(staging.as_raw_fd(), name.as_ptr()) } != 0 {
            return Err(ReadError::Denied.into());
        }
    }
    for (name, value) in attrs {
        control.check()?;
        let name = CString::new(name.clone()).map_err(|_| PublicationError::Conflict)?;
        if unsafe {
            libc::fsetxattr(
                staging.as_raw_fd(),
                name.as_ptr(),
                value.as_ptr().cast(),
                value.len(),
                0,
            )
        } != 0
        {
            return Err(ReadError::Denied.into());
        }
    }
    staging
        .set_permissions(fs::Permissions::from_mode(source.mode() & 0o777))
        .map_err(|_| PublicationError::Io)?;
    if attributes(staging, control)? != *attrs {
        return Err(PublicationError::Conflict);
    }
    Ok(())
}

fn entry_is(parent: &File, name: &CString, owned: &fs::Metadata) -> bool {
    let mut actual = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe {
        libc::fstatat(
            parent.as_raw_fd(),
            name.as_ptr(),
            actual.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        return false;
    }
    let actual = unsafe { actual.assume_init() };
    // libc stat field widths vary between supported Unix architectures.
    #[allow(clippy::unnecessary_cast)]
    {
        actual.st_dev as u64 == owned.dev() && actual.st_ino as u64 == owned.ino()
    }
}

struct Staging<'a> {
    parent: &'a File,
    name: CString,
    file: File,
    swapped: bool,
}
impl Drop for Staging<'_> {
    fn drop(&mut self) {
        if self.swapped {
            return;
        }
        let Ok(ours) = self.file.metadata() else {
            return;
        };
        if entry_is(self.parent, &self.name, &ours) {
            unsafe { libc::unlinkat(self.parent.as_raw_fd(), self.name.as_ptr(), 0) };
        }
    }
}

impl Directory {
    fn migration_parent(
        &self,
        root: &Path,
        relative: &str,
        reads: &dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<(File, std::path::PathBuf, CString), PublicationError> {
        let parts: Vec<_> = Path::new(relative).components().collect();
        if parts.is_empty()
            || parts.len() > 2
            || parts.iter().any(|p| !matches!(p, Component::Normal(_)))
        {
            return Err(ReadError::InvalidInput.into());
        }
        let mut parent = self.file.try_clone().map_err(|_| PublicationError::Io)?;
        let mut path = root.to_path_buf();
        for part in &parts[..parts.len() - 1] {
            let Component::Normal(name) = part else {
                return Err(ReadError::InvalidInput.into());
            };
            path.push(name);
            control.check()?;
            if !reads.allows_metadata(&path) {
                return Err(ReadError::Denied.into());
            }
            parent = open_at(&parent, name, true).map_err(|_| ReadError::StaleRoot)?;
        }
        if parent.metadata().map_err(|_| PublicationError::Io)?.dev() != self.metadata.dev() {
            return Err(ReadError::Unsupported.into());
        }
        let Component::Normal(name) = parts[parts.len() - 1] else {
            return Err(ReadError::InvalidInput.into());
        };
        let name = CString::new(name.as_bytes()).map_err(|_| ReadError::InvalidInput)?;
        Ok((parent, path, name))
    }

    fn revalidate_parent(
        &self,
        root: &Path,
        parent: &File,
        path: &Path,
        reads: &dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<(), PublicationError> {
        if !reads.allows_metadata(root) || !reads.allows_metadata(path) {
            return Err(ReadError::Denied.into());
        }
        let held = parent.metadata().map_err(|_| PublicationError::Io)?;
        if Self::open_root(root, control)?.identity() != self.identity()
            || Self::open_root(path, control)?.identity() != (held.dev(), held.ino().into())
        {
            return Err(ReadError::StaleRoot.into());
        }
        Ok(())
    }

    pub(crate) fn replace_text(
        &self,
        root: &Path,
        migration: &Migration<'_>,
        reads: &dyn MemoryReadAccess,
        writes: &dyn MemoryWriteAccess,
        control: &ReadControl,
    ) -> Result<(), PublicationError> {
        let Migration {
            path,
            expected,
            proposed,
            backup,
        } = *migration;
        if !matches!(path, ".voktty/.gitignore" | "AGENTS.md" | "CLAUDE.md")
            || expected.len() > MAX_TEXT
            || proposed.len() > MAX_TEXT
            || Path::new(path).parent() != Path::new(backup).parent()
        {
            return Err(ReadError::InvalidInput.into());
        }
        let target_path = root.join(path);
        let backup_path = root.join(backup);
        if !writes.allows_replace(&target_path)
            || !writes.allows_create(&backup_path)
            || !writes.allows_remove_staging(&backup_path)
            || !reads.allows_read(&target_path)
            || !reads.allows_read(&backup_path)
            || !reads.allows_metadata(&target_path)
            || !reads.allows_metadata(&backup_path)
        {
            return Err(ReadError::Denied.into());
        }
        let (parent, parent_path, target_name) =
            self.migration_parent(root, path, reads, control)?;
        let original = open_at(&parent, OsStr::from_bytes(target_name.as_bytes()), false)
            .map_err(|_| PublicationError::Conflict)?;
        let (text, before) = checked_text(&original, control)?;
        if text != expected {
            return Err(PublicationError::Conflict);
        }
        let attrs = attributes(&original, control)?;
        let backup_name = Path::new(backup)
            .file_name()
            .ok_or(ReadError::InvalidInput)?;
        let backup_name =
            CString::new(backup_name.as_bytes()).map_err(|_| ReadError::InvalidInput)?;
        control.check()?;
        let raw = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                backup_name.as_ptr(),
                libc::O_RDWR
                    | libc::O_CREAT
                    | libc::O_EXCL
                    | libc::O_NOFOLLOW
                    | libc::O_CLOEXEC
                    | libc::O_NONBLOCK,
                0o600,
            )
        };
        if raw < 0 {
            return Err(PublicationError::RecoveryRequired(vec![backup.into()]));
        }
        let mut staging = Staging {
            parent: &parent,
            name: backup_name,
            file: unsafe { File::from_raw_fd(raw) },
            swapped: false,
        };
        staging
            .file
            .write_all(proposed.as_bytes())
            .map_err(|_| PublicationError::Io)?;
        copy_metadata(&before, &attrs, &staging.file, control)?;
        staging.file.sync_all().map_err(|_| PublicationError::Io)?;
        if !reads.allows_read(&target_path) || !reads.allows_read(&backup_path) {
            return Err(ReadError::Denied.into());
        }
        self.revalidate_parent(root, &parent, &parent_path, reads, control)?;
        let actual = open_at(&parent, OsStr::from_bytes(target_name.as_bytes()), false)
            .map_err(|_| PublicationError::Conflict)?;
        let (text, after) = checked_text(&actual, control)?;
        if text != expected || !same_file(&before, &after) || attributes(&actual, control)? != attrs
        {
            return Err(PublicationError::Conflict);
        }
        if !writes.allows_replace(&target_path) {
            return Err(ReadError::Denied.into());
        }
        control.check()?;
        if unsafe {
            libc::syscall(
                libc::SYS_renameat2,
                parent.as_raw_fd(),
                staging.name.as_ptr(),
                parent.as_raw_fd(),
                target_name.as_ptr(),
                libc::RENAME_EXCHANGE,
            )
        } != 0
        {
            return Err(match io::Error::last_os_error().raw_os_error() {
                Some(libc::ENOSYS | libc::EINVAL | libc::EOPNOTSUPP) => {
                    PublicationError::MigrationUnsupported
                }
                _ => PublicationError::Io,
            });
        }
        staging.swapped = true;
        parent.sync_all().map_err(|_| PublicationError::Io)?;
        // The displaced entry is never deleted here, including on a late race.
        // Its pre-recorded name remains recoverable until the whole kit verifies.
        let displaced = open_at(&parent, OsStr::from_bytes(staging.name.as_bytes()), false)
            .map_err(|_| PublicationError::RecoveryRequired(vec![backup.into()]))?;
        let (text, displaced_meta) = checked_text(&displaced, control)?;
        if text != expected
            || displaced_meta.dev() != before.dev()
            || displaced_meta.ino() != before.ino()
            || displaced_meta.mode() != before.mode()
            || displaced_meta.uid() != before.uid()
            || displaced_meta.gid() != before.gid()
            || attributes(&displaced, control)? != attrs
        {
            return Err(PublicationError::RecoveryRequired(vec![backup.into()]));
        }
        let published = open_at(&parent, OsStr::from_bytes(target_name.as_bytes()), false)
            .map_err(|_| PublicationError::Conflict)?;
        let (text, published_meta) = checked_text(&published, control)?;
        let owned = staging.file.metadata().map_err(|_| PublicationError::Io)?;
        if text != proposed
            || published_meta.dev() != owned.dev()
            || published_meta.ino() != owned.ino()
            || published_meta.mode() != before.mode()
            || published_meta.uid() != before.uid()
            || published_meta.gid() != before.gid()
            || attributes(&published, control)? != attrs
        {
            return Err(PublicationError::Conflict);
        }
        control.check()?;
        Ok(())
    }

    pub(crate) fn cleanup_migration(
        &self,
        root: &Path,
        artifact: &RecoveryFile,
        reads: &dyn MemoryReadAccess,
        writes: &dyn MemoryWriteAccess,
        control: &ReadControl,
    ) -> Result<(), PublicationError> {
        let full = root.join(&artifact.path);
        if !writes.allows_remove_staging(&full)
            || !reads.allows_read(&full)
            || !reads.allows_metadata(&full)
        {
            return Err(ReadError::Denied.into());
        }
        let (parent, parent_path, name) =
            self.migration_parent(root, &artifact.path, reads, control)?;
        let file = open_at(&parent, OsStr::from_bytes(name.as_bytes()), false)
            .map_err(|_| PublicationError::RecoveryRequired(vec![artifact.path.clone()]))?;
        let (text, before) = checked_text(&file, control)?;
        if text != artifact.text {
            return Err(PublicationError::RecoveryRequired(vec![artifact
                .path
                .clone()]));
        }
        self.revalidate_parent(root, &parent, &parent_path, reads, control)?;
        if !same_file(&before, &file.metadata().map_err(|_| PublicationError::Io)?)
            || !entry_is(&parent, &name, &before)
        {
            return Err(PublicationError::RecoveryRequired(vec![artifact
                .path
                .clone()]));
        }
        control.check()?;
        if unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), 0) } != 0 {
            return Err(PublicationError::Io);
        }
        parent.sync_all().map_err(|_| PublicationError::Io)?;
        control.check()?;
        Ok(())
    }
}
