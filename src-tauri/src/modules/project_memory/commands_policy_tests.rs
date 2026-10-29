use super::*;
use crate::modules::project_memory::commands::tests::fixture;
use crate::modules::project_memory::tests::{populate, project, runtime};
use serde_json::json;
use std::fs;
use std::time::Duration;

fn request(revision: u64, policy: PolicyChoice) -> PolicyRequest {
    PolicyRequest { revision, policy }
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
fn token_only_confirmation_preserves_the_original_choice_and_redacts_unrelated_state() {
    let (state, app, resource) = fixture();
    let dir = project();
    let (registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        let store = initialize(&app, &resource).await;
        let foreign = "b".repeat(64);
        store.set_policy(0, &foreign, MemoryPolicy::Never).unwrap();
        let before = bytes(state.path());
        fs::write(dir.path().join(".voktty/INIT.md"), [0xff, 0x00]).unwrap();
        let reply = review(&app, &resource, &selected, request(1, PolicyChoice::Always))
            .await
            .unwrap();
        assert_eq!(reply.snapshot.root, dir.path());
        assert_eq!(reply.snapshot.policy, MemoryPolicy::Always);
        assert_eq!(reply.snapshot.preference, None);
        assert_eq!(bytes(state.path()), before);
        let key = reply.snapshot.project_key.clone();
        let token = reply.review.clone();
        let mut wire = serde_json::to_value(reply).unwrap();
        assert_eq!(wire["schema"], 1);
        assert_eq!(wire["revision"], 1);
        assert_eq!(wire.as_object().unwrap().len(), 7);
        for name in [
            "identity",
            "installationId",
            "bindings",
            "localPreferences",
            "instructions",
            "config",
            "project",
            "context",
            "session",
            "captures",
        ] {
            assert!(wire.get(name).is_none());
        }
        assert!(!wire.to_string().contains(&foreign));
        wire["policy"] = json!("never");
        wire["root"] = json!("/untrusted/display");
        wire["projectKey"] = json!(foreign);
        let accepted = confirm(&app, &resource, &selected, &token).await.unwrap();
        assert_eq!(accepted.preference.project_key, key);
        assert_eq!(accepted.preference.policy, MemoryPolicy::Always);
        assert_eq!(accepted.preference.instruction_digest, None);
        assert_eq!(
            serde_json::to_value(accepted)
                .unwrap()
                .as_object()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            store.load().unwrap().project(&foreign).unwrap().policy,
            MemoryPolicy::Never
        );
        assert_eq!(
            confirm(&app, &resource, &selected, &token)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        assert_eq!(
            fs::read(dir.path().join(".voktty/INIT.md")).unwrap(),
            [0xff, 0x00]
        );
        assert!(!registry.is_authorized(Path::new("/dev")));
        assert!(!dir.path().join("src/.voktty").exists());
    });
}

#[test]
fn policy_and_instruction_trust_are_separate_and_all_explicit_choices_are_persisted() {
    let (_state, app, resource) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        let store = initialize(&app, &resource).await;
        let original = resource.check(&app, &selected).unwrap();
        let reserved = app
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
                &reserved,
                store.clone(),
                None,
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        let fingerprint = artifact.snapshot(&reserved).unwrap().fingerprint;
        app.accept_trust(
            &resource.window,
            &resource.receipt,
            &original,
            artifact,
            DiscoveryControl::default(),
        )
        .unwrap()
        .finish()
        .await
        .unwrap();
        for (revision, choice, expected) in [
            (1, PolicyChoice::Always, MemoryPolicy::Always),
            (2, PolicyChoice::Never, MemoryPolicy::Never),
            (3, PolicyChoice::Manual, MemoryPolicy::Manual),
        ] {
            let ready = review(&app, &resource, &selected, request(revision, choice))
                .await
                .unwrap();
            assert_eq!(
                ready
                    .snapshot
                    .preference
                    .as_ref()
                    .unwrap()
                    .instruction_digest
                    .as_deref(),
                Some(fingerprint.digest.as_str())
            );
            let accepted = confirm(&app, &resource, &selected, &ready.review)
                .await
                .unwrap();
            assert_eq!(accepted.preference.policy, expected);
            assert_eq!(
                accepted.preference.instruction_digest.as_deref(),
                Some(fingerprint.digest.as_str())
            );
        }
        let reopened = app
            .store(
                &resource.window,
                MemoryStoreMode::OpenExisting,
                ReadControl::default(),
            )
            .await
            .unwrap()
            .load()
            .unwrap();
        assert_eq!(reopened.revision(), 4);
    });
}

