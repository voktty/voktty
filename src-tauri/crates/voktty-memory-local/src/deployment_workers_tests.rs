use super::*;
use crate::{ReadControl, StoreError};
use serde_json::json;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Condvar, Mutex, MutexGuard};
use std::thread::ThreadId;
use tokio::runtime::{Builder, Runtime};

static FILE_TESTS: Mutex<()> = Mutex::new(());

struct Gate {
    released: Mutex<bool>,
    wake: Condvar,
}
impl Gate {
    fn new() -> Self {
        Self {
            released: Mutex::new(false),
            wake: Condvar::new(),
        }
    }
    fn wait(&self) {
        let (_held, timeout) = self
            .wake
            .wait_timeout_while(
                self.released.lock().unwrap(),
                Duration::from_secs(3),
                |released| !*released,
            )
            .unwrap();
        assert!(
            !timeout.timed_out(),
            "deployment test gate was not released"
        );
    }
    fn release(&self) {
        *self.released.lock().unwrap() = true;
        self.wake.notify_all();
    }
}
struct Release(Arc<Gate>);
impl Drop for Release {
    fn drop(&mut self) {
        self.0.release();
    }
}

struct Access {
    root: PathBuf,
    retired: AtomicBool,
    deny_rules: AtomicBool,
    reads: Mutex<Option<ThreadId>>,
    writes: Mutex<Option<ThreadId>>,
    gate: Mutex<Option<(Arc<Gate>, mpsc::Sender<()>)>>,
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        *self.reads.lock().unwrap() = Some(std::thread::current().id());
        !self.retired.load(Ordering::Acquire)
            && (path.starts_with(&self.root)
                || self.root.ancestors().any(|parent| parent == path)
                || self
                    .root
                    .ancestors()
                    .any(|parent| parent.join(".voktty") == path))
    }
    fn allows_read(&self, path: &Path) -> bool {
        !self.retired.load(Ordering::Acquire) && path.starts_with(&self.root)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.allows_read(path)
    }
}
impl MemoryWriteAccess for Access {
    fn allows_create(&self, path: &Path) -> bool {
        *self.writes.lock().unwrap() = Some(std::thread::current().id());
        if path.ends_with("RULES.md") && self.root.join(".voktty/INIT.md").exists() {
            let gate = self.gate.lock().unwrap().take();
            if let Some((gate, started)) = gate {
                started.send(()).unwrap();
                gate.wait();
            }
            if self.deny_rules.load(Ordering::Acquire) {
                return false;
            }
        }
        self.allows_read(path)
    }
}

