use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use voktty_memory_local::{
    DiscoveryControl, LocalMemoryStore, LocalMemoryWorkspace, MemoryReadAccess, ReadControl,
    ReadError,
};
use voktty_workspace_kit::render_template;

struct Pause {
    ready: mpsc::Sender<()>,
    release: (Mutex<usize>, Condvar),
    tickets: AtomicUsize,
}
struct Access {
    root: PathBuf,
    denied: Mutex<Option<PathBuf>>,
    reads: Mutex<Vec<PathBuf>>,
    pause: Mutex<Option<Arc<Pause>>>,
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.denied.lock().unwrap().as_deref() != Some(path)
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.allows_metadata(path) && (path.starts_with(&self.root) || self.root.starts_with(path))
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.allows_metadata(path)
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.reads.lock().unwrap().push(path.into());
        if path == self.root.join(".voktty/PROJECT.md") {
            let pause = self.pause.lock().unwrap().clone();
            if let Some(pause) = pause {
                let ticket = pause.tickets.fetch_add(1, Ordering::SeqCst);
                if ticket < 4 {
                    pause.ready.send(()).unwrap();
                    let waited = pause
                        .release
                        .1
                        .wait_timeout_while(
                            pause.release.0.lock().unwrap(),
                            Duration::from_secs(3),
                            |released| *released <= ticket,
                        )
                        .unwrap();
                    assert!(!waited.1.timed_out());
                }
            }
        }
        self.allows_metadata(path)
    }
}
struct Fixture {
    _project: tempfile::TempDir,
    _state: tempfile::TempDir,
    store: LocalMemoryStore,
    access: Access,
}
impl Fixture {
    fn new() -> Self {
        let project = tempfile::tempdir().unwrap();
        let state = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(state.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let store = LocalMemoryStore::open(state.path()).unwrap();
        store.initialize().unwrap();
        let root = std::fs::canonicalize(project.path()).unwrap();
        for file in render_template(
            serde_json::json!({"project_name":"Check", "created_at":"2026-11-01"})
                .as_object()
                .unwrap(),
        )
        .unwrap()
        {
            if file.path.starts_with(".voktty/") {
                let path = root.join(file.path);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, file.text).unwrap();
            }
        }
        Self {
            _project: project,
            _state: state,
            store,
            access: Access {
                root,
                denied: Mutex::new(None),
                reads: Mutex::new(vec![]),
                pause: Mutex::new(None),
            },
        }
    }
    fn open(&self) -> LocalMemoryWorkspace<'_> {
        LocalMemoryWorkspace::open(
            &self.store,
            &self.access.root,
            &self.access,
            &ReadControl::default(),
        )
        .unwrap()
    }
    fn write(&self, path: &str, text: &str) {
        std::fs::write(self.access.root.join(path), text).unwrap();
    }
}

#[test]
fn native_noop_uses_fresh_shared_evidence_and_its_own_clock_without_granting_trust() {
    let f = Fixture::new();
    let workspace = f.open();
    let baseline = workspace
        .observe_shared_preservation(&DiscoveryControl::default())
        .unwrap();
    let first = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let report = workspace
        .check_preservation(&baseline, &DiscoveryControl::default())
        .unwrap();
    let last = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    assert!(report.issues.is_empty(), "{:?}", report.issues);
    assert!((first..=last).contains(&u128::from(report.now_ms)));
    assert_eq!(report.after_days, 30);
    let local = f.store.load().unwrap();
    assert_eq!(local.revision(), 0);
    assert!(local.project(workspace.project_key()).is_none());
}

