use super::*;
use crate::modules::project_memory::commands::tests::fixture;
use crate::modules::project_memory::tests::{populate, project, runtime};
use serde_json::json;
use std::fs;
use voktty_memory_local::MemoryPolicy;

fn request(revision: u64) -> TrustRequest {
    TrustRequest {
        revision,
        role: None,
    }
}
fn select(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
    root: &Path,
) -> (WorkspaceRegistry, String) {
    populate(root);
    fs::create_dir(root.join("src")).unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(root).unwrap();
    let selected = resource
        .select_with_inspection(
            app,
            &registry,
            root.join("src"),
            &WorkspaceEnv::Local,
            1,
            true,
        )
        .unwrap();
    (registry, selected)
}
async fn initialize(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
) -> Arc<LocalMemoryStore> {
    app.store(
        &resource.window,
        MemoryStoreMode::Initialize,
        ReadControl::default(),
    )
    .await
    .unwrap()
}
fn bytes(state: &Path) -> Vec<u8> {
    fs::read(state.join("project-memory/memory-local.json")).unwrap()
}

#[test]
fn review_and_token_only_acceptance_preserve_policy_and_redact_unrelated_preferences() {
    let (state, app, resource) = fixture();
    let dir = project();
    let (registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        let store = initialize(&app, &resource).await;
        let initial = review(&app, &resource, &selected, request(1))
            .await
            .unwrap();
        let key = initial.snapshot.project_key;
        let foreign_key = "b".repeat(64);
        store.set_policy(0, &key, MemoryPolicy::Never).unwrap();
        store
            .set_policy(1, &foreign_key, MemoryPolicy::Always)
            .unwrap();
        let before = bytes(state.path());
        let reply = review(&app, &resource, &selected, request(2))
            .await
            .unwrap();
        assert_eq!(reply.snapshot.root, dir.path());
        assert_eq!(
            reply.snapshot.preference.as_ref().unwrap().policy,
            MemoryPolicy::Never
        );
        assert_eq!(bytes(state.path()), before);
        let expected = reply.snapshot.fingerprint.digest.clone();
        let token = reply.review.clone();
        let mut wire = serde_json::to_value(reply).unwrap();
        assert_eq!(wire["schema"], 1);
        assert_eq!(wire["revision"], 2);
        for field in [
            "identity",
            "installationId",
            "localPreferences",
            "projects",
            "project",
            "context",
        ] {
            assert!(wire.get(field).is_none());
        }
        assert!(!wire.to_string().contains(&foreign_key));
        wire["root"] = json!("/untrusted/display");
        wire["fingerprint"]["digest"] = json!(foreign_key);
        wire["instructions"] = json!({"files":[]});
        let accepted = confirm(&app, &resource, &selected, &token).await.unwrap();
        assert_eq!(accepted.preference.project_key, key);
        assert_eq!(accepted.preference.policy, MemoryPolicy::Never);
        assert_eq!(
            accepted.preference.instruction_digest.as_deref(),
            Some(expected.as_str())
        );
        assert_eq!(
            store.load().unwrap().project(&key).unwrap(),
            &accepted.preference
        );
        assert_eq!(
            confirm(&app, &resource, &selected, &token)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        assert!(!registry.is_authorized(Path::new("/dev")));
        assert!(!dir.path().join("src/.voktty").exists());
    });
}

#[test]
fn ordered_reservations_and_cancellation_tombstones_never_retire_a_successor() {
    let (state, app, resource) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &resource, dir.path());
    let first = resource.reserve_trust_review(&app, &selected, 1).unwrap();
    let first_control = resource
        .trust_control(&app, &selected, &first, Phase::Opening)
        .unwrap();
    let second = resource.reserve_trust_review(&app, &selected, 2).unwrap();
    assert!(first_control.read_control().is_err());
    for revision in [0, 1, 2, 9_007_199_254_740_992] {
        assert!(resource
            .reserve_trust_review(&app, &selected, revision)
            .is_err());
        resource
            .trust_control(&app, &selected, &second, Phase::Opening)
            .unwrap();
    }
    assert!(!resource
        .cancel_trust_review(&app, &selected, 1, None)
        .unwrap());
    assert!(!resource
        .cancel_trust_review(&app, &selected, 2, Some(&first.token))
        .unwrap());
    assert!(resource
        .cancel_trust_review(&app, &selected, 3, None)
        .unwrap());
    assert!(resource.reserve_trust_review(&app, &selected, 3).is_err());
    let fourth = resource.reserve_trust_review(&app, &selected, 4).unwrap();
    assert!(!resource
        .cancel_trust_review(&app, &selected, 3, None)
        .unwrap());
    resource
        .trust_control(&app, &selected, &fourth, Phase::Opening)
        .unwrap();
    assert!(resource
        .cancel_trust_review(&app, &selected, 4, None)
        .unwrap());
    assert!(!resource
        .cancel_trust_review(&app, &selected, 4, None)
        .unwrap());
    assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
}