struct Fixture {
    _serial: MutexGuard<'static, ()>,
    _project: tempfile::TempDir,
    state: tempfile::TempDir,
    store: Arc<LocalMemoryStore>,
    access: Arc<Access>,
}
fn fixture() -> Fixture {
    use std::os::unix::fs::PermissionsExt;
    let serial = FILE_TESTS.lock().unwrap();
    let project = tempfile::tempdir_in("/dev/shm").unwrap();
    let state = tempfile::tempdir().unwrap();
    fs::set_permissions(state.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let store = Arc::new(LocalMemoryStore::open(state.path()).unwrap());
    store.initialize().unwrap();
    let access = Arc::new(Access {
        root: project.path().to_owned(),
        retired: AtomicBool::new(false),
        deny_rules: AtomicBool::new(false),
        reads: Mutex::new(None),
        writes: Mutex::new(None),
        gate: Mutex::new(None),
    });
    Fixture {
        _serial: serial,
        _project: project,
        state,
        store,
        access,
    }
}
fn request(f: &Fixture) -> MemoryPreviewRequest {
    MemoryPreviewRequest {
        store: f.store.clone(),
        origin: f.access.root.clone(),
        origin_access: f.access.clone(),
        destination: f.access.root.clone(),
        destination_access: f.access.clone(),
        inputs: json!({"project_name":"Deployment worker", "created_at":"2026-10-29"})
            .as_object()
            .unwrap()
            .clone(),
        links: RootLinks::default(),
    }
}
fn workers() -> MemoryWorkers {
    MemoryWorkers {
        active: Arc::new(AtomicUsize::new(0)),
    }
}
fn runtime() -> Runtime {
    Builder::new_current_thread().enable_time().build().unwrap()
}
async fn drain(workers: &MemoryWorkers) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while workers.active.load(Ordering::Acquire) != 0 {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
}
async fn ready<T>(job: &MemoryDeploymentJob<T>) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while job.job.receiver.is_empty() {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
}
async fn preview(f: &Fixture, workers: &MemoryWorkers) -> OwnedInitializationPreview {
    workers
        .preview(request(f), DiscoveryControl::default())
        .unwrap()
        .finish()
        .await
        .unwrap()
}

#[test]
fn exact_preview_and_publication_run_off_thread_without_changing_preferences() {
    let f = fixture();
    let caller = std::thread::current().id();
    let preferences = fs::read(f.state.path().join("memory-local.json")).unwrap();
    fs::create_dir(f.access.root.join("src")).unwrap();
    runtime().block_on(async {
        let workers = workers();
        let mut input = request(&f);
        input.origin = f.access.root.join("src");
        input.links.agents = true;
        let review = workers
            .preview(input, DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(!f.access.root.join(".voktty").exists());
        let expected = review.deployment().plan.entries.clone();
        let report = workers
            .publish(review, f.access.clone(), DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(report.created.len(), expected.len());
        assert_eq!(report.created.last().unwrap(), ".voktty/kit.json");
        for entry in expected {
            assert_eq!(
                fs::read_to_string(f.access.root.join(entry.path)).unwrap(),
                entry.proposed
            );
        }
        assert_eq!(workers.active.load(Ordering::Acquire), 0);
    });
    assert_ne!(f.access.reads.lock().unwrap().unwrap(), caller);
    assert_ne!(f.access.writes.lock().unwrap().unwrap(), caller);
    assert_eq!(
        fs::read(f.state.path().join("memory-local.json")).unwrap(),
        preferences
    );
    assert!(!f.state.path().join("memory-deployment.json").exists());
}

#[test]
fn changed_bytes_and_retired_authorities_remain_typed_publication_failures() {
    for retired in [false, true] {
        let f = fixture();
        runtime().block_on(async {
            let workers = workers();
            let review = preview(&f, &workers).await;
            if retired {
                f.access.retired.store(true, Ordering::Release);
            } else {
                fs::create_dir(f.access.root.join(".voktty")).unwrap();
                fs::write(f.access.root.join(".voktty/INIT.md"), "foreign edit").unwrap();
            }
            let error = workers
                .publish(review, f.access.clone(), DiscoveryControl::default())
                .unwrap()
                .finish()
                .await
                .unwrap_err();
            let MemoryDeploymentWorkError::Publication(failure) = error else {
                panic!("publication failure required")
            };
            assert_eq!(
                failure.error,
                if retired {
                    PublicationError::Read(ReadError::Denied)
                } else {
                    PublicationError::StalePreview
                }
            );
            assert!(failure.created.is_empty());
            assert!(!f.access.root.join(".voktty/kit.json").exists());
            if !retired {
                assert_eq!(
                    fs::read_to_string(f.access.root.join(".voktty/INIT.md")).unwrap(),
                    "foreign edit"
                );
            }
        });
    }
}

#[test]
fn partial_failure_keeps_its_report_and_requires_an_explicit_new_review() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        let review = preview(&f, &workers).await;
        let expected = review.deployment().plan.entries.clone();
        f.access.deny_rules.store(true, Ordering::Release);
        let error = workers
            .publish(review, f.access.clone(), DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap_err();
        let MemoryDeploymentWorkError::Publication(failure) = error else {
            panic!("partial report required")
        };
        assert_eq!(failure.error, PublicationError::Read(ReadError::Denied));
        assert!(failure.created.iter().any(|path| path == ".voktty/INIT.md"));
        assert!(!f.access.root.join(".voktty/kit.json").exists());
        assert!(f.state.path().join("memory-deployment.json").exists());
        f.access.deny_rules.store(false, Ordering::Release);
        let retry = preview(&f, &workers).await;
        assert!(retry.is_resuming());
        workers
            .publish(retry, f.access.clone(), DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        for entry in expected {
            assert_eq!(
                fs::read_to_string(f.access.root.join(entry.path)).unwrap(),
                entry.proposed
            );
        }
        assert!(!f.state.path().join("memory-deployment.json").exists());
    });
}

#[test]
fn preview_contract_errors_are_not_confused_with_worker_failures() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        let mut input = request(&f);
        input
            .inputs
            .insert("kit_version".into(), json!("unreviewed version"));
        assert!(matches!(
            workers
                .preview(input, DiscoveryControl::default())
                .unwrap()
                .finish()
                .await,
            Err(MemoryDeploymentWorkError::Preview(PublicationError::Read(
                ReadError::Contract(_)
            )))
        ));
        assert!(!f.access.root.join(".voktty").exists());
        assert_eq!(workers.active.load(Ordering::Acquire), 0);
    });
}

