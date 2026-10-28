#![cfg(target_os = "linux")]

use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::ThreadId;
use tokio::runtime::{Builder, Runtime};
use voktty_memory_local::{
    DiscoveryControl, DiscoveryPurpose, LocalMemoryStore, MemoryReadAccess, MemoryWorkError,
    MemoryWorkers, ReadControl, ReadError,
};
use voktty_workspace_kit::render_template;

struct Access {
    root: PathBuf,
    allowed: AtomicBool,
    thread: Mutex<Option<ThreadId>>,
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        *self.thread.lock().unwrap() = Some(std::thread::current().id());
        self.allowed.load(Ordering::SeqCst)
            && (path.starts_with(&self.root)
                || self.root.ancestors().any(|p| p == path)
                || self.root.ancestors().any(|p| path == p.join(".voktty")))
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.allowed.load(Ordering::SeqCst) && path.starts_with(&self.root)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.allows_read(path)
    }
}
struct Fixture {
    _project: tempfile::TempDir,
    state: tempfile::TempDir,
    store: Arc<LocalMemoryStore>,
    access: Arc<Access>,
}
fn fixture(populated: bool) -> Fixture {
    let project = tempfile::tempdir_in("/dev/shm").unwrap();
    let state = tempfile::tempdir().unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(state.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let store = Arc::new(LocalMemoryStore::open(state.path()).unwrap());
    store.initialize().unwrap();
    let root = fs::canonicalize(project.path()).unwrap();
    if populated {
        for file in render_template(
            json!({"project_name":"Worker fixture","created_at":"2026-10-28"})
                .as_object()
                .unwrap(),
        )
        .unwrap()
        .into_iter()
        .filter(|file| file.path.starts_with(".voktty/"))
        {
            let path = root.join(file.path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, file.text).unwrap();
        }
    }
    Fixture {
        _project: project,
        state,
        store,
        access: Arc::new(Access {
            root,
            allowed: AtomicBool::new(true),
            thread: Mutex::new(None),
        }),
    }
}
fn runtime() -> Runtime {
    Builder::new_current_thread().enable_time().build().unwrap()
}

#[test]
fn actual_scope_discovery_runs_off_the_async_thread_without_creating_memory_or_policy() {
    let f = fixture(false);
    let original = fs::read(f.state.path().join("memory-local.json")).unwrap();
    let caller = std::thread::current().id();
    runtime().block_on(async {
        let scope = MemoryWorkers::default()
            .scope(
                f.store.clone(),
                f.access.root.clone(),
                f.access.clone(),
                DiscoveryPurpose::Initialize,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(scope.facts["ancestors"][0]["state"], "absent");
        assert!(scope.scope.ancestry_complete);
        assert_eq!(scope.scope.descendants_complete, Some(true));
        assert_eq!(scope.scope.initialization, "clear");
    });
    assert_ne!(f.access.thread.lock().unwrap().unwrap(), caller);
    assert!(!f.access.root.join(".voktty").exists());
    assert_eq!(
        fs::read(f.state.path().join("memory-local.json")).unwrap(),
        original
    );
}

#[test]
fn actual_context_uses_the_owned_source_and_never_caches_replaced_instruction_bytes() {
    let first = fixture(true);
    let second = fixture(true);
    fs::write(
        first.access.root.join(".voktty/PROJECT.md"),
        "first project",
    )
    .unwrap();
    fs::write(
        second.access.root.join(".voktty/PROJECT.md"),
        "second project",
    )
    .unwrap();
    runtime().block_on(async {
        let workers = MemoryWorkers::default();
        let read = |f: &Fixture| workers.context(f.store.clone(), f.access.root.clone(), f.access.clone(), None, ReadControl::default()).unwrap();
        let a = read(&first).finish().await.unwrap();
        let b = read(&second).finish().await.unwrap();
        assert_ne!(a.project_key, b.project_key);
        assert!(matches!(&a.project, voktty_workspace_kit::PathFact::File { text } if text == "first project"));
        assert!(matches!(&b.project, voktty_workspace_kit::PathFact::File { text } if text == "second project"));
        fs::write(first.access.root.join(".voktty/INIT.md"), "changed instructions").unwrap();
        let changed = read(&first).finish().await.unwrap();
        assert_ne!(changed.fingerprint.digest, a.fingerprint.digest);
        assert_eq!(changed.project_key, a.project_key);
    });
}

#[test]
fn denied_and_invalid_requests_never_become_empty_success_or_authorize_the_source() {
    let f = fixture(true);
    let workers = MemoryWorkers::default();
    assert!(matches!(
        workers.scope(
            f.store.clone(),
            PathBuf::from("remote://unresolved/project"),
            f.access.clone(),
            DiscoveryPurpose::Discover,
            DiscoveryControl::default(),
        ),
        Err(MemoryWorkError::Read(ReadError::InvalidInput))
    ));
    assert!(matches!(
        workers.context(
            f.store.clone(),
            f.access.root.clone(),
            f.access.clone(),
            Some("x".repeat(257)),
            ReadControl::default(),
        ),
        Err(MemoryWorkError::Read(ReadError::Limit))
    ));
    assert!(f.access.thread.lock().unwrap().is_none());
    f.access.allowed.store(false, Ordering::SeqCst);
    runtime().block_on(async {
        let result = workers
            .scope(
                f.store.clone(),
                f.access.root.clone(),
                f.access.clone(),
                DiscoveryPurpose::Discover,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await;
        assert!(matches!(
            result,
            Err(MemoryWorkError::Read(ReadError::Denied))
        ));
    });
    assert!(!f.access.allowed.load(Ordering::SeqCst));
}
