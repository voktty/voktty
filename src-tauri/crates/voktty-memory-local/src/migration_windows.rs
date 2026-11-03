use super::*;
use crate::publication::Migration;
use crate::{PublicationError, RecoveryFile};
use std::os::windows::fs::FileExt;
use windows_sys::Wdk::Storage::FileSystem::{
    FileEaInformation, NtQueryInformationFile, FILE_EA_INFORMATION,
};
use windows_sys::Win32::Security::{
    GetKernelObjectSecurity, ATTRIBUTE_SECURITY_INFORMATION, DACL_SECURITY_INFORMATION,
    GROUP_SECURITY_INFORMATION, LABEL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION,
    SCOPE_SECURITY_INFORMATION,
};
use windows_sys::Win32::Storage::FileSystem::{
    FileStreamInfo, SetFileInformationByHandle, FILE_ATTRIBUTE_ARCHIVE, FILE_ATTRIBUTE_HIDDEN,
    FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_NOT_CONTENT_INDEXED, FILE_STREAM_INFO,
};
use windows_sys::Win32::System::SystemServices::{
    ACCESS_FILTER_SECURITY_INFORMATION, PROCESS_TRUST_LABEL_SECURITY_INFORMATION,
};

const MAX_TEXT: usize = 256 * 1024;
const MAX_SECURITY: usize = 64 * 1024;

fn checked_text(
    file: &File,
    control: &ReadControl,
) -> Result<(String, FileState), PublicationError> {
    control.check()?;
    let before = state(file).map_err(|_| PublicationError::Io)?;
    if before.directory
        || before.delete_pending
        || before.links != 1
        || !(0..=MAX_TEXT as i64).contains(&before.size)
        || before.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return Err(PublicationError::Conflict);
    }
    let mut bytes = vec![0; before.size as usize + 1];
    let mut offset = 0;
    while offset < bytes.len() {
        control.check()?;
        let count = file
            .seek_read(&mut bytes[offset..], offset as u64)
            .map_err(|_| PublicationError::Io)?;
        if count == 0 {
            break;
        }
        offset += count;
    }
    if offset != before.size as usize || state(file).map_err(|_| PublicationError::Io)? != before {
        return Err(PublicationError::Conflict);
    }
    bytes.truncate(offset);
    let text = String::from_utf8(bytes).map_err(|_| PublicationError::Conflict)?;
    if text.contains('\0') {
        return Err(PublicationError::Conflict);
    }
    control.check()?;
    Ok((text, before))
}

fn security(file: &File) -> Result<Vec<u8>, PublicationError> {
    let fields = OWNER_SECURITY_INFORMATION
        | GROUP_SECURITY_INFORMATION
        | DACL_SECURITY_INFORMATION
        | LABEL_SECURITY_INFORMATION
        | ATTRIBUTE_SECURITY_INFORMATION
        | SCOPE_SECURITY_INFORMATION
        | PROCESS_TRUST_LABEL_SECURITY_INFORMATION as u32
        | ACCESS_FILTER_SECURITY_INFORMATION as u32;
    let mut required = 0;
    unsafe {
        GetKernelObjectSecurity(
            file.as_raw_handle(),
            fields,
            std::ptr::null_mut(),
            0,
            &mut required,
        );
    }
    if required == 0 || required as usize > MAX_SECURITY {
        return Err(ReadError::Unsupported.into());
    }
    let mut storage = vec![0u64; (required as usize).div_ceil(8)];
    let capacity = required;
    if unsafe {
        GetKernelObjectSecurity(
            file.as_raw_handle(),
            fields,
            storage.as_mut_ptr().cast(),
            capacity,
            &mut required,
        )
    } == 0
        || required > capacity
    {
        return Err(ReadError::Unsupported.into());
    }
    Ok(unsafe { std::slice::from_raw_parts(storage.as_ptr().cast(), required as usize) }.to_vec())
}

