use super::super::MarkerAccess;
use std::path::{Path, PathBuf};
use voktty_memory_local::{path_policy, MemoryReadAccess};

pub(super) struct ProjectReadAccess {
    marker: MarkerAccess,
    memory: PathBuf,
}
impl ProjectReadAccess {
    pub(super) fn new(origin: PathBuf, memory: PathBuf) -> Self {
        Self {
            marker: MarkerAccess { root: origin },
            memory,
        }
    }
}
impl MemoryReadAccess for ProjectReadAccess {
    fn allows_metadata(&self, path: &Path) -> bool {
        path.starts_with(&self.memory) || self.marker.allows_metadata(path)
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        (path == self.memory || path == self.marker.root)
            && path.to_str().is_some_and(path_policy::readable)
    }
    fn allows_read(&self, path: &Path) -> bool {
        (path.starts_with(&self.memory) && path.to_str().is_some_and(path_policy::readable))
            || self.marker.allows_read(path)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        path.starts_with(&self.memory) || self.marker.allows_enumeration(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_reads_preserve_root_marker_and_secret_boundaries() {
        let directory = tempfile::tempdir().unwrap();
        let memory = directory.path().join("project");
        let execution = memory.join("source");
        let access = ProjectReadAccess::new(execution.clone(), memory.clone());
        assert!(access.allows_workspace_root(&memory));
        assert!(access.allows_workspace_root(&execution));
        assert!(access.allows_read(&memory.join(".voktty/INIT.md")));
        assert!(access.allows_read(&memory.join("AGENTS.md")));
        assert!(access.allows_read(&directory.path().join(".voktty/kit.json")));
        assert!(!access.allows_read(&memory.join(".env")));
        assert!(!access.allows_read(&directory.path().join("sibling/CONTEXT.md")));
        assert!(!access.allows_read(&directory.path().join(".voktty/INIT.md")));
        assert!(!access.allows_workspace_root(directory.path()));
    }
}