#[test]
fn errors_do_not_initialize_state_and_invalid_new_requests_retire_old_reviews() {
    let (state, app, resource) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        assert!(review(&app, &resource, &selected, request(1))
            .await
            .is_err());
        assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
        initialize(&app, &resource).await;
        let old = review(&app, &resource, &selected, request(2))
            .await
            .unwrap();
        let before = bytes(state.path());
        let invalid = TrustRequest {
            revision: 3,
            role: Some("x".repeat(257)),
        };
        assert_eq!(
            review(&app, &resource, &selected, invalid)
                .await
                .unwrap_err()
                .code,
            "limit"
        );
        assert_eq!(
            confirm(&app, &resource, &selected, &old.review)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        assert_eq!(bytes(state.path()), before);
        fs::write(state.path().join("project-memory/memory-local.json"), "{").unwrap();
        assert_eq!(
            review(&app, &resource, &selected, request(4))
                .await
                .unwrap_err()
                .code,
            "invalidState"
        );
        assert_eq!(bytes(state.path()), b"{");
    });
}

#[test]
fn changed_instructions_fail_without_restoring_acceptance_or_overwriting_content() {
    let (state, app, resource) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        initialize(&app, &resource).await;
        let ready = review(&app, &resource, &selected, request(1))
            .await
            .unwrap();
        let before = bytes(state.path());
        fs::write(
            dir.path().join(".voktty/INIT.md"),
            "Foreign changed instructions",
        )
        .unwrap();
        assert_eq!(
            confirm(&app, &resource, &selected, &ready.review)
                .await
                .unwrap_err()
                .code,
            "stale"
        );
        assert_eq!(
            confirm(&app, &resource, &selected, &ready.review)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        assert_eq!(bytes(state.path()), before);
        assert_eq!(
            fs::read_to_string(dir.path().join(".voktty/INIT.md")).unwrap(),
            "Foreign changed instructions"
        );
    });
}

#[test]
fn foreign_and_duplicate_confirmation_cannot_borrow_or_cancel_current_acceptance() {
    let (_state, app, resource) = fixture();
    let (_foreign_state, foreign, _foreign_resource) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        initialize(&app, &resource).await;
        let ready = review(&app, &resource, &selected, request(1))
            .await
            .unwrap();
        assert!(resource
            .begin_trust_acceptance(&foreign, &selected, &ready.review)
            .is_err());
        assert!(resource
            .begin_trust_acceptance(&app, &selected, &uuid::Uuid::new_v4().to_string())
            .is_err());
        let (capture, job) = resource
            .begin_trust_acceptance(&app, &selected, &ready.review)
            .unwrap();
        assert!(resource
            .begin_trust_acceptance(&app, &selected, &ready.review)
            .is_err());
        assert!(job
            .unwrap()
            .finish()
            .await
            .unwrap()
            .instruction_digest
            .is_some());
        resource
            .trust_control(&app, &selected, &capture, Phase::Accepting)
            .unwrap();
        resource
            .cancel_trust_review(&app, &selected, capture.revision, Some(&capture.token))
            .unwrap();
    });
}

