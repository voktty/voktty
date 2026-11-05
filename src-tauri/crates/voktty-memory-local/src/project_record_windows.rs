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
        if root != self.path
            || !reads.allows_workspace_root(root)
            || !reads.allows_metadata(&parent_path)
            || !reads.allows_metadata(&path)
            || !reads.allows_read(&path)
        {
            return Err(ReadError::Denied);
        }
        control.check()?;
        let parent = self.open_child(OsStr::new(".voktty"), &parent_path, control)?;
        let (file, before) = open_kind(
            parent.ancestors.last(),
            OsStr::new(".initialization.json"),
            OpenKind::File,
        )
        .map_err(|error| {
            if error.raw_os_error() == Some(32) {
                ReadError::Busy
            } else {
                ReadError::Unavailable
            }
        })?;
        let actual = final_path(&file)?;
        if before.directory
            || before.links != 1
            || before.delete_pending
            || !(0..=256 * 1024).contains(&before.size)
            || before.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || before.volume != self.state.volume
            || !reads.allows_metadata(&actual)
            || !reads.allows_read(&actual)
        {
            return Err(ReadError::Denied);
        }
        crate::publication::project_initialization::lock_record(&file)?;
        let mut bytes = Vec::new();
        (&file)
            .take(256 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ReadError::Io)?;
        control.check()?;
        if bytes.len() > 256 * 1024
            || state(&file).map_err(|_| ReadError::Io)? != before
            || Self::open_root(root, control)?.identity() != self.identity()
            || Self::open_root(&parent_path, control)?.identity() != parent.identity()
        {
            return Err(ReadError::StaleRoot);
        }
        if !reads.allows_workspace_root(root)
            || !reads.allows_metadata(&parent_path)
            || !reads.allows_metadata(&path)
            || !reads.allows_read(&path)
            || !reads.allows_metadata(&actual)
            || !reads.allows_read(&actual)
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