fn plain_metadata(file: &File) -> Result<(), PublicationError> {
    let mut ea: FILE_EA_INFORMATION = unsafe { std::mem::zeroed() };
    let mut status = IO_STATUS_BLOCK::default();
    nt_result(unsafe {
        NtQueryInformationFile(
            file.as_raw_handle(),
            &mut status,
            (&mut ea as *mut FILE_EA_INFORMATION).cast(),
            size_of::<FILE_EA_INFORMATION>() as u32,
            FileEaInformation,
        )
    })
    .map_err(|_| ReadError::Unsupported)?;
    if status.Information != size_of::<FILE_EA_INFORMATION>() || ea.EaSize != 0 {
        return Err(ReadError::Unsupported.into());
    }
    let mut storage = vec![0u64; 8192];
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileStreamInfo,
            storage.as_mut_ptr().cast(),
            (storage.len() * 8) as u32,
        )
    } == 0
    {
        return Err(ReadError::Unsupported.into());
    }
    let stream = unsafe { &*storage.as_ptr().cast::<FILE_STREAM_INFO>() };
    let default: Vec<u16> = "::$DATA".encode_utf16().collect();
    if stream.NextEntryOffset != 0 || stream.StreamNameLength as usize != default.len() * 2 {
        return Err(ReadError::Unsupported.into());
    }
    let name = unsafe {
        std::slice::from_raw_parts(
            storage
                .as_ptr()
                .cast::<u8>()
                .add(offset_of!(FILE_STREAM_INFO, StreamName))
                .cast::<u16>(),
            default.len(),
        )
    };
    if name != default {
        return Err(ReadError::Unsupported.into());
    }
    let attributes = information::<FILE_BASIC_INFO>(file, FileBasicInfo)
        .map_err(|_| PublicationError::Io)?
        .FileAttributes;
    if attributes
        & !(FILE_ATTRIBUTE_NORMAL
            | FILE_ATTRIBUTE_ARCHIVE
            | FILE_ATTRIBUTE_HIDDEN
            | FILE_ATTRIBUTE_NOT_CONTENT_INDEXED)
        != 0
    {
        return Err(ReadError::Unsupported.into());
    }
    Ok(())
}

fn compatible_metadata(original: &File, staging: &File) -> Result<Vec<u8>, PublicationError> {
    plain_metadata(original)?;
    plain_metadata(staging)?;
    let descriptor = security(original)?;
    if security(staging)? != descriptor {
        return Err(ReadError::Unsupported.into());
    }
    let basic: FILE_BASIC_INFO =
        information(original, FileBasicInfo).map_err(|_| PublicationError::Io)?;
    let attributes = FILE_BASIC_INFO {
        FileAttributes: basic.FileAttributes,
        ..Default::default()
    };
    if unsafe {
        SetFileInformationByHandle(
            staging.as_raw_handle(),
            FileBasicInfo,
            (&attributes as *const FILE_BASIC_INFO).cast(),
            size_of::<FILE_BASIC_INFO>() as u32,
        )
    } == 0
    {
        return Err(ReadError::Unsupported.into());
    }
    Ok(descriptor)
}

struct Parent<'a> {
    directory: &'a Directory,
    pinned: Vec<File>,
    path: PathBuf,
    actual: PathBuf,
}
impl Parent<'_> {
    fn file(&self) -> &File {
        self.pinned
            .last()
            .or_else(|| self.directory.ancestors.last())
            .expect("captured root")
    }
    fn validate(
        &self,
        reads: &dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<(), PublicationError> {
        control.check()?;
        if !reads.allows_metadata(&self.directory.path)
            || !reads.allows_metadata(&self.path)
            || !reads.allows_metadata(&self.actual)
        {
            return Err(ReadError::Denied.into());
        }
        let held = state(self.file()).map_err(|_| PublicationError::Io)?;
        if Directory::open_root(&self.directory.path, control)?.identity()
            != self.directory.identity()
            || Directory::open_root(&self.path, control)?.identity() != (held.volume, held.id)
            || held.volume != self.directory.state.volume
        {
            return Err(ReadError::StaleRoot.into());
        }
        Ok(())
    }
}

fn authorized(reads: &dyn MemoryReadAccess, path: &Path, actual: &Path) -> bool {
    reads.allows_metadata(path)
        && reads.allows_metadata(actual)
        && reads.allows_read(path)
        && reads.allows_read(actual)
}

