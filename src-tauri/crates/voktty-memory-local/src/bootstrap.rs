use crate::{LocalMemoryStore, ReadControl, ReadError};
use std::path::{Component, Path};

pub(crate) const PRIVATE_DIRECTORY: &str = "project-memory";

impl LocalMemoryStore {
    /// Creates or opens the fixed memory subdirectory of an existing native-owned
    /// application directory. The caller must qualify its local filesystem and
    /// keep it and its ancestors application-controlled, including Windows ACLs.
    /// This never initializes identity, policy, trust or project files.
    pub fn create_private(parent: &Path, control: &ReadControl) -> Result<Self, ReadError> {
        control.check()?;
        let text = parent.to_str().ok_or(ReadError::InvalidInput)?;
        if text.starts_with("//") || (text.starts_with(r"\\") && !text.starts_with(r"\\?\")) {
            return Err(ReadError::Unsupported);
        }
        if !parent.is_absolute()
            || text.chars().any(|c| c <= '\u{001f}')
            || parent
                .components()
                .any(|part| matches!(part, Component::ParentDir))
        {
            return Err(ReadError::InvalidInput);
        }
        if text.len() > 4096 || parent.components().count() > 128 {
            return Err(ReadError::Limit);
        }
        #[cfg(unix)]
        use crate::reader_unix::Directory;
        #[cfg(windows)]
        use crate::reader_windows::Directory;
        #[cfg(any(unix, windows))]
        {
            let directory = Directory::open_root(parent, control)?;
            let child = directory.create_private_state(control)?;
            let path = parent.join(PRIVATE_DIRECTORY);
            let store = Self::open(&path).map_err(ReadError::Store)?;
            if Directory::open_root(parent, control)?.identity() != directory.identity()
                || Directory::open_root(&path, control)?.identity() != child.identity()
            {
                return Err(ReadError::StaleRoot);
            }
            control.check()?;
            Ok(store)
        }
        #[cfg(not(any(unix, windows)))]
        Err(ReadError::Unsupported)
    }
}