#[test]
fn revision_order_and_cancellation_tombstones_preserve_the_current_native_owner() {
    let (state, app, resource) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &resource, dir.path());
    let old = resource.reserve_policy_review(&app, &selected, 1).unwrap();
    let old_control = resource
        .policy_control(&app, &selected, &old, Phase::Opening)
        .unwrap();
    let next = resource.reserve_policy_review(&app, &selected, 2).unwrap();
    assert!(!old.reservation.is_live());
    assert!(old_control.read_control().is_err());
    for revision in [0, 1, 2, 9_007_199_254_740_992] {
        assert!(resource
            .reserve_policy_review(&app, &selected, revision)
            .is_err());
        resource
            .policy_control(&app, &selected, &next, Phase::Opening)
            .unwrap();
    }
    assert!(!resource
        .cancel_policy_review(&app, &selected, 1, None)
        .unwrap());
    assert!(!resource
        .cancel_policy_review(&app, &selected, 2, Some(&old.token))
        .unwrap());
    assert!(resource
        .cancel_policy_review(&app, &selected, 3, None)
        .unwrap());
    assert!(!next.reservation.is_live());
    assert!(resource.reserve_policy_review(&app, &selected, 3).is_err());
    let current = resource.reserve_policy_review(&app, &selected, 4).unwrap();
    assert!(!resource
        .cancel_policy_review(&app, &selected, 3, None)
        .unwrap());
    assert!(current.reservation.is_live());
    assert!(resource
        .cancel_policy_review(&app, &selected, 4, None)
        .unwrap());
    assert!(!resource
        .cancel_policy_review(&app, &selected, 4, None)
        .unwrap());
    assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
}

#[test]
fn missing_corrupt_and_ambiguous_memory_never_initialize_state_or_change_policy() {
    let (state, app, resource) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        assert!(
            review(&app, &resource, &selected, request(1, PolicyChoice::Never))
                .await
                .is_err()
        );
        assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
        initialize(&app, &resource).await;
        let old = review(&app, &resource, &selected, request(2, PolicyChoice::Always))
            .await
            .unwrap();
        populate(&dir.path().join("src"));
        let before = bytes(state.path());
        assert_eq!(
            review(&app, &resource, &selected, request(3, PolicyChoice::Always))
                .await
                .unwrap_err()
                .code,
            "scope"
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
            review(&app, &resource, &selected, request(4, PolicyChoice::Manual))
                .await
                .unwrap_err()
                .code,
            "invalidState"
        );
        assert_eq!(bytes(state.path()), b"{");
    });
}

#[test]
fn concurrent_preference_changes_fail_once_without_rebasing_or_restoring_acceptance() {
    let (state, app, resource) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        let store = initialize(&app, &resource).await;
        let ready = review(&app, &resource, &selected, request(1, PolicyChoice::Always))
            .await
            .unwrap();
        store
            .set_policy(0, &ready.snapshot.project_key, MemoryPolicy::Never)
            .unwrap();
        let before = bytes(state.path());
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
    });
}

#[test]
fn foreign_and_duplicate_tokens_cannot_borrow_or_cancel_an_accepted_choice() {
    let (_state, app, resource) = fixture();
    let (_foreign_state, foreign, _foreign_resource) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        initialize(&app, &resource).await;
        let ready = review(&app, &resource, &selected, request(1, PolicyChoice::Never))
            .await
            .unwrap();
        assert!(resource
            .begin_policy_acceptance(&foreign, &selected, &ready.review)
            .is_err());
        assert!(resource
            .begin_policy_acceptance(&app, &selected, &uuid::Uuid::new_v4().to_string())
            .is_err());
        let (capture, job) = resource
            .begin_policy_acceptance(&app, &selected, &ready.review)
            .unwrap();
        assert!(resource
            .begin_policy_acceptance(&app, &selected, &ready.review)
            .is_err());
        assert_eq!(
            job.unwrap().finish().await.unwrap().policy,
            MemoryPolicy::Never
        );
        resource
            .policy_control(&app, &selected, &capture, Phase::Accepting)
            .unwrap();
        assert!(resource
            .cancel_policy_review(&app, &selected, capture.revision, Some(&capture.token))
            .unwrap());
    });
}