fn preserve_uncertain_stage(staging: &mut Staging, expected: &Path) {
    staging.published = final_path(&staging.file).map_or(true, |path| path != expected);
}

impl Directory {
    fn migration_parent(
        &self,
        root: &Path,
        relative: &str,
        reads: &dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<Parent<'_>, PublicationError> {
        let parts: Vec<_> = Path::new(relative).components().collect();
        if root != self.path
            || parts.is_empty()
            || parts.len() > 2
            || parts.iter().any(|part| {
                !matches!(part, Component::Normal(name)
                if !name.to_string_lossy().contains([':', '\\']))
            })
        {
            return Err(ReadError::InvalidInput.into());
        }
        let mut parent = Parent {
            directory: self,
            pinned: Vec::new(),
            path: root.into(),
            actual: final_path(self.ancestors.last().ok_or(ReadError::InvalidInput)?)?,
        };
        for part in &parts[..parts.len() - 1] {
            control.check()?;
            parent.path.push(part.as_os_str());
            parent.actual.push(part.as_os_str());
            if !reads.allows_metadata(&parent.path) || !reads.allows_metadata(&parent.actual) {
                return Err(ReadError::Denied.into());
            }
            let (child, _) = open_kind(Some(parent.file()), part.as_os_str(), OpenKind::Directory)
                .map_err(|_| PublicationError::Conflict)?;
            parent.actual = final_path(&child)?;
            parent.pinned.push(child);
        }
        parent.validate(reads, control)?;
        Ok(parent)
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
            || expected.contains('\0')
            || proposed.contains('\0')
            || Path::new(path).parent() != Path::new(backup).parent()
            || !Path::new(backup)
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with(".voktty-migration-"))
        {
            return Err(ReadError::InvalidInput.into());
        }
        let parent = self.migration_parent(root, path, reads, control)?;
        let name = Path::new(path).file_name().ok_or(ReadError::InvalidInput)?;
        let backup_name = Path::new(backup)
            .file_name()
            .ok_or(ReadError::InvalidInput)?;
        let target = root.join(path);
        let actual_target = parent.actual.join(name);
        let saved = root.join(backup);
        let actual_saved = parent.actual.join(backup_name);
        if !authorized(reads, &target, &actual_target)
            || !authorized(reads, &saved, &actual_saved)
            || !writes.allows_replace(&target)
            || !writes.allows_replace(&actual_target)
            || !writes.allows_create(&saved)
            || !writes.allows_create(&actual_saved)
            || !writes.allows_remove_staging(&saved)
            || !writes.allows_remove_staging(&actual_saved)
        {
            return Err(ReadError::Denied.into());
        }
        let (original, before) = open_kind(Some(parent.file()), name, OpenKind::MigrationFile)
            .map_err(|_| PublicationError::Conflict)?;
        let actual_original = final_path(&original)?;
        if !authorized(reads, &target, &actual_original) || !writes.allows_replace(&actual_original)
        {
            return Err(ReadError::Denied.into());
        }
        if checked_text(&original, control)?.0 != expected {
            return Err(PublicationError::Conflict);
        }
        plain_metadata(&original)?;
        let staging_name = format!(".voktty-stage-{}", uuid::Uuid::new_v4());
        let staging_path = parent.path.join(&staging_name);
        let actual_stage = parent.actual.join(&staging_name);
        if !writes.allows_create(&staging_path)
            || !writes.allows_create(&actual_stage)
            || !authorized(reads, &staging_path, &actual_stage)
        {
            return Err(ReadError::Denied.into());
        }
        control.check()?;
        let (file, _) = open_kind(
            Some(parent.file()),
            OsStr::new(&staging_name),
            OpenKind::CreateMigrationFile,
        )
        .map_err(|_| PublicationError::Io)?;
        let mut staging = Staging {
            file,
            published: false,
        };
        staging
            .file
            .write_all(proposed.as_bytes())
            .map_err(|_| PublicationError::Io)?;
        let descriptor = compatible_metadata(&original, &staging.file)?;
        staging.file.sync_all().map_err(|_| PublicationError::Io)?;
        parent.validate(reads, control)?;
        if checked_text(&original, control)?.0 != expected
            || state(&original).map_err(|_| PublicationError::Io)? != before
            || security(&original)? != descriptor
            || security(&staging.file)? != descriptor
        {
            return Err(PublicationError::Conflict);
        }
        if !authorized(reads, &target, &actual_original)
            || !authorized(reads, &saved, &actual_saved)
            || !writes.allows_replace(&target)
            || !writes.allows_replace(&actual_original)
            || !writes.allows_create(&saved)
            || !writes.allows_create(&actual_saved)
        {
            return Err(ReadError::Denied.into());
        }
        control.check()?;
        // Both renames refuse replacement. The original stays at its journalled
        // recovery name if cancellation or a racing target prevents publication.
        rename_new(&original, parent.file(), backup_name)
            .map_err(|_| PublicationError::RecoveryRequired(vec![backup.into()]))?;
        let finish = || -> Result<(), PublicationError> {
            parent.validate(reads, control)?;
            if !writes.allows_replace(&target)
                || !writes.allows_replace(&actual_target)
                || !authorized(reads, &target, &actual_target)
            {
                return Err(ReadError::Denied.into());
            }
            control.check()?;
            rename_new(&staging.file, parent.file(), name)
                .map_err(|_| PublicationError::Conflict)?;
            Ok(())
        };
        if finish().is_err() {
            // An IO failure can leave rename completion uncertain. Disposition
            // is safe only while the owned object still has its staging name.
            preserve_uncertain_stage(&mut staging, &actual_stage);
            return Err(PublicationError::RecoveryRequired(vec![backup.into()]));
        }
        staging.published = true;
        staging.file.sync_all().map_err(|_| PublicationError::Io)?;
        let (text, after) = checked_text(&original, control)?;
        if text != expected
            || (after.volume, after.id) != (before.volume, before.id)
            || final_path(&original)? != actual_saved
            || security(&original)? != descriptor
            || checked_text(&staging.file, control)?.0 != proposed
            || state(&staging.file)
                .map_err(|_| PublicationError::Io)?
                .attributes
                != before.attributes
            || security(&staging.file)? != descriptor
        {
            return Err(PublicationError::RecoveryRequired(vec![backup.into()]));
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
        let parent = self.migration_parent(root, &artifact.path, reads, control)?;
        let name = Path::new(&artifact.path)
            .file_name()
            .ok_or(ReadError::InvalidInput)?;
        let full = root.join(&artifact.path);
        let actual = parent.actual.join(name);
        if !authorized(reads, &full, &actual)
            || !writes.allows_remove_staging(&full)
            || !writes.allows_remove_staging(&actual)
        {
            return Err(ReadError::Denied.into());
        }
        let (file, before) = open_kind(Some(parent.file()), name, OpenKind::MigrationFile)
            .map_err(|_| PublicationError::RecoveryRequired(vec![artifact.path.clone()]))?;
        if checked_text(&file, control)?.0 != artifact.text {
            return Err(PublicationError::RecoveryRequired(vec![artifact
                .path
                .clone()]));
        }
        plain_metadata(&file)?;
        parent.validate(reads, control)?;
        if state(&file).map_err(|_| PublicationError::Io)? != before
            || !authorized(reads, &full, &final_path(&file)?)
            || !writes.allows_remove_staging(&full)
            || !writes.allows_remove_staging(&actual)
        {
            return Err(PublicationError::RecoveryRequired(vec![artifact
                .path
                .clone()]));
        }
        control.check()?;
        let disposition = FILE_DISPOSITION_INFORMATION { DeleteFile: true };
        let mut status = IO_STATUS_BLOCK::default();
        nt_result(unsafe {
            NtSetInformationFile(
                file.as_raw_handle(),
                &mut status,
                (&disposition as *const FILE_DISPOSITION_INFORMATION).cast(),
                size_of::<FILE_DISPOSITION_INFORMATION>() as u32,
                FileDispositionInformation,
            )
        })
        .map_err(|_| PublicationError::Io)?;
        drop(file);
        control.check()?;
        Ok(())
    }
}

