#![cfg(target_os = "linux")]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use voktty_memory_local::{
    LocalMemoryStore, LocalMemoryWorkspace, MemoryReadAccess, ReadControl, ReadError,
};

struct MetadataOnly(AtomicUsize);
impl MemoryReadAccess for MetadataOnly {
    fn allows_metadata(&self, _: &Path) -> bool {
        true
    }
    fn allows_read(&self, _: &Path) -> bool {
        self.0.fetch_add(1, Ordering::Relaxed);
        false
    }
}

#[test]
fn unsupported_project_filesystem_is_rejected_before_preferences_or_project_content_reads() {
    let state = tempfile::tempdir().unwrap();
    fs::set_permissions(state.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let store = LocalMemoryStore::open(state.path()).unwrap();
    let access = MetadataOnly(AtomicUsize::new(0));
    assert!(matches!(
        LocalMemoryWorkspace::open(&store, Path::new("/proc"), &access, &ReadControl::default()),
        Err(ReadError::Unsupported)
    ));
    assert_eq!(access.0.load(Ordering::Relaxed), 0);
    assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
}

#[test]
fn recognized_project_filesystem_does_not_require_private_state_permissions() {
    let state = tempfile::tempdir().unwrap();
    fs::set_permissions(state.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let store = LocalMemoryStore::open(state.path()).unwrap();
    store.initialize().unwrap();
    let project = tempfile::tempdir().unwrap();
    fs::set_permissions(project.path(), fs::Permissions::from_mode(0o777)).unwrap();
    let access = MetadataOnly(AtomicUsize::new(0));
    let workspace =
        LocalMemoryWorkspace::open(&store, project.path(), &access, &ReadControl::default())
            .unwrap();
    assert_eq!(workspace.root(), project.path());
    assert_eq!(access.0.load(Ordering::Relaxed), 0);
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}