#[test]
fn selection_round_trips_and_failed_remote_selections_never_revive_old_policy_tokens() {
    let (_state, app, resource) = fixture();
    let dir = project();
    let (registry, selected) = select(&app, &resource, dir.path());
    runtime().block_on(async {
        initialize(&app, &resource).await;
        let old = review(&app, &resource, &selected, request(1, PolicyChoice::Always))
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
        let fresh = review(&app, &resource, &next, request(1, PolicyChoice::Never))
            .await
            .unwrap();
        assert_eq!(
            confirm(&app, &resource, &next, &old.review)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        assert_eq!(
            resource
                .select(
                    &app,
                    &registry,
                    dir.path().to_owned(),
                    &WorkspaceEnv::Wsl {
                        distro: "unavailable".into()
                    },
                    3
                )
                .unwrap_err()
                .code,
            "unsupported"
        );
        assert_eq!(
            confirm(&app, &resource, &next, &fresh.review)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
    });
}

#[test]
fn native_artifacts_cannot_be_adopted_under_a_foreign_reservation() {
    let (_state, app, resource) = fixture();
    let dir = project();
    let other = project();
    let (registry, selected) = select(&app, &resource, dir.path());
    populate(other.path());
    registry.authorize(other.path()).unwrap();
    runtime().block_on(async {
        let store = initialize(&app, &resource).await;
        let own = resource.reserve_policy_review(&app, &selected, 1).unwrap();
        let sibling = app.open_presentation(&resource.window).unwrap();
        let target = app
            .select_with_inspection(
                &resource.window,
                &sibling,
                &registry,
                other.path().into(),
                &WorkspaceEnv::Local,
            )
            .unwrap();
        let reserved = app
            .reserve_policy(
                &resource.window,
                &sibling,
                &target,
                DiscoveryControl::default(),
            )
            .unwrap();
        let artifact = app
            .review_policy(
                &resource.window,
                &sibling,
                &target,
                &reserved,
                store.clone(),
                MemoryPolicy::Always,
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(
            resource
                .adopt_policy(&app, &selected, &own, artifact)
                .unwrap_err()
                .code,
            "cancelled"
        );
        resource
            .policy_control(&app, &selected, &own, Phase::Opening)
            .unwrap();
        let artifact = app
            .review_policy(
                &resource.window,
                &resource.receipt,
                &own.selected,
                &own.reservation,
                store,
                MemoryPolicy::Never,
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        let reply = resource
            .adopt_policy(&app, &selected, &own, artifact)
            .unwrap();
        assert_eq!(reply.snapshot.root, dir.path());
        let successor = resource.reserve_policy_review(&app, &selected, 2).unwrap();
        assert!(!own.reservation.is_live());
        assert!(successor.reservation.is_live());
        assert_eq!(
            confirm(&app, &resource, &selected, &reply.review)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
    });
}

#[test]
fn native_retirement_cancels_queued_private_state_reads_without_recreating_the_lock() {
    for retire in 0..4 {
        let (state, app, resource) = fixture();
        let dir = project();
        let (_registry, selected) = select(&app, &resource, dir.path());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .max_blocking_threads(1)
            .build()
            .unwrap();
        runtime.block_on(initialize(&app, &resource));
        let lock = state.path().join("project-memory/memory-local.lock");
        fs::remove_file(&lock).unwrap();
        let before = bytes(state.path());
        let (started, observed) = std::sync::mpsc::channel();
        let (release, blocked) = std::sync::mpsc::channel();
        let blocker = runtime.spawn_blocking(move || {
            started.send(()).unwrap();
            blocked.recv_timeout(Duration::from_secs(3)).unwrap();
        });
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        runtime.block_on(async {
            let pending = review(&app, &resource, &selected, request(1, PolicyChoice::Always));
            tokio::pin!(pending);
            tokio::select! { biased; _ = &mut pending => panic!("private state must be queued"), _ = tokio::task::yield_now() => {} }
            let control = resource.selected.lock().unwrap().selected.as_ref().unwrap().policy.current.as_ref().unwrap().control.clone();
            match retire {
                0 => { resource.cancel_policy_review(&app, &selected, 1, None).unwrap(); }
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
fn queued_confirmation_is_cancelled_while_a_completed_choice_survives_retirement() {
    for completed in [false, true] {
        let (state, app, resource) = fixture();
        let dir = project();
        let (_registry, selected) = select(&app, &resource, dir.path());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .max_blocking_threads(1)
            .build()
            .unwrap();
        let key = runtime.block_on(async {
            initialize(&app, &resource).await;
            let ready = review(&app, &resource, &selected, request(1, PolicyChoice::Never)).await.unwrap();
            let key = ready.snapshot.project_key;
            if completed {
                let (capture, job) = resource.begin_policy_acceptance(&app, &selected, &ready.review).unwrap();
                job.unwrap().finish().await.unwrap();
                resource.retire();
                assert!(resource.policy_control(&app, &selected, &capture, Phase::Accepting).is_err());
            } else {
                let before = bytes(state.path());
                let (started, observed) = std::sync::mpsc::channel();
                let (release, blocked) = std::sync::mpsc::channel();
                let blocker = tokio::task::spawn_blocking(move || {
                    started.send(()).unwrap();
                    blocked.recv_timeout(Duration::from_secs(3)).unwrap();
                });
                observed.recv_timeout(Duration::from_secs(3)).unwrap();
                let pending = confirm(&app, &resource, &selected, &ready.review);
                tokio::pin!(pending);
                tokio::select! { biased; _ = &mut pending => panic!("confirmation must be queued"), _ = tokio::task::yield_now() => {} }
                resource.cancel_policy_review(&app, &selected, 1, None).unwrap();
                release.send(()).unwrap();
                blocker.await.unwrap();
                assert_eq!(pending.await.unwrap_err().code, "cancelled");
                assert_eq!(bytes(state.path()), before);
            }
            key
        });
        drop(runtime);
        let value: serde_json::Value = serde_json::from_slice(&bytes(state.path())).unwrap();
        if completed {
            assert!(value["projects"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["projectKey"] == key
                    && entry["policy"] == "never"
                    && entry["instructionDigest"].is_null()));
        } else {
            assert_eq!(value["revision"], 0);
        }
    }
}

#[test]
fn strict_policy_requests_and_errors_never_accept_client_authorities_or_session_grants() {
    for (text, expected) in [
        ("manual", MemoryPolicy::Manual),
        ("always", MemoryPolicy::Always),
        ("never", MemoryPolicy::Never),
    ] {
        let request: PolicyRequest =
            serde_json::from_value(json!({"revision":1,"policy":text})).unwrap();
        assert_eq!(MemoryPolicy::from(request.policy), expected);
    }
    for name in [
        "root",
        "projectKey",
        "instructionDigest",
        "trust",
        "store",
        "session",
        "captures",
        "writeAccess",
    ] {
        let mut value = json!({"revision":1,"policy":"always"});
        value[name] = json!("untrusted");
        assert!(serde_json::from_value::<PolicyRequest>(value).is_err());
    }
    for policy in [
        json!("ask"),
        json!("ALWAYS"),
        json!("session"),
        json!(null),
        json!(true),
        json!({"always":null}),
        json!(["always"]),
        json!("x".repeat(100)),
    ] {
        assert!(
            serde_json::from_value::<PolicyRequest>(json!({"revision":1,"policy":policy})).is_err()
        );
    }
    for value in [
        json!({"revision":1}),
        json!({"revision":-1,"policy":"manual"}),
        json!({"revision":1.5,"policy":"manual"}),
    ] {
        assert!(serde_json::from_value::<PolicyRequest>(value).is_err());
    }
    assert!(serde_json::from_str::<PolicyRequest>(
        r#"{"revision":1,"policy":"always","policy":"never"}"#
    )
    .is_err());
    for (error, code) in [
        (MemoryPolicyError::Changed, "stale"),
        (MemoryPolicyError::ScopeUnavailable, "scope"),
        (ReadError::Store(StoreError::Conflict).into(), "stale"),
        (ReadError::Contract(vec![]).into(), "unavailable"),
    ] {
        assert_eq!(
            serde_json::to_value(MemoryCommandError::from(error)).unwrap(),
            json!({"code":code})
        );
    }
}
