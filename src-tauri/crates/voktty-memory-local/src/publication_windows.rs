use super::*;
use crate::MemoryWriteAccess;
use std::io::Write;
use windows_sys::Wdk::Storage::FileSystem::{
    FileDispositionInformation, FileRenameInformation, NtSetInformationFile,
    FILE_DISPOSITION_INFORMATION, FILE_RENAME_INFORMATION,
};

fn nt_result(status: i32) -> io::Result<()> {
    if status == 0 {
        Ok(())
    } else if status < 0 {
        Err(io::Error::from_raw_os_error(
            unsafe { RtlNtStatusToDosError(status) } as i32,
        ))
    } else {
        Err(io::ErrorKind::Other.into())
    }
}

fn rename_new(file: &File, parent: &File, name: &OsStr) -> io::Result<()> {
    let wide: Vec<_> = name.encode_wide().collect();
    if wide.is_empty() || wide.len() > 32767 || wide.iter().any(|c| matches!(*c, 0 | 47 | 92 | 58))
    {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let length = size_of::<FILE_RENAME_INFORMATION>() + wide.len() * 2;
    let mut storage = vec![0u64; length.div_ceil(8)];
    let info = storage.as_mut_ptr().cast::<FILE_RENAME_INFORMATION>();
    // The zeroed union leaves ReplaceIfExists false. Both source and target
    // parent are owned handles; a racing entry cannot be replaced.
    unsafe {
        (*info).RootDirectory = parent.as_raw_handle();
        (*info).FileNameLength = (wide.len() * 2) as u32;
        std::ptr::copy_nonoverlapping(wide.as_ptr(), (*info).FileName.as_mut_ptr(), wide.len());
    }
    let mut status = IO_STATUS_BLOCK::default();
    nt_result(unsafe {
        NtSetInformationFile(
            file.as_raw_handle(),
            &mut status,
            info.cast(),
            length as u32,
            FileRenameInformation,
        )
    })
}

struct Staging {
    file: File,
    published: bool,
}

impl Drop for Staging {
    fn drop(&mut self) {
        if !self.published {
            let info = FILE_DISPOSITION_INFORMATION { DeleteFile: true };
            let mut status = IO_STATUS_BLOCK::default();
            // Delete only the exclusively created object, never a path looked
            // up again. No file operation follows disposition before close.
            let _ = unsafe {
                NtSetInformationFile(
                    self.file.as_raw_handle(),
                    &mut status,
                    (&info as *const FILE_DISPOSITION_INFORMATION).cast(),
                    size_of::<FILE_DISPOSITION_INFORMATION>() as u32,
                    FileDispositionInformation,
                )
            };
        }
    }
}

fn write_error(error: io::Error) -> ReadError {
    match error.kind() {
        io::ErrorKind::AlreadyExists => ReadError::Unavailable,
        io::ErrorKind::PermissionDenied => ReadError::Denied,
        _ => ReadError::Io,
    }
}

impl Directory {
    pub(crate) fn create_text(
        &self,
        root: &Path,
        relative: &str,
        text: &str,
        reads: &dyn MemoryReadAccess,
        writes: &dyn MemoryWriteAccess,
        control: &ReadControl,
    ) -> Result<(), ReadError> {
        control.check()?;
        let parts: Vec<_> = Path::new(relative).components().collect();
        if root != self.path
            || parts.is_empty()
            || parts.len() > 64
            || text.len() > 256 * 1024
            || text.contains('\0')
            || parts.iter().any(|part| {
                !matches!(part, Component::Normal(name) if !name.to_string_lossy().contains([':', '\\']))
            })
        {
            return Err(ReadError::InvalidInput);
        }
        let mut pinned = Vec::new();
        let mut parent_path = root.to_path_buf();
        for part in &parts[..parts.len() - 1] {
            control.check()?;
            let path = parent_path.join(part.as_os_str());
            let parent = pinned.last().or_else(|| self.ancestors.last());
            let actual_path =
                final_path(parent.ok_or(ReadError::InvalidInput)?)?.join(part.as_os_str());
            if !reads.allows_metadata(&path) || !reads.allows_metadata(&actual_path) {
                return Err(ReadError::Denied);
            }
            let (child, observed) = match open_kind(parent, part.as_os_str(), OpenKind::Directory) {
                Ok(found) => found,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    if !writes.allows_create(&path) || !writes.allows_create(&actual_path) {
                        return Err(ReadError::Denied);
                    }
                    control.check()?;
                    match open_kind(parent, part.as_os_str(), OpenKind::CreateDirectory) {
                        Ok(created) => created,
                        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                            open_kind(parent, part.as_os_str(), OpenKind::Directory)
                                .map_err(write_error)?
                        }
                        Err(error) => return Err(write_error(error)),
                    }
                }
                Err(error) => return Err(write_error(error)),
            };
            if observed.volume != self.state.volume {
                return Err(ReadError::Unsupported);
            }
            if !reads.allows_metadata(&final_path(&child)?) {
                return Err(ReadError::Denied);
            }
            pinned.push(child);
            parent_path = path;
        }
        let parent = pinned
            .last()
            .or_else(|| self.ancestors.last())
            .ok_or(ReadError::InvalidInput)?;
        let target = root.join(relative);
        let actual_parent = final_path(parent)?;
        let actual_target = actual_parent.join(parts.last().unwrap().as_os_str());
        let staging_name = format!(".voktty-stage-{}", uuid::Uuid::new_v4());
        let staging_path = parent_path.join(&staging_name);
        let actual_staging = actual_parent.join(&staging_name);
        if !writes.allows_create(&target)
            || !writes.allows_create(&staging_path)
            || !writes.allows_create(&actual_target)
            || !writes.allows_create(&actual_staging)
            || !reads.allows_metadata(&target)
            || !reads.allows_metadata(&staging_path)
            || !reads.allows_metadata(&actual_target)
            || !reads.allows_metadata(&actual_staging)
        {
            return Err(ReadError::Denied);
        }
        control.check()?;
        let (file, _) = open_kind(
            Some(parent),
            OsStr::new(&staging_name),
            OpenKind::CreateFile,
        )
        .map_err(write_error)?;
        let mut staging = Staging {
            file,
            published: false,
        };
        staging
            .file
            .write_all(text.as_bytes())
            .map_err(write_error)?;
        staging.file.sync_all().map_err(write_error)?;
        control.check()?;
        if !writes.allows_create(&target)
            || !writes.allows_create(&actual_target)
            || !reads.allows_read(&target)
            || !reads.allows_read(&actual_target)
            || !reads.allows_metadata(&target)
            || !reads.allows_metadata(&actual_target)
        {
            return Err(ReadError::Denied);
        }
        let current_root = Self::open_root(root, control)?;
        let current_parent = Self::open_root(&parent_path, control)?;
        let parent_state = state(parent).map_err(write_error)?;
        let stage_state = state(&staging.file).map_err(write_error)?;
        if current_root.identity() != self.identity()
            || current_parent.identity() != (parent_state.volume, parent_state.id)
            || stage_state.volume != self.state.volume
            || stage_state.links != 1
            || stage_state.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || stage_state.delete_pending
            || stage_state.size != text.len() as i64
        {
            return Err(ReadError::StaleRoot);
        }
        control.check()?;
        rename_new(&staging.file, parent, parts.last().unwrap().as_os_str())
            .map_err(write_error)?;
        staging.published = true;
        staging.file.sync_all().map_err(write_error)?;
        control.check()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Access {
        denied: PathBuf,
    }
    impl MemoryReadAccess for Access {
        fn allows_metadata(&self, path: &Path) -> bool {
            !path.starts_with(&self.denied)
        }
        fn allows_read(&self, path: &Path) -> bool {
            self.allows_metadata(path)
        }
    }
    impl MemoryWriteAccess for Access {
        fn allows_create(&self, path: &Path) -> bool {
            !path.starts_with(&self.denied)
        }
    }

    #[test]
    fn actual_parent_spelling_requires_authority_before_creating_under_a_case_alias() {
        let project = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(project.path()).unwrap();
        let denied = root.join(".VOKTTY");
        std::fs::create_dir(&denied).unwrap();
        let alias_resolves = root.join(".voktty").is_dir();
        let access = Access { denied };
        let control = ReadControl::default();
        let directory = Directory::open_root(&root, &control).unwrap();
        let result = directory.create_text(
            &root,
            ".voktty/INIT.md",
            "complete bytes",
            &access,
            &access,
            &control,
        );
        if alias_resolves {
            assert_eq!(result, Err(ReadError::Denied));
            assert!(!access.denied.join("INIT.md").exists());
            assert_eq!(std::fs::read_dir(&access.denied).unwrap().count(), 0);
        } else {
            result.unwrap();
            assert_eq!(
                std::fs::read(root.join(".voktty/INIT.md")).unwrap(),
                b"complete bytes"
            );
            assert_eq!(std::fs::read_dir(&access.denied).unwrap().count(), 0);
        }
    }
}