#[test]
fn unbounded_or_invalid_preview_inputs_are_rejected_before_scheduling() {
    let f = fixture();
    let workers = workers();
    for kind in 0..8 {
        let mut input = request(&f);
        let error = match kind {
            0 => {
                input.origin = PathBuf::from("relative");
                ReadError::InvalidInput
            }
            1 => {
                input.destination = PathBuf::from("relative");
                ReadError::InvalidInput
            }
            2 => {
                input.inputs.insert("project_name".into(), json!(false));
                ReadError::InvalidInput
            }
            3 => {
                input
                    .inputs
                    .insert("project_name".into(), json!("a".repeat(16385)));
                ReadError::Limit
            }
            4 => {
                input.inputs.insert("x".repeat(65), json!("value"));
                ReadError::Limit
            }
            5 => {
                for n in 0..33 {
                    input.inputs.insert(format!("name{n}"), json!("value"));
                }
                ReadError::Limit
            }
            6 => {
                for n in 0..17 {
                    input
                        .inputs
                        .insert(format!("name{n}"), json!("x".repeat(16384)));
                }
                ReadError::Limit
            }
            _ => {
                input.destination = PathBuf::from(format!("/{}", "x".repeat(4096)));
                ReadError::Limit
            }
        };
        assert!(
            matches!(workers.preview(input, DiscoveryControl::default()),
            Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(actual))) if actual == error)
        );
    }
    assert!(f.access.reads.lock().unwrap().is_none());
    assert_eq!(workers.active.load(Ordering::Acquire), 0);
}

#[test]
fn expired_or_cancelled_preview_and_missing_runtime_admit_no_filesystem_work() {
    let f = fixture();
    let workers = workers();
    assert!(matches!(
        workers.preview(request(&f), DiscoveryControl::default()),
        Err(MemoryDeploymentWorkError::Worker(
            MemoryWorkError::RuntimeUnavailable
        ))
    ));
    for cancel in [false, true] {
        let control = if cancel {
            DiscoveryControl::default()
        } else {
            DiscoveryControl::new(Duration::ZERO)
        };
        if cancel {
            control.cancel();
        }
        assert!(matches!(workers.preview(request(&f), control),
            Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(error)))
                if error == if cancel { ReadError::Cancelled } else { ReadError::Timeout }));
    }
    assert!(f.access.reads.lock().unwrap().is_none());
    assert_eq!(workers.active.load(Ordering::Acquire), 0);
}

