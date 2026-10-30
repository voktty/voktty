use super::*;
use crate::modules::project_memory::tests::{populate, project, runtime};
use std::fs;
use std::sync::{mpsc, Condvar};
use std::time::Duration;

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
    populate(&root);
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
async fn reviewed(f: &Fixture) -> (NativeMemoryTrustReservation, NativeMemoryTrustReview) {
    let reservation = f
        .app
        .reserve_trust(
            &f.window,
            &f.presentation,
            &f.selected,
            DiscoveryControl::default(),
        )
        .unwrap();
    let review = f
        .app
        .review_trust(
            &f.window,
            &f.presentation,
            &f.selected,
            &reservation,
            f.store.clone(),
            None,
        )
        .unwrap()
        .finish()
        .await
        .unwrap();
    (reservation, review)
}
async fn trust(f: &Fixture) {
    let (_, review) = reviewed(f).await;
    f.app
        .accept_trust(
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
}
fn target<'a>(
    f: &'a Fixture,
    context: &'a NativeMemoryContextReceipt,
) -> NativeMemoryContextTarget<'a> {
    NativeMemoryContextTarget {
        context,
        presentation: &f.presentation,
        selected: &f.selected,
    }
}
async fn prepared(f: &Fixture) -> (NativeMemoryContextReceipt, NativeMemoryPreparedContext) {
    let context = f.app.open_context(&f.window).unwrap();
    let (_, review) = reviewed(f).await;
    let prepared = f
        .app
        .bind_context_session(
            &f.window,
            target(f, &context),
            review,
            MemorySessionUse::Enabled,
            DiscoveryControl::default(),
        )
        .unwrap()
        .finish()
        .await
        .unwrap();
    (context, prepared)
}
async fn promote(f: &Fixture) -> NativeMemoryContextReceipt {
    let (context, prepared) = prepared(f).await;
    f.app
        .promote_context(&f.window, target(f, &context), prepared)
        .unwrap();
    context
}
fn cancelled<T>(result: &Result<T, MemoryTrustError>) -> bool {
    matches!(
        result,
        Err(MemoryTrustError::Worker(MemoryWorkError::Read(
            ReadError::Cancelled
        )))
    )
}
async fn packet(
    f: &Fixture,
    context: &NativeMemoryContextReceipt,
) -> voktty_workspace_kit::MemoryContextResult {
    f.app
        .session_context(&f.window, context, DiscoveryControl::default())
        .unwrap()
        .finish()
        .await
        .unwrap()
}
fn reselect(f: &mut Fixture) {
    f.selected = f
        .app
        .select(
            &f.window,
            &f.presentation,
            &f.registry,
            f.root.clone(),
            &WorkspaceEnv::Local,
        )
        .unwrap();
}

