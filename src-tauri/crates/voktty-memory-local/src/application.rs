#[cfg(unix)]
use crate::reader_unix::Directory;
#[cfg(windows)]
use crate::reader_windows::Directory;
use crate::{LocalMemoryStore, ReadControl, ReadError};
use std::path::{Component, Path, PathBuf};

impl LocalMemoryStore {
    /// The path must originate in the native application directory resolver.
    /// Missing suffixes are created privately after checking the captured chain.
    /// Errors preserve created directories, without initializing an identity.
    pub fn prepare_application_parent(path: &Path, control: &ReadControl) -> Result<(), ReadError> {
        application_parent(path, true, control)
    }

    /// Checks the native application origin without creating any directory.
    pub fn check_application_parent(path: &Path, control: &ReadControl) -> Result<(), ReadError> {
        application_parent(path, false, control)
    }
}

#[cfg(any(unix, windows))]
fn verify(chain: &[(PathBuf, Directory)], control: &ReadControl) -> Result<(), ReadError> {
    let mut fresh = Directory::open_root(&chain[0].0, control)?;
    for (index, (path, original)) in chain.iter().enumerate() {
        if index != 0 {
            fresh = fresh.open_child(
                path.file_name().ok_or(ReadError::InvalidInput)?,
                path,
                control,
            )?;
        }
        if fresh.identity() != original.identity() {
            return Err(ReadError::StaleRoot);
        }
        fresh.qualify_ancestor(control)?;
    }
    Ok(())
}

fn application_parent(path: &Path, create: bool, control: &ReadControl) -> Result<(), ReadError> {
    crate::bootstrap::validate_parent(path, control)?;
    #[cfg(any(unix, windows))]
    {
        let mut root = PathBuf::new();
        let mut names = Vec::new();
        for part in path.components() {
            match part {
                Component::Prefix(_) | Component::RootDir => root.push(part.as_os_str()),
                Component::Normal(name) => names.push(name),
                _ => return Err(ReadError::InvalidInput),
            }
        }
        if names.is_empty() {
            return Err(ReadError::InvalidInput);
        }
        let directory = Directory::open_root(&root, control)?;
        directory.qualify_ancestor(control)?;
        let mut chain = vec![(root, directory)];
        for name in names {
            control.check()?;
            let (parent_path, parent) = chain.last().ok_or(ReadError::InvalidInput)?;
            let target = parent_path.join(name);
            let child = match parent.probe(name).map_err(|_| ReadError::Io)? {
                Some(crate::discovery::EntryKind::Directory) => {
                    parent.open_child(name, &target, control)?
                }
                None if create => {
                    verify(&chain, control)?;
                    parent.qualify_state(false, control)?;
                    parent.create_state_child(name, control)?
                }
                None => return Err(ReadError::Unavailable),
                _ => return Err(ReadError::Denied),
            };
            child.qualify_ancestor(control)?;
            chain.push((target, child));
        }
        verify(&chain, control)?;
        chain
            .last()
            .ok_or(ReadError::InvalidInput)?
            .1
            .qualify_state(false, control)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = create;
        Err(ReadError::Unsupported)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn a_replaced_pinned_parent_cannot_pass_final_verification() {
        let root = tempfile::tempdir_in(fs::canonicalize(std::env::temp_dir()).unwrap()).unwrap();
        let path = root.path().join("application");
        fs::create_dir(&path).unwrap();
        let chain = vec![(
            path.clone(),
            Directory::open_root(&path, &ReadControl::default()).unwrap(),
        )];
        fs::rename(&path, root.path().join("retired")).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(matches!(
            verify(&chain, &ReadControl::default()),
            Err(ReadError::StaleRoot)
        ));
        assert!(!path.join("project-memory").exists());
    }
}
