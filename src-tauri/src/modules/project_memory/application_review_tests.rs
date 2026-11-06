use super::*;
use crate::modules::project_memory::tests::{project, runtime};
use serde_json::json;
use std::fs;
use std::sync::{mpsc, Condvar};
use std::time::Duration;
use voktty_memory_local::{PublicationError, ReadControl};
use voktty_workspace_kit::RootLinks;

#[path = "application_recovery_tests.rs"]
mod recovery;

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
    let (app, window) = NativeMemoryApplication::test_origin();
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
fn values() -> NativeMemoryPreviewValues {
    NativeMemoryPreviewValues {
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
    let prepared = f
        .app
        .start_preview(&f.window, &f.presentation, &f.selected, &reserved, values())
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
    fn allows_remove_staging(&self, path: &Path) -> bool {
        path == self
            .root
            .join(voktty_memory_local::PROJECT_INITIALIZATION_RECORD)
    }
}
fn writer(f: &Fixture) -> Arc<Writer> {
    Arc::new(Writer {
        root: f.root.clone(),
        gate: Mutex::new(None),
    })
}

#[test]
fn window_review_preserves_the_original_plan_and_existing_preferences() {
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
        assert_eq!(report.created.len(), expected.len() + 1);
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
        let (foreign, foreign_window) = NativeMemoryApplication::test_origin();
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
                values(),
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
            .start_preview(&replacement, &presentation, &selected, &review, values())
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
fn reservation_start_is_once_and_replacement_retires_the_old_result() {
    let f = fixture();
    runtime().block_on(async {
        let reserved = reserve(&f);
        let read = f
            .app
            .start_preview(&f.window, &f.presentation, &f.selected, &reserved, values())
            .unwrap();
        assert!(cancelled(&f.app.start_preview(
            &f.window,
            &f.presentation,
            &f.selected,
            &reserved,
            values()
        )));
        let prepared = read.finish().await.unwrap();
        let successor = reserve(&f);
        assert!(cancelled(&f.app.accept_preview(
            &f.window,
            &f.presentation,
            &f.selected,
            prepared
        )));
        assert!(!f
            .app
            .cancel_preview(&f.window, &f.presentation, &f.selected, &reserved)
            .unwrap());
        assert!(f
            .app
            .is_preview_current(&f.window, &f.presentation, &f.selected, &successor));
        assert!(!f.root.join(".voktty").exists());
    });
}

#[test]
fn expired_reservation_rejects_start_without_project_io() {
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
                .start_preview(&f.window, &f.presentation, &f.selected, &reserved, values()),
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
fn unusable_application_storage_does_not_block_publication_reuse_or_link_only_repair() {
    let f = fixture();
    let origin = parent();
    let blocked = origin.path().join("not-a-directory");
    fs::write(&blocked, "global storage sentinel").unwrap();
    let (app, window) = NativeMemoryApplication::test_origin();
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
    runtime().block_on(async {
        for cycle in 0..3 {
            if cycle == 1 {
                fs::write(f.root.join(".voktty/CONTEXT.md"), "Current project facts\n").unwrap();
                fs::remove_file(f.root.join("AGENTS.md")).unwrap();
            }
            let reserved = app
                .reserve_preview(&window, &presentation, &selected, &f.registry, target(&f))
                .unwrap();
            let mut input = values();
            input.links = RootLinks {
                agents: true,
                claude: true,
            };
            let prepared = app
                .start_preview(&window, &presentation, &selected, &reserved, input)
                .unwrap()
                .finish()
                .await
                .unwrap();
            let ready = app
                .accept_preview(&window, &presentation, &selected, prepared)
                .unwrap();
            let report = app
                .confirm_preview(
                    &window,
                    &presentation,
                    &selected,
                    &ready,
                    &f.registry,
                    DiscoveryControl::default(),
                )
                .unwrap()
                .finish()
                .await
                .unwrap();
            if cycle == 1 {
                assert!(report.created.contains(&"AGENTS.md".to_owned()));
                assert!(!report.created.contains(&".voktty/RULES.md".to_owned()));
            }
            if cycle == 2 {
                assert!(report.created.is_empty());
            }
            assert!(f.root.join("AGENTS.md").is_file());
            assert!(!f
                .root
                .join(voktty_memory_local::PROJECT_INITIALIZATION_RECORD)
                .exists());
            assert_eq!(
                fs::read_to_string(&blocked).unwrap(),
                "global storage sentinel"
            );
            if cycle > 0 {
                assert_eq!(
                    fs::read_to_string(f.root.join(".voktty/CONTEXT.md")).unwrap(),
                    "Current project facts\n"
                );
            }
        }
    });
}

#[test]
fn presentation_close_retires_queued_project_preview_before_io() {
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
        let read = f
            .app
            .start_preview(&f.window, &f.presentation, &f.selected, &reserved, values())
            .unwrap();
        f.app
            .close_presentation(&f.window, &f.presentation)
            .unwrap();
        drop(release);
        occupied.await.unwrap();
        assert!(cancelled(&read.finish().await));
        assert!(!f.root.join(".voktty").exists());
    });
}

#[test]
fn native_resource_close_preserves_the_unfinished_project_record() {
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
        assert!(f.store.try_lock_deployment().is_ok());
        assert!(f
            .root
            .join(voktty_memory_local::PROJECT_INITIALIZATION_RECORD)
            .exists());
        drop(release);
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
            .start_preview(&f.window, &f.presentation, &f.selected, &reserved, values())
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