#[test]
fn promotion_transfers_exact_source_out_of_panel_without_writing_preferences_or_losing_context() {
    let f = fixture();
    runtime().block_on(async {
        trust(&f).await;
        let before = f.store.load().unwrap();
        let (reserved, review) = reviewed(&f).await;
        let context = f.app.open_context(&f.window).unwrap();
        let prepared = f
            .app
            .bind_context_session(
                &f.window,
                target(&f, &context),
                review,
                MemorySessionUse::Enabled,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        f.app
            .promote_context(&f.window, target(&f, &context), prepared)
            .unwrap();
        assert!(!f.app.is_current(&f.window, &f.presentation, &f.selected));
        assert!(!reserved.is_live());
        assert!(f.app.is_context_current(&f.window, &context));
        assert_eq!(f.app.context_root(&f.window, &context).unwrap(), f.root);
        assert!(f
            .app
            .close_presentation(&f.window, &f.presentation)
            .unwrap());
        let result = packet(&f, &context).await;
        assert!(result.decision.context_allowed);
        assert!(!result.decision.capture_allowed);
        assert!(result.packet.unwrap().text.contains("native project"));
        assert_eq!(f.store.load().unwrap(), before);
        assert!(f.app.close_context(&f.window, &context).unwrap());
        assert!(!f.app.close_context(&f.window, &context).unwrap());
        assert!(!f.app.is_context_current(&f.window, &context));
        assert!(context.identity.upgrade().is_none());
    });
}

#[test]
fn foreign_windows_presentations_and_applications_cannot_promote_or_read_a_context() {
    for foreign_window in [false, true] {
        let f = fixture();
        runtime().block_on(async {
            trust(&f).await;
            let (context, prepared) = prepared(&f).await;
            let other = if foreign_window {
                f.app.register_window("other").unwrap()
            } else {
                f.window.clone()
            };
            let presentation = f.app.open_presentation(&other).unwrap();
            let selected = f
                .app
                .select(
                    &other,
                    &presentation,
                    &f.registry,
                    f.root.clone(),
                    &WorkspaceEnv::Local,
                )
                .unwrap();
            assert!(cancelled(&f.app.promote_context(
                &other,
                NativeMemoryContextTarget {
                    context: &context,
                    presentation: &presentation,
                    selected: &selected
                },
                prepared
            )));
            assert!(f.app.is_current(&f.window, &f.presentation, &f.selected));
            let context = promote(&f).await;
            if foreign_window {
                assert!(cancelled(&f.app.session_context(
                    &other,
                    &context,
                    DiscoveryControl::default()
                )));
                assert!(!f.app.close_context(&other, &context).unwrap());
            }
            let foreign = fixture();
            assert!(cancelled(&foreign.app.session_context(
                &foreign.window,
                &context,
                DiscoveryControl::default()
            )));
            assert!(!foreign.app.is_context_current(&f.window, &context));
            assert!(packet(&f, &context).await.packet.is_some());
        });
    }
}

#[test]
fn selection_and_review_round_trips_cannot_promote_an_old_prepared_binding() {
    for selection_change in [false, true] {
        let mut f = fixture();
        runtime().block_on(async {
            trust(&f).await;
            let (context, old) = prepared(&f).await;
            if selection_change {
                reselect(&mut f);
            } else {
                let _ = reviewed(&f).await;
            }
            assert!(cancelled(&f.app.promote_context(
                &f.window,
                target(&f, &context),
                old
            )));
            assert!(f.app.is_current(&f.window, &f.presentation, &f.selected));
            let context = promote(&f).await;
            assert!(packet(&f, &context).await.packet.is_some());
        });
    }
}

#[test]
fn reselection_and_stale_close_do_not_retire_independent_promoted_sessions() {
    let mut f = fixture();
    runtime().block_on(async {
        trust(&f).await;
        let first = promote(&f).await;
        reselect(&mut f);
        let (_, review) = reviewed(&f).await;
        assert!(cancelled(&f.app.bind_context_session(
            &f.window,
            target(&f, &first),
            review,
            MemorySessionUse::Disabled,
            DiscoveryControl::default(),
        )));
        let second = promote(&f).await;
        assert!(packet(&f, &first).await.packet.is_some());
        assert!(f.app.close_context(&f.window, &first).unwrap());
        assert!(!f.app.close_context(&f.window, &first).unwrap());
        assert!(!f.app.is_context_current(&f.window, &first));
        assert!(f.app.is_context_current(&f.window, &second));
        assert!(packet(&f, &second).await.packet.is_some());
        assert!(cancelled(&f.app.session_context(
            &f.window,
            &first,
            DiscoveryControl::default()
        )));
    });
}

#[test]
fn window_replacement_retirement_and_shutdown_drop_only_the_original_native_contexts() {
    for change in 0..3 {
        let f = fixture();
        runtime().block_on(async {
            trust(&f).await;
            let context = promote(&f).await;
            let read = f
                .app
                .session_context(&f.window, &context, DiscoveryControl::default())
                .unwrap();
            match change {
                0 => f.window.retire(),
                1 => {
                    let _ = f.app.register_window("main").unwrap();
                }
                _ => f.app.shutdown(),
            }
            assert!(!f.app.is_context_current(&f.window, &context));
            assert!(context.identity.upgrade().is_none());
            assert!(read.finish().await.is_err());
            assert!(cancelled(&f.app.session_context(
                &f.window,
                &context,
                DiscoveryControl::default()
            )));
        });
    }
}

#[test]
fn mutated_display_never_changes_the_native_root_or_packet_identity() {
    let f = fixture();
    runtime().block_on(async {
        trust(&f).await;
        let (reservation, review) = reviewed(&f).await;
        let mut display = review.snapshot(&reservation).unwrap();
        display.root = PathBuf::from("/forged");
        display.project_key = "forged".into();
        display.fingerprint.digest = "a".repeat(64);
        let original_key = review.snapshot(&reservation).unwrap().project_key;
        let context = f.app.open_context(&f.window).unwrap();
        let prepared = f
            .app
            .bind_context_session(
                &f.window,
                target(&f, &context),
                review,
                MemorySessionUse::Enabled,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        f.app
            .promote_context(&f.window, target(&f, &context), prepared)
            .unwrap();
        let packet = packet(&f, &context).await.packet.unwrap();
        assert_eq!(f.app.context_root(&f.window, &context).unwrap(), f.root);
        assert_eq!(packet.project_key, original_key);
        assert_ne!(packet.project_key, display.project_key);
    });
}

#[test]
fn queued_binding_cannot_survive_panel_selection_window_or_application_retirement() {
    for change in 0..6 {
        let mut f = fixture();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .max_blocking_threads(1)
            .build()
            .unwrap();
        runtime.block_on(async {
            trust(&f).await;
            let (reservation, review) = reviewed(&f).await;
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
            let context = f.app.open_context(&f.window).unwrap();
            let binding = f
                .app
                .bind_context_session(
                    &f.window,
                    target(&f, &context),
                    review,
                    MemorySessionUse::Enabled,
                    DiscoveryControl::default(),
                )
                .unwrap();
            match change {
                0 => {
                    f.app
                        .close_presentation(&f.window, &f.presentation)
                        .unwrap();
                }
                1 => reselect(&mut f),
                2 => f.window.retire(),
                3 => f.app.shutdown(),
                4 => reservation.retire(),
                _ => {
                    f.app.close_context(&f.window, &context).unwrap();
                }
            }
            *gate.0.lock().unwrap() = true;
            gate.1.notify_all();
            blocker.await.unwrap();
            assert!(cancelled(&binding.finish().await));
            assert_eq!(f.store.load().unwrap().revision(), 1);
        });
    }
}

#[test]
fn opening_contexts_is_bounded_readless_and_grants_no_root_or_packet() {
    let f = fixture();
    let before = f.store.load().unwrap();
    let mut contexts = Vec::new();
    for _ in 0..256 {
        let context = f.app.open_context(&f.window).unwrap();
        assert!(!f.app.is_context_current(&f.window, &context));
        assert!(f.app.context_root(&f.window, &context).is_err());
        contexts.push(context);
    }
    assert!(matches!(
        f.app.open_context(&f.window),
        Err(MemoryWorkError::Read(ReadError::Limit))
    ));
    let old = contexts.pop().unwrap();
    assert!(f.app.close_context(&f.window, &old).unwrap());
    let replacement = f.app.open_context(&f.window).unwrap();
    assert!(!f.app.close_context(&f.window, &old).unwrap());
    assert!(cancelled(&f.app.session_context(
        &f.window,
        &replacement,
        DiscoveryControl::default()
    )));
    assert_eq!(f.store.load().unwrap(), before);
}

#[test]
fn a_prepared_binding_cannot_be_redirected_to_another_open_context() {
    let f = fixture();
    runtime().block_on(async {
        trust(&f).await;
        let (original, prepared) = prepared(&f).await;
        let successor = f.app.open_context(&f.window).unwrap();
        assert!(cancelled(&f.app.promote_context(
            &f.window,
            target(&f, &successor),
            prepared
        )));
        assert!(f.app.is_current(&f.window, &f.presentation, &f.selected));
        assert!(f.app.close_context(&f.window, &original).unwrap());
        assert!(!f.app.is_context_current(&f.window, &successor));
        let (_, review) = reviewed(&f).await;
        let prepared = f
            .app
            .bind_context_session(
                &f.window,
                target(&f, &successor),
                review,
                MemorySessionUse::Enabled,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        f.app
            .promote_context(&f.window, target(&f, &successor), prepared)
            .unwrap();
        assert!(packet(&f, &successor).await.packet.is_some());
    });
}

#[test]
fn a_stale_window_retirement_cannot_close_a_new_windows_context_at_the_same_label() {
    let mut f = fixture();
    runtime().block_on(async {
        trust(&f).await;
        let old_window = f.window.clone();
        let old = promote(&f).await;
        f.window = f.app.register_window("main").unwrap();
        f.presentation = f.app.open_presentation(&f.window).unwrap();
        reselect(&mut f);
        let current = promote(&f).await;
        old_window.retire();
        assert!(!f.app.is_context_current(&old_window, &old));
        assert!(f.app.is_context_current(&f.window, &current));
        assert!(packet(&f, &current).await.packet.is_some());
    });
}

#[test]
fn another_presentation_cannot_replace_an_admitted_opening_on_the_same_context() {
    let f = fixture();
    runtime().block_on(async {
        trust(&f).await;
        let context = f.app.open_context(&f.window).unwrap();
        let (_, review) = reviewed(&f).await;
        let original_review = review;
        let presentation = f.app.open_presentation(&f.window).unwrap();
        let selected = f
            .app
            .select(
                &f.window,
                &presentation,
                &f.registry,
                f.root.clone(),
                &WorkspaceEnv::Local,
            )
            .unwrap();
        let reserved = f
            .app
            .reserve_trust(
                &f.window,
                &presentation,
                &selected,
                DiscoveryControl::default(),
            )
            .unwrap();
        let review = f
            .app
            .review_trust(
                &f.window,
                &presentation,
                &selected,
                &reserved,
                f.store.clone(),
                None,
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        let original = f
            .app
            .bind_context_session(
                &f.window,
                target(&f, &context),
                original_review,
                MemorySessionUse::Enabled,
                DiscoveryControl::default(),
            )
            .unwrap();
        assert!(matches!(
            f.app.bind_context_session(
                &f.window,
                NativeMemoryContextTarget {
                    context: &context,
                    presentation: &presentation,
                    selected: &selected
                },
                review,
                MemorySessionUse::Disabled,
                DiscoveryControl::default()
            ),
            Err(MemoryTrustError::Worker(MemoryWorkError::Read(
                ReadError::Busy
            )))
        ));
        f.app
            .promote_context(
                &f.window,
                target(&f, &context),
                original.finish().await.unwrap(),
            )
            .unwrap();
        assert!(packet(&f, &context).await.packet.is_some());
    });
}

#[test]
fn a_cancelled_binding_control_cannot_promote_a_prepared_result() {
    let f = fixture();
    runtime().block_on(async {
        trust(&f).await;
        let context = f.app.open_context(&f.window).unwrap();
        let (_, review) = reviewed(&f).await;
        let control = DiscoveryControl::default();
        let prepared = f
            .app
            .bind_context_session(
                &f.window,
                target(&f, &context),
                review,
                MemorySessionUse::Enabled,
                control.clone(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        control.cancel();
        assert!(cancelled(&f.app.promote_context(
            &f.window,
            target(&f, &context),
            prepared
        )));
        assert!(f.app.is_current(&f.window, &f.presentation, &f.selected));
        assert!(!f.app.is_context_current(&f.window, &context));
        assert!(f.app.close_context(&f.window, &context).unwrap());
    });
}
