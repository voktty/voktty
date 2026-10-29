use super::*;
use crate::modules::project_memory::tests::{project, runtime};
use serde_json::json;
use std::fs;
use std::sync::{mpsc, Condvar};
use std::time::Duration;
use voktty_memory_local::{PublicationError, StoreError};
use voktty_workspace_kit::RootLinks;

struct Fixture {
    _project: tempfile::TempDir,
    parent: tempfile::TempDir,
    root: PathBuf,
    registry: WorkspaceRegistry,
    store: Arc<LocalMemoryStore>,
    app: NativeMemoryApplication,
    window: Arc<NativeMemoryWindow>,
    presentation: NativeMemoryPresentationReceipt,
    selected: NativeMemorySelectionReceipt,
}
fn parent() -> tempfile::TempDir {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
    directory
}
fn fixture() -> Fixture {
    let project = project();
    let parent = parent();
    let store =
        Arc::new(LocalMemoryStore::create_private(parent.path(), &ReadControl::default()).unwrap());
    store.initialize().unwrap();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(project.path()).unwrap();
    registry.authorize("/dev").unwrap();
    let (app, window) = NativeMemoryApplication::test_origin(NativeMemoryStorage::test_origin(
        parent.path().to_owned(),
    ));
    let presentation = app.open_presentation(&window).unwrap();
    let selected = app
        .select(
            &window,
            &presentation,
            &registry,
            root.clone(),
            &WorkspaceEnv::Local,
        )
        .unwrap();
    Fixture {
        _project: project,
        parent,
        root,
        registry,
        store,
        app,
        window,
        presentation,
        selected,
    }
}
fn target(f: &Fixture) -> NativeMemoryPreviewTarget {
    NativeMemoryPreviewTarget {
        destination: f.root.clone(),
        environment: WorkspaceEnv::Local,
        control: DiscoveryControl::default(),
    }
}
fn values(store: Arc<LocalMemoryStore>) -> NativeMemoryPreviewValues {
    NativeMemoryPreviewValues {
        store,
        inputs: json!({"project_name":"Window review", "created_at":"2026-10-29"})
            .as_object()
            .unwrap()
            .clone(),
        links: RootLinks::default(),
    }
}
fn reserve(f: &Fixture) -> NativeMemoryPreviewReceipt {
    f.app
        .reserve_preview(
            &f.window,
            &f.presentation,
            &f.selected,
            &f.registry,
            target(f),
        )
        .unwrap()
}
async fn prepare(f: &Fixture) -> NativeMemoryPreviewReceipt {
    let reserved = reserve(f);
    let store = f
        .app
        .open_preview_store(&f.window, &f.presentation, &f.selected, &reserved)
        .await
        .unwrap();
    let prepared = f
        .app
        .start_preview(
            &f.window,
            &f.presentation,
            &f.selected,
            &reserved,
            values(store),
        )
        .unwrap()
        .finish()
        .await
        .unwrap();
    f.app
        .accept_preview(&f.window, &f.presentation, &f.selected, prepared)
        .unwrap()
}
fn cancelled<T>(result: &Result<T, MemoryDeploymentWorkError>) -> bool {
    matches!(
        result,
        Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(
            ReadError::Cancelled
        )))
    )
}

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
        let (guard, timeout) = self
            .wake
            .wait_timeout_while(
                self.released.lock().unwrap(),
                Duration::from_secs(3),
                |released| !*released,
            )
            .unwrap();
        drop(guard);
        assert!(!timeout.timed_out(), "window review gate was not released");
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
struct Writer {
    root: PathBuf,
    gate: Mutex<Option<(Arc<Gate>, mpsc::Sender<()>)>>,
}
impl MemoryWriteAccess for Writer {
    fn allows_create(&self, path: &Path) -> bool {
        if !path.starts_with(&self.root) {
            return false;
        }
        if path.ends_with("RULES.md") && self.root.join(".voktty/INIT.md").exists() {
            let gate = self.gate.lock().unwrap().take();
            if let Some((gate, started)) = gate {
                started.send(()).unwrap();
                gate.wait();
            }
        }
        true
    }
}
fn writer(f: &Fixture) -> Arc<Writer> {
    Arc::new(Writer {
        root: f.root.clone(),
        gate: Mutex::new(None),
    })
}

