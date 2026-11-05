use super::*;

impl Directory {
    pub(crate) fn hold_initialization_record(
        &self,
        root: &Path,
        reads: &dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<(File, String), ReadError> {
        let path = root.join(crate::PROJECT_INITIALIZATION_RECORD);
        let parent_path = root.join(".voktty");
        if !reads.allows_workspace_root(root)
            || !reads.allows_metadata(&parent_path)
            || !reads.allows_metadata(&path)
            || !reads.allows_read(&path)
        {
            return Err(ReadError::Denied);
        }
        control.check()?;
        let parent = self.open_child(OsStr::new(".voktty"), &parent_path, control)?;
        let name = OsStr::new(".initialization.json");
        let file = open_at(&parent.file, name, false).map_err(|_| ReadError::Unavailable)?;
        let before = file.metadata().map_err(|_| ReadError::Io)?;
        if before.dev() != self.metadata.dev() || parent.metadata.dev() != self.metadata.dev() {
            return Err(ReadError::Unsupported);
        }
        if !before.is_file() || before.nlink() != 1 || before.len() > 256 * 1024 {
            return Err(ReadError::Unavailable);
        }
        crate::publication::project_initialization::lock_record(&file)?;
        let mut bytes = Vec::new();
        (&file)
            .take(256 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ReadError::Io)?;
        control.check()?;
        if bytes.len() > 256 * 1024
            || !same_file(&before, &file.metadata().map_err(|_| ReadError::Io)?)
            || !same_file(
                &before,
                &open_at(&parent.file, name, false)
                    .map_err(|_| ReadError::Unavailable)?
                    .metadata()
                    .map_err(|_| ReadError::Io)?,
            )
            || Self::open_root(root, control)?.identity() != self.identity()
            || Self::open_root(&parent_path, control)?.identity() != parent.identity()
        {
            return Err(ReadError::StaleRoot);
        }
        if !reads.allows_workspace_root(root)
            || !reads.allows_metadata(&parent_path)
            || !reads.allows_metadata(&path)
            || !reads.allows_read(&path)
        {
            return Err(ReadError::Denied);
        }
        let text = String::from_utf8(bytes).map_err(|_| ReadError::Unavailable)?;
        if text.contains('\0') {
            return Err(ReadError::Unavailable);
        }
        control.check()?;
        Ok((file, text))
    }
}
