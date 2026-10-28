#![cfg(target_os = "linux")]

use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use voktty_memory_local::{
    DiscoveryControl, InitializationPreview, LocalMemoryStore, LocalMemoryWorkspace,
    MemoryReadAccess, MemoryWriteAccess, PublicationError, ReadControl, ReadError,
};
use voktty_workspace_kit::RootLinks;

struct Access {
    root: PathBuf,
    interrupt: AtomicBool,
    calls: AtomicUsize,
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
            || self.root.ancestors().any(|p| p == path)
            || self.root.ancestors().any(|p| path == p.join(".voktty"))
    }
    fn allows_read(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
}
impl MemoryWriteAccess for Access {
    fn allows_create(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
            && !(self.interrupt.load(Ordering::SeqCst)
                && path.ends_with("RULES.md")
                && self.calls.fetch_add(1, Ordering::SeqCst) == 1)
    }
    fn allows_replace(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
}

struct Fixture {
    _project: tempfile::TempDir,
    _state: tempfile::TempDir,
    store: LocalMemoryStore,
    access: Access,
}
fn fixture() -> Fixture {
    let project = tempfile::tempdir_in("/dev/shm").unwrap();
    let state = tempfile::tempdir().unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(state.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let store = LocalMemoryStore::open(state.path()).unwrap();
    store.initialize().unwrap();
    let root = fs::canonicalize(project.path()).unwrap();
    fs::create_dir(root.join(".voktty")).unwrap();
    fs::write(root.join(".voktty/.gitignore"), "*\n").unwrap();
    Fixture {
        _project: project,
        _state: state,
        store,
        access: Access {
            root,
            interrupt: AtomicBool::new(true),
            calls: AtomicUsize::new(0),
        },
    }
}
fn open(f: &Fixture) -> LocalMemoryWorkspace<'_> {
    LocalMemoryWorkspace::open(&f.store, &f.access.root, &f.access, &ReadControl::default())
        .unwrap()
}
fn preview<'w, 's>(workspace: &'w LocalMemoryWorkspace<'s>) -> InitializationPreview<'w, 's> {
    InitializationPreview::prepare(
        workspace,
        workspace,
        json!({"project_name":"Recovery retention","created_at":"2026-10-28"})
            .as_object()
            .unwrap(),
        RootLinks::default(),
        &DiscoveryControl::default(),
    )
    .unwrap()
}
fn interrupt(f: &Fixture, workspace: &LocalMemoryWorkspace<'_>) -> String {
    let failure = preview(workspace)
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(failure.error, PublicationError::Read(ReadError::Denied));
    assert_eq!(failure.migrated, vec![".voktty/.gitignore"]);
    assert!(!f.access.root.join(".voktty/kit.json").exists());
    failure.possible_recovery_files[0].clone()
}

#[test]
fn a_second_interruption_preserves_displaced_original_until_whole_kit_verifies() {
    let f = fixture();
    let workspace = open(&f);
    let backup = interrupt(&f, &workspace);
    let original = f.access.root.join(&backup);
    use std::os::unix::fs::MetadataExt;
    let before = fs::metadata(&original).unwrap();
    f.access.calls.store(0, Ordering::SeqCst);
    let retry = preview(&workspace);
    assert!(retry.is_resuming());
    assert_eq!(retry.recovery_files()[0].text, "*\n");
    let failure = retry
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(failure.error, PublicationError::Read(ReadError::Denied));
    assert!(!failure.cleaned.contains(&backup));
    assert_eq!(fs::read(&original).unwrap(), b"*\n");
    let after = fs::metadata(&original).unwrap();
    assert_eq!(
        (before.dev(), before.ino(), before.mode()),
        (after.dev(), after.ino(), after.mode())
    );
    assert!(!f.access.root.join(".voktty/kit.json").exists());
    f.access.interrupt.store(false, Ordering::SeqCst);
    let report = preview(&workspace)
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap();
    assert!(report.migrated.is_empty());
    assert_eq!(report.cleaned, vec![backup]);
    assert!(f.access.root.join(".voktty/kit.json").exists());
    assert!(!original.exists());
}

#[test]
fn duplicate_original_requires_recovery_without_deleting_either_copy() {
    let f = fixture();
    let workspace = open(&f);
    let backup = interrupt(&f, &workspace);
    let original = f.access.root.join(&backup);
    let target = f.access.root.join(".voktty/.gitignore");
    fs::write(&target, "*\n").unwrap();
    f.access.interrupt.store(false, Ordering::SeqCst);
    let retry = preview(&workspace);
    assert_eq!(retry.recovery_files()[0].text, "*\n");
    let failure = retry
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(
        failure.error,
        PublicationError::RecoveryRequired(vec![backup])
    );
    assert!(
        failure.created.is_empty() && failure.migrated.is_empty() && failure.cleaned.is_empty()
    );
    assert_eq!(fs::read(&original).unwrap(), b"*\n");
    assert_eq!(fs::read(&target).unwrap(), b"*\n");
    assert!(!f.access.root.join(".voktty/kit.json").exists());
}

#[test]
fn missing_migrated_ignore_does_not_rebase_its_intent_or_remove_original() {
    let f = fixture();
    let workspace = open(&f);
    let backup = interrupt(&f, &workspace);
    let original = f.access.root.join(backup);
    let target = f.access.root.join(".voktty/.gitignore");
    fs::remove_file(&target).unwrap();
    assert!(matches!(
        InitializationPreview::prepare(
            &workspace,
            &workspace,
            json!({"project_name":"Recovery retention","created_at":"2026-10-28"})
                .as_object()
                .unwrap(),
            RootLinks::default(),
            &DiscoveryControl::default(),
        ),
        Err(PublicationError::PendingIntent)
    ));
    assert_eq!(fs::read(&original).unwrap(), b"*\n");
    assert!(!target.exists());
    assert!(!f.access.root.join(".voktty/kit.json").exists());
}
