use super::*;
use crate::modules::project_memory::tests::{project, runtime};
use serde_json::json;
use std::fs;
use std::sync::{mpsc, Condvar};
use std::time::Duration;
use voktty_memory_local::ProjectPreference;

struct Fixture {
    _project: tempfile::TempDir,
    _parent: tempfile::TempDir,
    root: PathBuf,
    registry: WorkspaceRegistry,
    store: Arc<LocalMemoryStore>,
    app: NativeMemoryApplication,
    window: Arc<NativeMemoryWindow>,
    presentation: NativeMemoryPresentationReceipt,
    selected: NativeMemorySelectionReceipt,
}
fn fixture() -> Fixture {
    use std::os::unix::fs::PermissionsExt;
    let project = project();
    let parent = tempfile::tempdir().unwrap();
    fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let store =
        Arc::new(LocalMemoryStore::create_private(parent.path(), &ReadControl::default()).unwrap());
    store.initialize().unwrap();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(project.path()).unwrap();
    registry.authorize("/dev").unwrap();
    for file in voktty_workspace_kit::render_template(
        json!({"project_name":"Native policy", "created_at":"2026-10-29"})
            .as_object()
            .unwrap(),
    )
    .unwrap()
    {
        if file.path.starts_with(".voktty/") {
            let path = root.join(file.path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, file.text).unwrap();
        }
    }
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
        _parent: parent,
        root,
        registry,
        store,
        app,
        window,
        presentation,
        selected,
    }
}
fn reserve(f: &Fixture) -> NativeMemoryPolicyReservation {
    f.app
        .reserve_policy(
            &f.window,
            &f.presentation,
            &f.selected,
            DiscoveryControl::default(),
        )
        .unwrap()
}
async fn review(
    f: &Fixture,
    reserved: &NativeMemoryPolicyReservation,
    policy: MemoryPolicy,
) -> NativeMemoryPolicyReview {
    let store = f
        .app
        .open_policy_store(&f.window, &f.presentation, &f.selected, reserved)
        .await
        .unwrap();
    f.app
        .review_policy(
            &f.window,
            &f.presentation,
            &f.selected,
            reserved,
            store,
            policy,
        )
        .unwrap()
        .finish()
        .await
        .unwrap()
}
fn cancelled<T>(result: &Result<T, MemoryPolicyError>) -> bool {
    matches!(
        result,
        Err(MemoryPolicyError::Worker(MemoryWorkError::Read(
            ReadError::Cancelled
        )))
    )
}