#[test]
fn native_check_reads_current_files_and_never_accepts_a_callers_old_after_snapshot() {
    let f = Fixture::new();
    f.write(".voktty/CONTEXT.md", "[T-987654321]\n");
    let workspace = f.open();
    let baseline = workspace
        .observe_shared_preservation(&DiscoveryControl::default())
        .unwrap();
    f.write(".voktty/CONTEXT.md", "");
    let report = workspace
        .check_preservation(&baseline, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(report.preservation.missing_live_items, vec!["T-987654321"]);
    assert!(report
        .issues
        .iter()
        .any(|i| i.code == "PRESERVATION_MISSING_LIVE_ITEMS"));
    assert!(report.issues.iter().any(|i| i.code == "LOG_MISSING_SIZES"));
}

#[test]
fn native_configuration_changes_are_reported_even_when_the_new_threshold_is_valid() {
    let f = Fixture::new();
    let workspace = f.open();
    let baseline = workspace
        .observe_shared_preservation(&DiscoveryControl::default())
        .unwrap();
    let path = f.access.root.join(".voktty/kit.json");
    let mut config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    config["archive"]["afterDays"] = 31.into();
    std::fs::write(path, config.to_string()).unwrap();
    let report = workspace
        .check_preservation(&baseline, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(report.after_days, 31);
    assert_eq!(report.protected.changed_files, vec![".voktty/kit.json"]);
    assert!(report
        .issues
        .iter()
        .any(|i| i.code == "PROTECTED_CHANGED_FILES"));
}

#[test]
fn native_configuration_accepts_integral_json_number_spellings() {
    let f = Fixture::new();
    let path = f.access.root.join(".voktty/kit.json");
    let mut config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    config["archive"]["afterDays"] = serde_json::from_str("30.0").unwrap();
    let text = config.to_string();
    assert!(text.contains("\"afterDays\":30.0"));
    let workspace = f.open();
    for spelling in ["30.0", "3e1"] {
        std::fs::write(
            &path,
            text.replace("\"afterDays\":30.0", &format!("\"afterDays\":{spelling}")),
        )
        .unwrap();
        let before = workspace
            .observe_shared_preservation(&DiscoveryControl::default())
            .unwrap();
        let report = workspace
            .check_preservation(&before, &DiscoveryControl::default())
            .unwrap();
        assert_eq!(report.after_days, 30);
        assert!(report.issues.is_empty(), "{:?}", report.issues);
    }
}

#[test]
fn factual_only_and_foreign_root_baselines_cannot_enter_composed_checking() {
    let f = Fixture::new();
    let workspace = f.open();
    let factual = workspace
        .observe_preservation(&DiscoveryControl::default())
        .unwrap();
    f.access.reads.lock().unwrap().clear();
    assert!(matches!(
        workspace.check_preservation(&factual, &DiscoveryControl::default()),
        Err(ReadError::InvalidInput)
    ));
    assert!(f.access.reads.lock().unwrap().is_empty());
    let baseline = workspace
        .observe_shared_preservation(&DiscoveryControl::default())
        .unwrap();
    let other = Fixture::new();
    let other_workspace = LocalMemoryWorkspace::open(
        &f.store,
        &other.access.root,
        &other.access,
        &ReadControl::default(),
    )
    .unwrap();
    assert!(matches!(
        other_workspace.check_preservation(&baseline, &DiscoveryControl::default()),
        Err(ReadError::StaleRoot)
    ));
}

#[test]
fn revoked_cancelled_expired_and_replaced_installations_reject_without_partial_reports() {
    let f = Fixture::new();
    let workspace = f.open();
    let baseline = workspace
        .observe_shared_preservation(&DiscoveryControl::default())
        .unwrap();
    let cancelled = DiscoveryControl::default();
    cancelled.cancel();
    assert!(matches!(
        workspace.check_preservation(&baseline, &cancelled),
        Err(ReadError::Cancelled)
    ));
    assert!(matches!(
        workspace.check_preservation(&baseline, &DiscoveryControl::new(Duration::ZERO)),
        Err(ReadError::Timeout)
    ));
    *f.access.denied.lock().unwrap() = Some(f.access.root.clone());
    assert!(matches!(
        workspace.check_preservation(&baseline, &DiscoveryControl::default()),
        Err(ReadError::Denied)
    ));
    *f.access.denied.lock().unwrap() = None;
    std::fs::remove_file(f._state.path().join("memory-local.json")).unwrap();
    f.store.initialize().unwrap();
    assert!(matches!(
        workspace.check_preservation(&baseline, &DiscoveryControl::default()),
        Err(ReadError::StaleInstallation)
    ));
}

#[test]
fn checks_hold_one_reader_receipt_through_capture_and_composition() {
    let f = Fixture::new();
    let workspace = f.open();
    let baseline = workspace
        .observe_shared_preservation(&DiscoveryControl::default())
        .unwrap();
    let (sender, receiver) = mpsc::channel();
    let pause = Arc::new(Pause {
        ready: sender,
        release: (Mutex::new(0), Condvar::new()),
        tickets: AtomicUsize::new(0),
    });
    *f.access.pause.lock().unwrap() = Some(pause.clone());
    std::thread::scope(|scope| {
        let mut workers = Vec::new();
        let mut ready = true;
        for _ in 0..4 {
            workers.push(
                scope.spawn(|| {
                    workspace.check_preservation(&baseline, &DiscoveryControl::default())
                }),
            );
            if receiver.recv_timeout(Duration::from_secs(3)).is_err() {
                ready = false;
                break;
            }
        }
        let busy = ready
            && matches!(
                workspace.check_preservation(&baseline, &DiscoveryControl::default()),
                Err(ReadError::Busy)
            );
        let mut outcomes = Vec::new();
        for (index, worker) in workers.into_iter().enumerate() {
            *pause.release.0.lock().unwrap() = index + 1;
            pause.release.1.notify_all();
            outcomes.push(worker.join().unwrap());
        }
        assert!(ready && busy);
        for outcome in outcomes {
            assert!(outcome.unwrap().issues.is_empty());
        }
    });
    workspace
        .check_preservation(&baseline, &DiscoveryControl::default())
        .unwrap();
}