#[test]
fn returning_to_the_same_path_never_revives_an_old_review_or_selection() {
    let (_state, app, resource) = fixture();
    let dir = project();
    let (registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        initialize(&app, &resource).await;
        let old = review(&app, &resource, &selected, request(1))
            .await
            .unwrap();
        let next = resource
            .select_with_inspection(
                &app,
                &registry,
                dir.path().join("src"),
                &WorkspaceEnv::Local,
                2,
                true,
            )
            .unwrap();
        assert_eq!(
            confirm(&app, &resource, &selected, &old.review)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        let fresh = review(&app, &resource, &next, request(1)).await.unwrap();
        assert_eq!(
            confirm(&app, &resource, &next, &old.review)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        confirm(&app, &resource, &next, &fresh.review)
            .await
            .unwrap();
    });
}

#[test]
fn native_review_identity_cannot_be_transferred_to_another_presentation() {
    let (_state, app, resource) = fixture();
    let dir = project();
    let (registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        let store = initialize(&app, &resource).await;
        let original = resource.check(&app, &selected).unwrap();
        let reservation = app
            .reserve_trust(
                &resource.window,
                &resource.receipt,
                &original,
                DiscoveryControl::default(),
            )
            .unwrap();
        let artifact = app
            .review_trust(
                &resource.window,
                &resource.receipt,
                &original,
                &reservation,
                store,
                None,
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        let sibling = app.open_presentation(&resource.window).unwrap();
        let target = app
            .select_with_inspection(
                &resource.window,
                &sibling,
                &registry,
                dir.path().join("src"),
                &WorkspaceEnv::Local,
            )
            .unwrap();
        let control = DiscoveryControl::default();
        app.reserve_trust(&resource.window, &sibling, &target, control.clone())
            .unwrap();
        assert!(matches!(
            app.accept_trust(
                &resource.window,
                &sibling,
                &target,
                artifact,
                DiscoveryControl::default()
            ),
            Err(MemoryTrustError::Worker(MemoryWorkError::Read(
                ReadError::Cancelled
            )))
        ));
        control.read_control().unwrap();
        app.close_presentation(&resource.window, &sibling).unwrap();
        assert!(control.read_control().is_err());
    });
}

#[test]
fn completed_native_review_is_rejected_after_its_source_is_retired() {
    let (_state, app, resource) = fixture();
    let dir = project();
    let (registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        let store = initialize(&app, &resource).await;
        let original = resource.check(&app, &selected).unwrap();
        let capture = resource.reserve_trust_review(&app, &selected, 1).unwrap();
        let artifact = app
            .review_trust(
                &resource.window,
                &resource.receipt,
                &original,
                &capture.reservation,
                store,
                None,
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        resource
            .select(
                &app,
                &registry,
                dir.path().join("src"),
                &WorkspaceEnv::Local,
                2,
            )
            .unwrap();
        assert!(artifact.snapshot(&capture.reservation).is_err());
        assert_eq!(
            resource
                .adopt_trust(&app, &selected, &capture, artifact)
                .unwrap_err()
                .code,
            "cancelled"
        );
    });
}

#[test]
fn replacing_a_review_retires_native_artifacts_and_cannot_lend_its_deadline_to_old_work() {
    let (_state, app, resource) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        let store = initialize(&app, &resource).await;
        let first = resource.reserve_trust_review(&app, &selected, 1).unwrap();
        let artifact = app
            .review_trust(
                &resource.window,
                &resource.receipt,
                &first.selected,
                &first.reservation,
                store.clone(),
                None,
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        let second = resource.reserve_trust_review(&app, &selected, 2).unwrap();
        assert!(artifact.snapshot(&first.reservation).is_err());
        assert!(matches!(
            app.accept_trust(
                &resource.window,
                &resource.receipt,
                &first.selected,
                artifact,
                DiscoveryControl::default()
            ),
            Err(MemoryTrustError::Worker(MemoryWorkError::Read(
                ReadError::Cancelled
            )))
        ));
        assert!(matches!(
            app.review_trust(
                &resource.window,
                &resource.receipt,
                &first.selected,
                &first.reservation,
                store,
                None
            ),
            Err(MemoryTrustError::Worker(MemoryWorkError::Read(
                ReadError::Cancelled
            )))
        ));
        resource
            .trust_control(&app, &selected, &second, Phase::Opening)
            .unwrap()
            .read_control()
            .unwrap();
    });
}