#[cfg(test)]
mod native_tests {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE};
    use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS;

    fn mutable_file(path: &Path) -> File {
        std::fs::OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .access_mode(GENERIC_READ | GENERIC_WRITE | DELETE)
            .share_mode(FILE_SHARE_READ)
            .open(path)
            .unwrap()
    }

    #[test]
    fn relative_rename_keeps_original_and_never_replaces_a_racing_target() {
        for racing in [false, true] {
            let temporary = tempfile::tempdir().unwrap();
            let parent = std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
                .open(temporary.path())
                .unwrap();
            let target = temporary.path().join("rules");
            let mut original = mutable_file(&target);
            original.write_all(b"original").unwrap();
            assert!(std::fs::write(&target, b"unreviewed edit").is_err());
            let mut staging = mutable_file(&temporary.path().join("staging"));
            staging.write_all(b"proposed").unwrap();
            staging.sync_all().unwrap();
            rename_new(&original, &parent, OsStr::new("recovery")).unwrap();
            if racing {
                std::fs::write(&target, b"foreign").unwrap();
            }
            let result = rename_new(&staging, &parent, OsStr::new("rules"));
            assert_eq!(result.is_err(), racing);
            assert_eq!(
                std::fs::read(temporary.path().join("recovery")).unwrap(),
                b"original"
            );
            assert_eq!(
                std::fs::read(&target).unwrap(),
                if racing {
                    b"foreign".as_slice()
                } else {
                    b"proposed".as_slice()
                }
            );
        }
    }

    #[test]
    fn ordinary_sibling_files_preserve_security_and_supported_metadata() {
        let temporary = tempfile::tempdir().unwrap();
        let original = mutable_file(&temporary.path().join("original"));
        let staging = mutable_file(&temporary.path().join("staging"));
        plain_metadata(&original).expect("source metadata queries");
        plain_metadata(&staging).expect("staging metadata queries");
        assert_eq!(
            security(&original).expect("source security"),
            security(&staging).expect("staging security")
        );
        let descriptor = compatible_metadata(&original, &staging).unwrap();
        assert_eq!(descriptor, security(&original).unwrap());
        assert_eq!(descriptor, security(&staging).unwrap());
    }

    #[test]
    fn inherited_access_security_is_equal_without_changing_permissions() {
        let temporary = tempfile::tempdir().unwrap();
        let original = mutable_file(&temporary.path().join("original"));
        let staging = mutable_file(&temporary.path().join("staging"));
        let descriptor = security(&original).unwrap();
        assert!(!descriptor.is_empty());
        assert_eq!(descriptor, security(&staging).unwrap());
        assert_eq!(descriptor, security(&original).unwrap());
    }

    #[test]
    fn uncertain_completion_never_deletes_a_renamed_proposal() {
        for renamed in [false, true] {
            let temporary = tempfile::tempdir().unwrap();
            let parent = std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
                .open(temporary.path())
                .unwrap();
            let file = mutable_file(&temporary.path().join("staging"));
            let expected = final_path(&file).unwrap();
            let mut staging = Staging {
                file,
                published: false,
            };
            if renamed {
                rename_new(&staging.file, &parent, OsStr::new("target")).unwrap();
            }
            preserve_uncertain_stage(&mut staging, &expected);
            assert_eq!(staging.published, renamed);
            drop(staging);
            assert!(!temporary.path().join("staging").exists());
            assert_eq!(temporary.path().join("target").exists(), renamed);
        }
    }

    #[test]
    fn a_named_stream_is_not_silently_dropped() {
        let temporary = tempfile::tempdir().unwrap();
        let target = temporary.path().join("rules");
        std::fs::write(&target, "rules").unwrap();
        std::fs::write(temporary.path().join("rules:private"), "stream").unwrap();
        let file = File::open(&target).unwrap();
        assert_eq!(
            plain_metadata(&file),
            Err(PublicationError::Read(ReadError::Unsupported))
        );
        assert_eq!(
            std::fs::read(temporary.path().join("rules:private")).unwrap(),
            b"stream"
        );
    }
}