#[test]
fn window_review_store_and_snapshot_preserve_the_original_accepted_plan() {
    let f = fixture();
    let before = f.store.load().unwrap();
    runtime().block_on(async {
        let review = prepare(&f).await;
        let mut snapshot = f
            .app
            .preview_snapshot(&f.window, &f.presentation, &f.selected, &review)
            .unwrap();
        assert!(!snapshot.is_resuming);
        assert!(snapshot.recovery_files.is_empty());
        assert_eq!(snapshot.publication_blocker, None);
        let expected = snapshot.deployment.plan.entries.clone();
        snapshot.deployment.plan.entries[0].proposed = "forged display bytes".into();
        assert!(!f.root.join(".voktty").exists());
        let publication = f
            .app
            .publish_preview(
                &f.window,
                &f.presentation,
                &f.selected,
                &review,
                writer(&f),
                DiscoveryControl::default(),
            )
            .unwrap();
        assert!(cancelled(&f.app.publish_preview(
            &f.window,
            &f.presentation,
            &f.selected,
            &review,
            writer(&f),
            DiscoveryControl::default()
        )));
        let report = publication.finish().await.unwrap();
        assert_eq!(report.created.len(), expected.len());
        assert_eq!(report.created.last().unwrap(), ".voktty/kit.json");
        for entry in expected {
            assert_eq!(
                fs::read_to_string(f.root.join(entry.path)).unwrap(),
                entry.proposed
            );
        }
        assert!(f
            .app
            .is_preview_current(&f.window, &f.presentation, &f.selected, &review));
        assert!(f
            .app
            .cancel_preview(&f.window, &f.presentation, &f.selected, &review)
            .unwrap());
        assert!(!f
            .app
            .is_preview_current(&f.window, &f.presentation, &f.selected, &review));
    });
    assert_eq!(f.store.load().unwrap(), before);
}

#[test]
fn foreign_application_window_and_presentation_cannot_borrow_a_review() {
    let f = fixture();
    runtime().block_on(async {
        let review = prepare(&f).await;
        let (foreign, foreign_window) = NativeMemoryApplication::test_origin(
            NativeMemoryStorage::test_origin(f.parent.path().to_owned()),
        );
        assert!(cancelled(&foreign.preview_snapshot(
            &f.window,
            &f.presentation,
            &f.selected,
            &review
        )));
        assert!(cancelled(&f.app.preview_snapshot(
            &foreign_window,
            &f.presentation,
            &f.selected,
            &review
        )));
        assert!(cancelled(&f.app.reserve_preview(
            &foreign_window,
            &f.presentation,
            &f.selected,
            &f.registry,
            target(&f)
        )));
        assert!(cancelled(&f.app.cancel_preview(
            &foreign_window,
            &f.presentation,
            &f.selected,
            &review
        )));
        assert!(cancelled(&f.app.publish_preview(
            &foreign_window,
            &f.presentation,
            &f.selected,
            &review,
            writer(&f),
            DiscoveryControl::default()
        )));
        let other_window = f.app.register_window("other").unwrap();
        let other_presentation = f.app.open_presentation(&other_window).unwrap();
        assert!(cancelled(&f.app.reserve_preview(
            &f.window,
            &other_presentation,
            &f.selected,
            &f.registry,
            target(&f)
        )));
        assert!(cancelled(&f.app.preview_snapshot(
            &other_window,
            &f.presentation,
            &f.selected,
            &review
        )));
        assert!(f
            .app
            .is_preview_current(&f.window, &f.presentation, &f.selected, &review));
    });
}