#[test]
fn ready_previews_hold_shared_capacity_until_consumed_and_cannot_deliver_after_retirement() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        let control = DiscoveryControl::default();
        let job = workers.preview(request(&f), control.clone()).unwrap();
        ready(&job).await;
        assert_eq!(workers.active.load(Ordering::Acquire), 1);
        let mut reads = Vec::new();
        for _ in 0..3 {
            reads.push(
                workers
                    .spawn(Control::Read(ReadControl::default()), || Ok(()))
                    .unwrap(),
            );
        }
        assert_eq!(workers.active.load(Ordering::Acquire), 4);
        assert!(matches!(
            workers.spawn(Control::Read(ReadControl::default()), || Ok(())),
            Err(MemoryWorkError::Read(ReadError::Busy))
        ));
        assert!(matches!(
            workers.preview(request(&f), DiscoveryControl::default()),
            Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(
                ReadError::Busy
            )))
        ));
        control.cancel();
        assert!(matches!(
            job.finish().await,
            Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(
                ReadError::Cancelled
            )))
        ));
        for read in reads {
            read.finish().await.unwrap();
        }
        assert_eq!(workers.active.load(Ordering::Acquire), 0);
    });
    assert!(!f.access.root.join(".voktty").exists());
}

#[test]
fn queued_retired_publication_never_enters_io_and_keeps_its_slot_until_settlement() {
    let runtime = Builder::new_current_thread()
        .enable_time()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    let f = fixture();
    let gate = Arc::new(Gate::new());
    let release = Release(gate.clone());
    runtime.block_on(async {
        let workers = workers();
        let review = preview(&f, &workers).await;
        let (started, observed) = mpsc::channel();
        let occupied = tokio::task::spawn_blocking(move || {
            started.send(()).unwrap();
            gate.wait();
        });
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        let control = DiscoveryControl::default();
        let job = workers
            .publish(review, f.access.clone(), control.clone())
            .unwrap();
        drop(job.finish());
        assert_eq!(
            control.phase(Duration::from_secs(1)).check(),
            Err(ReadError::Cancelled)
        );
        assert_eq!(workers.active.load(Ordering::Acquire), 1);
        drop(release);
        occupied.await.unwrap();
        drain(&workers).await;
        assert!(f.access.writes.lock().unwrap().is_none());
        assert!(!f.access.root.join(".voktty").exists());
        assert!(!f.state.path().join("memory-deployment.json").exists());
    });
}

#[test]
fn response_timeout_retains_publication_lock_and_slot_until_original_io_settles() {
    let runtime = runtime();
    let f = fixture();
    let gate = Arc::new(Gate::new());
    let release = Release(gate.clone());
    runtime.block_on(async {
        let workers = workers();
        let review = preview(&f, &workers).await;
        let (started, observed) = mpsc::channel();
        *f.access.gate.lock().unwrap() = Some((gate, started));
        let job = workers
            .publish(
                review,
                f.access.clone(),
                DiscoveryControl::new(Duration::from_millis(500)),
            )
            .unwrap();
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        assert!(matches!(
            job.finish().await,
            Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(
                ReadError::Timeout
            )))
        ));
        assert_eq!(workers.active.load(Ordering::Acquire), 1);
        assert!(matches!(
            f.store.try_lock_deployment(),
            Err(StoreError::Busy)
        ));
        assert!(f.access.root.join(".voktty/INIT.md").exists());
        drop(release);
        drain(&workers).await;
        let lock = f.store.try_lock_deployment().unwrap();
        drop(lock);
        assert!(!f.access.root.join(".voktty/kit.json").exists());
        assert!(f.state.path().join("memory-deployment.json").exists());
        let retry = preview(&f, &workers).await;
        assert!(retry.is_resuming());
    });
}

#[test]
fn retired_delivery_does_not_turn_completed_publication_into_rollback() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        let review = preview(&f, &workers).await;
        let control = DiscoveryControl::default();
        let job = workers
            .publish(review, f.access.clone(), control.clone())
            .unwrap();
        ready(&job).await;
        assert!(f.access.root.join(".voktty/kit.json").exists());
        control.cancel();
        assert!(matches!(
            job.finish().await,
            Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(
                ReadError::Cancelled
            )))
        ));
        assert_eq!(workers.active.load(Ordering::Acquire), 0);
        let next = preview(&f, &workers).await;
        assert!(next
            .deployment()
            .plan
            .entries
            .iter()
            .all(|entry| entry.action == voktty_workspace_kit::DeploymentAction::Skip));
    });
}