#[test]
fn native_policy_uses_original_choice_not_mutable_display_and_only_returns_its_project() {
    let f = fixture();
    f.store
        .set_policy(0, &"a".repeat(64), MemoryPolicy::Never)
        .unwrap();
    runtime().block_on(async {
        let reserved = reserve(&f);
        let review = review(&f, &reserved, MemoryPolicy::Always).await;
        let mut display = review.snapshot(&reserved).unwrap();
        assert_eq!(display.root, f.root);
        assert_eq!(display.preference, None);
        assert_eq!(f.store.load().unwrap().revision(), 1);
        let key = display.project_key.clone();
        display.project_key = "forged".into();
        display.policy = MemoryPolicy::Never;
        let result = f
            .app
            .accept_policy(
                &f.window,
                &f.presentation,
                &f.selected,
                review,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(
            result,
            ProjectPreference {
                project_key: key.clone(),
                policy: MemoryPolicy::Always,
                instruction_digest: None
            }
        );
        let snapshot = f.store.load().unwrap();
        assert_eq!(snapshot.project(&key).unwrap(), &result);
        assert_eq!(
            snapshot.project(&"a".repeat(64)).unwrap().policy,
            MemoryPolicy::Never
        );
    });
}

#[test]
fn new_reservation_retires_old_reviews_and_stale_cancel_cannot_cancel_a_successor() {
    let f = fixture();
    runtime().block_on(async {
        let old = reserve(&f);
        let artifact = review(&f, &old, MemoryPolicy::Always).await;
        let current = reserve(&f);
        assert!(!old.is_live());
        assert!(current.is_live());
        assert!(cancelled(&artifact.snapshot(&old)));
        assert!(cancelled(&f.app.accept_policy(
            &f.window,
            &f.presentation,
            &f.selected,
            artifact,
            DiscoveryControl::default()
        )));
        assert!(!f
            .app
            .cancel_policy(&f.window, &f.presentation, &f.selected, &old)
            .unwrap());
        let artifact = review(&f, &current, MemoryPolicy::Never).await;
        assert!(f
            .app
            .cancel_policy(&f.window, &f.presentation, &f.selected, &current)
            .unwrap());
        assert!(!current.is_live());
        assert!(cancelled(&f.app.accept_policy(
            &f.window,
            &f.presentation,
            &f.selected,
            artifact,
            DiscoveryControl::default()
        )));
        assert_eq!(f.store.load().unwrap().revision(), 0);
    });
}

#[test]
fn a_reservation_starts_once_and_foreign_presentations_cannot_accept_it() {
    let f = fixture();
    runtime().block_on(async {
        let reserved = reserve(&f);
        let artifact = review(&f, &reserved, MemoryPolicy::Always).await;
        assert!(cancelled(&f.app.review_policy(
            &f.window,
            &f.presentation,
            &f.selected,
            &reserved,
            f.store.clone(),
            MemoryPolicy::Never
        )));
        assert!(cancelled(
            &f.app
                .open_policy_store(&f.window, &f.presentation, &f.selected, &reserved)
                .await
        ));
        let other = f.app.open_presentation(&f.window).unwrap();
        let selected = f
            .app
            .select(
                &f.window,
                &other,
                &f.registry,
                f.root.clone(),
                &WorkspaceEnv::Local,
            )
            .unwrap();
        assert!(cancelled(&f.app.accept_policy(
            &f.window,
            &other,
            &selected,
            artifact,
            DiscoveryControl::default()
        )));
        assert!(reserved.is_live());
        assert_eq!(f.store.load().unwrap().revision(), 0);
    });
}

#[test]
fn selection_round_trip_window_and_application_retirement_reject_owned_policy_artifacts() {
    for change in 0..4 {
        let f = fixture();
        runtime().block_on(async {
            let reserved = reserve(&f);
            let artifact = review(&f, &reserved, MemoryPolicy::Always).await;
            match change {
                0 => {
                    f.app
                        .select(
                            &f.window,
                            &f.presentation,
                            &f.registry,
                            f.root.clone(),
                            &WorkspaceEnv::Local,
                        )
                        .unwrap();
                }
                1 => {
                    f.app
                        .close_presentation(&f.window, &f.presentation)
                        .unwrap();
                }
                2 => f.window.retire(),
                _ => f.app.shutdown(),
            }
            assert!(!reserved.is_live());
            assert!(cancelled(&artifact.snapshot(&reserved)));
            assert!(cancelled(&f.app.accept_policy(
                &f.window,
                &f.presentation,
                &f.selected,
                artifact,
                DiscoveryControl::default()
            )));
            assert_eq!(f.store.load().unwrap().revision(), 0);
        });
    }
}

#[test]
fn queued_store_opening_and_acceptance_cancel_with_their_exact_native_reservation() {
    for writing in [false, true] {
        let f = fixture();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .max_blocking_threads(1)
            .build()
            .unwrap();
        runtime.block_on(async {
            let reserved = reserve(&f);
            let artifact = if writing {
                Some(review(&f, &reserved, MemoryPolicy::Always).await)
            } else {
                None
            };
            let gate = Arc::new((Mutex::new(false), Condvar::new()));
            let held = gate.clone();
            let (started, observed) = mpsc::channel();
            let blocker = tokio::task::spawn_blocking(move || {
                started.send(()).unwrap();
                let (released, timeout) = held
                    .1
                    .wait_timeout_while(
                        held.0.lock().unwrap(),
                        Duration::from_secs(3),
                        |released| !*released,
                    )
                    .unwrap();
                assert!(*released && !timeout.timed_out());
            });
            observed.recv_timeout(Duration::from_secs(3)).unwrap();
            if let Some(artifact) = artifact {
                let job = f
                    .app
                    .accept_policy(
                        &f.window,
                        &f.presentation,
                        &f.selected,
                        artifact,
                        DiscoveryControl::default(),
                    )
                    .unwrap();
                f.app
                    .cancel_policy(&f.window, &f.presentation, &f.selected, &reserved)
                    .unwrap();
                *gate.0.lock().unwrap() = true;
                gate.1.notify_all();
                blocker.await.unwrap();
                assert!(cancelled(&job.finish().await));
            } else {
                let mut opening = Box::pin(f.app.open_policy_store(
                    &f.window,
                    &f.presentation,
                    &f.selected,
                    &reserved,
                ));
                tokio::select! {
                    biased;
                    _ = &mut opening => panic!("queued store completed before release"),
                    _ = tokio::task::yield_now() => {}
                }
                let successor = reserve(&f);
                *gate.0.lock().unwrap() = true;
                gate.1.notify_all();
                blocker.await.unwrap();
                assert!(cancelled(&opening.await));
                assert!(successor.is_live());
            }
        });
        assert_eq!(f.store.load().unwrap().revision(), 0);
    }
}