#[test]
fn a_same_label_window_replacement_rejects_old_prepared_results_and_cleanup() {
    let f = fixture();
    runtime().block_on(async {
        let reservation = reserve(&f);
        let old = f
            .app
            .start_preview(
                &f.window,
                &f.presentation,
                &f.selected,
                &reservation,
                values(f.store.clone()),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        let replacement = f.app.register_window("main").unwrap();
        let presentation = f.app.open_presentation(&replacement).unwrap();
        let selected = f
            .app
            .select(
                &replacement,
                &presentation,
                &f.registry,
                f.root.clone(),
                &WorkspaceEnv::Local,
            )
            .unwrap();
        let review = f
            .app
            .reserve_preview(
                &replacement,
                &presentation,
                &selected,
                &f.registry,
                target(&f),
            )
            .unwrap();
        assert!(cancelled(&f.app.accept_preview(
            &f.window,
            &f.presentation,
            &f.selected,
            old
        )));
        assert!(cancelled(&f.app.cancel_preview(
            &f.window,
            &f.presentation,
            &f.selected,
            &reservation
        )));
        f.window.observe(&WindowEvent::Destroyed);
        assert!(f
            .app
            .is_preview_current(&replacement, &presentation, &selected, &review));
        let prepared = f
            .app
            .start_preview(
                &replacement,
                &presentation,
                &selected,
                &review,
                values(f.store.clone()),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        f.app
            .accept_preview(&replacement, &presentation, &selected, prepared)
            .unwrap();
        assert!(f
            .app
            .preview_snapshot(&replacement, &presentation, &selected, &review)
            .is_ok());
    });
}

#[test]
fn reserving_a_new_review_retires_acceptance_before_private_store_is_opened() {
    let f = fixture();
    runtime().block_on(async {
        let old = prepare(&f).await;
        let reserved = reserve(&f);
        assert!(cancelled(&f.app.publish_preview(
            &f.window,
            &f.presentation,
            &f.selected,
            &old,
            writer(&f),
            DiscoveryControl::default()
        )));
        assert!(cancelled(&f.app.preview_snapshot(
            &f.window,
            &f.presentation,
            &f.selected,
            &reserved
        )));
        assert!(!f
            .app
            .cancel_preview(&f.window, &f.presentation, &f.selected, &old)
            .unwrap());
        let opened = f
            .app
            .open_preview_store(&f.window, &f.presentation, &f.selected, &reserved)
            .await
            .unwrap();
        let successor = reserve(&f);
        assert!(cancelled(&f.app.start_preview(
            &f.window,
            &f.presentation,
            &f.selected,
            &reserved,
            values(opened)
        )));
        assert!(f
            .app
            .is_preview_current(&f.window, &f.presentation, &f.selected, &successor));
        assert!(!f.root.join(".voktty").exists());
    });
}

#[test]
fn reservation_start_is_once_and_new_state_cannot_reopen_the_private_store() {
    let f = fixture();
    runtime().block_on(async {
        let reserved = reserve(&f);
        let read = f
            .app
            .start_preview(
                &f.window,
                &f.presentation,
                &f.selected,
                &reserved,
                values(f.store.clone()),
            )
            .unwrap();
        assert!(cancelled(&f.app.start_preview(
            &f.window,
            &f.presentation,
            &f.selected,
            &reserved,
            values(f.store.clone())
        )));
        assert!(cancelled(
            &f.app
                .open_preview_store(&f.window, &f.presentation, &f.selected, &reserved)
                .await
        ));
        let prepared = read.finish().await.unwrap();
        f.app
            .accept_preview(&f.window, &f.presentation, &f.selected, prepared)
            .unwrap();
        assert!(f
            .app
            .preview_snapshot(&f.window, &f.presentation, &f.selected, &reserved)
            .is_ok());
    });
}

#[test]
fn expired_reservation_does_not_open_state_or_renew_the_preview_deadline() {
    let f = fixture();
    runtime().block_on(async {
        let mut expired = target(&f);
        expired.control = DiscoveryControl::new(Duration::ZERO);
        let reserved = f
            .app
            .reserve_preview(
                &f.window,
                &f.presentation,
                &f.selected,
                &f.registry,
                expired,
            )
            .unwrap();
        assert!(matches!(
            f.app
                .open_preview_store(&f.window, &f.presentation, &f.selected, &reserved)
                .await,
            Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(
                ReadError::Timeout
            )))
        ));
        assert!(matches!(
            f.app.start_preview(
                &f.window,
                &f.presentation,
                &f.selected,
                &reserved,
                values(f.store.clone())
            ),
            Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(
                ReadError::Timeout
            )))
        ));
        assert!(!f
            .app
            .is_preview_current(&f.window, &f.presentation, &f.selected, &reserved));
        assert!(!f.root.join(".voktty").exists());
    });
}

#[test]
fn opening_missing_private_state_never_initializes_a_directory_or_identity() {
    let f = fixture();
    let empty = parent();
    let (app, window) = NativeMemoryApplication::test_origin(NativeMemoryStorage::test_origin(
        empty.path().to_owned(),
    ));
    let presentation = app.open_presentation(&window).unwrap();
    let selected = app
        .select(
            &window,
            &presentation,
            &f.registry,
            f.root.clone(),
            &WorkspaceEnv::Local,
        )
        .unwrap();
    let reserved = app
        .reserve_preview(&window, &presentation, &selected, &f.registry, target(&f))
        .unwrap();
    runtime().block_on(async {
        assert!(app
            .open_preview_store(&window, &presentation, &selected, &reserved)
            .await
            .is_err());
    });
    assert_eq!(fs::read_dir(empty.path()).unwrap().count(), 0);
    assert!(!f.root.join(".voktty").exists());
}