#[test]
fn adopting_a_foreign_native_artifact_cannot_publish_its_display_or_consume_the_opening() {
    let (_state, app, resource) = fixture();
    let dir = project();
    let other = project();
    let (registry, selected) = select(&app, &resource, dir.path());
    populate(other.path());
    registry.authorize(other.path()).unwrap();
    runtime().block_on(async {
        let store = initialize(&app, &resource).await;
        let capture = resource.reserve_trust_review(&app, &selected, 1).unwrap();
        let sibling = app.open_presentation(&resource.window).unwrap();
        let foreign = app
            .select_with_inspection(
                &resource.window,
                &sibling,
                &registry,
                other.path().into(),
                &WorkspaceEnv::Local,
            )
            .unwrap();
        let reservation = app
            .reserve_trust(
                &resource.window,
                &sibling,
                &foreign,
                DiscoveryControl::default(),
            )
            .unwrap();
        let artifact = app
            .review_trust(
                &resource.window,
                &sibling,
                &foreign,
                &reservation,
                store.clone(),
                None,
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(
            resource
                .adopt_trust(&app, &selected, &capture, artifact)
                .unwrap_err()
                .code,
            "cancelled"
        );
        resource
            .trust_control(&app, &selected, &capture, Phase::Opening)
            .unwrap();
        let own = app
            .review_trust(
                &resource.window,
                &resource.receipt,
                &capture.selected,
                &capture.reservation,
                store,
                None,
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        let reply = resource
            .adopt_trust(&app, &selected, &capture, own)
            .unwrap();
        assert_eq!(reply.snapshot.root, dir.path());
        app.reserve_trust(
            &resource.window,
            &resource.receipt,
            &capture.selected,
            DiscoveryControl::default(),
        )
        .unwrap();
        assert!(resource
            .trust_control(&app, &selected, &capture, Phase::Ready)
            .is_err());
    });
}

#[test]
fn native_owner_retirement_cancels_queued_private_reads_before_their_io() {
    for retire in 0..4 {
        let (state, app, resource) = fixture();
        let dir = project();
        let (_registry, selected) = select(&app, &resource, dir.path());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .max_blocking_threads(1)
            .build()
            .unwrap();
        runtime.block_on(async {
            initialize(&app, &resource).await;
        });
        let lock = state.path().join("project-memory/memory-local.lock");
        fs::remove_file(&lock).unwrap();
        let before = bytes(state.path());
        let (started, observed) = std::sync::mpsc::channel();
        let (release, blocked) = std::sync::mpsc::channel();
        let blocker = runtime.spawn_blocking(move || {
            started.send(()).unwrap();
            blocked
                .recv_timeout(std::time::Duration::from_secs(3))
                .unwrap();
        });
        observed
            .recv_timeout(std::time::Duration::from_secs(3))
            .unwrap();
        runtime.block_on(async {
            let pending = review(&app, &resource, &selected, request(1));
            tokio::pin!(pending);
            tokio::select! { biased; _ = &mut pending => panic!("private read must be queued"), _ = tokio::task::yield_now() => {} }
            let control = resource.selected.lock().unwrap().selected.as_ref().unwrap().trust.current.as_ref().unwrap().control.clone();
            match retire {
                0 => { resource.cancel_trust_review(&app, &selected, 1, None).unwrap(); }
                1 => resource.retire(),
                2 => resource.window.retire(),
                _ => app.shutdown(),
            }
            assert!(control.read_control().is_err());
            release.send(()).unwrap();
            blocker.await.unwrap();
            assert_eq!(pending.await.unwrap_err().code, "cancelled");
        });
        drop(runtime);
        assert!(!lock.exists());
        assert_eq!(bytes(state.path()), before);
    }
}

#[test]
fn queued_acceptance_is_cancelled_and_completed_acceptance_is_never_rolled_back() {
    for completed in [false, true] {
        let (state, app, resource) = fixture();
        let dir = project();
        let (_registry, selected) = select(&app, &resource, dir.path());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .max_blocking_threads(1)
            .build()
            .unwrap();
        let key = runtime.block_on(async {
            initialize(&app, &resource).await;
            let ready = review(&app, &resource, &selected, request(1))
                .await
                .unwrap();
            let key = ready.snapshot.project_key;
            if completed {
                let (capture, job) = resource
                    .begin_trust_acceptance(&app, &selected, &ready.review)
                    .unwrap();
                job.unwrap().finish().await.unwrap();
                resource.retire();
                assert!(resource
                    .trust_control(&app, &selected, &capture, Phase::Accepting)
                    .is_err());
            } else {
                let before = bytes(state.path());
                let (release, blocked) = std::sync::mpsc::channel();
                let (started, observed) = std::sync::mpsc::channel();
                let blocker = tokio::task::spawn_blocking(move || {
                    started.send(()).unwrap();
                    blocked
                        .recv_timeout(std::time::Duration::from_secs(3))
                        .unwrap();
                });
                observed
                    .recv_timeout(std::time::Duration::from_secs(3))
                    .unwrap();
                let (_capture, job) = resource
                    .begin_trust_acceptance(&app, &selected, &ready.review)
                    .unwrap();
                resource.window.retire();
                release.send(()).unwrap();
                blocker.await.unwrap();
                assert!(job.unwrap().finish().await.is_err());
                assert_eq!(bytes(state.path()), before);
            }
            key
        });
        drop(runtime);
        let disk: serde_json::Value = serde_json::from_slice(&bytes(state.path())).unwrap();
        if completed {
            assert!(disk["projects"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["projectKey"] == key && entry["instructionDigest"].is_string()));
        } else {
            assert_eq!(disk["revision"], 0);
        }
    }
}

#[test]
fn strict_request_and_redacted_error_shapes_never_accept_client_trust_facts() {
    for field in [
        "root",
        "digest",
        "instructions",
        "store",
        "policy",
        "writeAccess",
    ] {
        let mut input = json!({"revision":1,"role":null});
        input[field] = json!("untrusted");
        assert!(serde_json::from_value::<TrustRequest>(input).is_err());
    }
    for (error, code) in [
        (MemoryTrustError::Changed, "stale"),
        (MemoryTrustError::ScopeUnavailable, "scope"),
        (ReadError::Store(StoreError::Conflict).into(), "stale"),
        (ReadError::Contract(vec![]).into(), "unavailable"),
    ] {
        assert_eq!(
            serde_json::to_value(MemoryCommandError::from(error)).unwrap(),
            json!({"code":code})
        );
    }
}