#[test]
fn presentation_close_retires_queued_private_state_reads_before_they_start() {
    let f = fixture();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    let gate = Arc::new(Gate::new());
    let release = Release(gate.clone());
    runtime.block_on(async {
        let reserved = reserve(&f);
        let (started, observed) = mpsc::channel();
        let occupied = tokio::task::spawn_blocking(move || {
            started.send(()).unwrap();
            gate.wait();
        });
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        let mut read =
            Box::pin(
                f.app
                    .open_preview_store(&f.window, &f.presentation, &f.selected, &reserved),
            );
        tokio::select! {
            biased;
            _ = &mut read => panic!("blocked state read completed before gate release"),
            _ = tokio::task::yield_now() => {}
        }
        assert!(f
            .app
            .close_presentation(&f.window, &f.presentation)
            .unwrap());
        drop(release);
        occupied.await.unwrap();
        assert!(cancelled(&read.await));
        assert!(!f.root.join(".voktty").exists());
    });
}

#[test]
fn reservation_retirement_cancels_its_already_captured_state_phase() {
    let f = fixture();
    let old = reserve(&f);
    let phase = f
        .app
        .with_deployment(&f.window, |owners, window| {
            owners.preview_store_control(window, &f.presentation, &f.selected, &old)
        })
        .unwrap();
    let current = reserve(&f);
    assert!(matches!(
        MemoryWorkers::default().context(
            f.store.clone(),
            f.root.clone(),
            Arc::new(NoRead),
            None,
            phase
        ),
        Err(MemoryWorkError::Read(ReadError::Cancelled))
    ));
    assert!(f
        .app
        .is_preview_current(&f.window, &f.presentation, &f.selected, &current));
}
struct NoRead;
impl MemoryReadAccess for NoRead {
    fn allows_metadata(&self, _: &Path) -> bool {
        panic!("cancelled private-state phase reached IO")
    }
    fn allows_read(&self, _: &Path) -> bool {
        panic!("cancelled private-state phase reached IO")
    }
}

#[test]
fn native_resource_close_retires_publication_without_releasing_its_lock_early() {
    let f = fixture();
    let runtime = runtime();
    let gate = Arc::new(Gate::new());
    let release = Release(gate.clone());
    runtime.block_on(async {
        let review = prepare(&f).await;
        let access = writer(&f);
        let (started, observed) = mpsc::channel();
        *access.gate.lock().unwrap() = Some((gate, started));
        let job = f
            .app
            .publish_preview(
                &f.window,
                &f.presentation,
                &f.selected,
                &review,
                access,
                DiscoveryControl::default(),
            )
            .unwrap();
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        let mut resources = tauri::ResourceTable::default();
        let id = resources.add_arc(f.window.clone());
        resources.close(id).unwrap();
        assert!(cancelled(&job.finish().await));
        assert!(matches!(
            f.store.try_lock_deployment(),
            Err(StoreError::Busy)
        ));
        drop(release);
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                match f.store.try_lock_deployment() {
                    Ok(lock) => {
                        drop(lock);
                        break;
                    }
                    Err(StoreError::Busy) => tokio::time::sleep(Duration::from_millis(1)).await,
                    Err(error) => panic!("unexpected lock error: {error:?}"),
                }
            }
        })
        .await
        .unwrap();
        assert!(!f.root.join(".voktty/kit.json").exists());
        assert!(f.root.join(".voktty/INIT.md").exists());
    });
}

#[test]
fn shutdown_retires_an_admitted_preview_without_delivering_its_result() {
    let f = fixture();
    runtime().block_on(async {
        let reserved = reserve(&f);
        let job = f
            .app
            .start_preview(
                &f.window,
                &f.presentation,
                &f.selected,
                &reserved,
                values(f.store.clone()),
            )
            .unwrap();
        f.app.shutdown();
        assert!(cancelled(&job.finish().await));
        assert!(!f
            .app
            .is_preview_current(&f.window, &f.presentation, &f.selected, &reserved));
        assert!(!f.root.join(".voktty").exists());
    });
}

#[test]
fn late_publication_failure_keeps_its_report_for_the_current_window() {
    struct Denied;
    impl MemoryWriteAccess for Denied {
        fn allows_create(&self, _: &Path) -> bool {
            false
        }
    }
    let f = fixture();
    runtime().block_on(async {
        let review = prepare(&f).await;
        let error = f
            .app
            .publish_preview(
                &f.window,
                &f.presentation,
                &f.selected,
                &review,
                Arc::new(Denied),
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap_err();
        let MemoryDeploymentWorkError::Publication(failure) = error else {
            panic!("publication report required")
        };
        assert_eq!(failure.error, PublicationError::Read(ReadError::Denied));
        assert!(failure.created.is_empty());
        assert!(f
            .app
            .is_preview_current(&f.window, &f.presentation, &f.selected, &review));
        assert!(cancelled(&f.app.preview_snapshot(
            &f.window,
            &f.presentation,
            &f.selected,
            &review
        )));
    });
}
