use super::*;
use crate::modules::project_memory::commands::tests::fixture;
use crate::modules::project_memory::tests::{project, runtime};
use serde_json::json;
use std::fs;

fn select(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
    root: &Path,
) -> (WorkspaceRegistry, String) {
    let registry = WorkspaceRegistry::default();
    registry.authorize(root).unwrap();
    registry.authorize("/dev").unwrap();
    let selection = resource
        .select(app, &registry, root.into(), &WorkspaceEnv::Local, 1)
        .unwrap();
    (registry, selection)
}
fn request(root: &Path, revision: u64) -> PreviewRequest {
    serde_json::from_value(json!({
        "revision": revision, "destination": root, "environment": {"kind":"local"},
        "inputs": {"project_name":"Reviewed IPC", "created_at":"2026-10-29"},
        "links": {"agents":false, "claude":false}
    }))
    .unwrap()
}
async fn initialize(app: &NativeMemoryApplication, resource: &PresentationResource) {
    app.store(
        &resource.window,
        MemoryStoreMode::Initialize,
        ReadControl::default(),
    )
    .await
    .unwrap();
}

#[test]
fn preview_reply_is_display_only_and_confirmation_publishes_the_original_once() {
    let (state, app, resource) = fixture();
    let project = project();
    let (registry, selection) = select(&app, &resource, project.path());
    runtime().block_on(async {
        initialize(&app, &resource).await;
        let preferences = fs::read(state.path().join("project-memory/memory-local.json")).unwrap();
        let reply = preview(
            &app,
            &registry,
            &resource,
            &selection,
            request(project.path(), 1),
        )
        .await
        .unwrap();
        assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
        let token = reply.review.clone();
        let expected = reply
            .deployment
            .plan
            .entries
            .iter()
            .find(|entry| entry.path == ".voktty/INIT.md")
            .unwrap()
            .proposed
            .clone();
        let mut wire = serde_json::to_value(reply).unwrap();
        assert_eq!(wire["schema"], 1);
        assert_eq!(wire["revision"], 1);
        assert_eq!(wire.as_object().unwrap().len(), 8);
        assert_eq!(
            wire["root"],
            json!(fs::canonicalize(project.path()).unwrap())
        );
        for field in [
            "installationId",
            "preferences",
            "instructionDigest",
            "origin",
            "destinationAccess",
        ] {
            assert!(wire.get(field).is_none());
        }
        wire["deployment"]["entries"][0]["proposed"] = "changed display".into();
        wire["root"] = "changed destination".into();
        let report = confirm(&app, &registry, &resource, &selection, &token)
            .await
            .unwrap();
        assert_eq!(report.schema, 1);
        assert!(!report.created.is_empty());
        assert_eq!(
            fs::read_to_string(project.path().join(".voktty/INIT.md")).unwrap(),
            expected
        );
        assert!(!project.path().join("AGENTS.md").exists());
        assert!(!project.path().join("CLAUDE.md").exists());
        assert_eq!(
            confirm(&app, &registry, &resource, &selection, &token)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        let reply = preview(
            &app,
            &registry,
            &resource,
            &selection,
            request(project.path(), 2),
        )
        .await
        .unwrap();
        let report = confirm(&app, &registry, &resource, &selection, &reply.review)
            .await
            .unwrap();
        assert!(report.created.is_empty());
        assert!(!report.skipped.is_empty());
        assert_eq!(
            fs::read(state.path().join("project-memory/memory-local.json")).unwrap(),
            preferences
        );
        assert!(!registry.is_authorized(Path::new("/")));
    });
}

#[test]
fn revision_ordering_and_exact_cancellation_preserve_the_newer_review() {
    let (_state, app, resource) = fixture();
    let project = project();
    let (registry, selection) = select(&app, &resource, project.path());
    let first = resource
        .reserve_review(&app, &registry, &selection, &request(project.path(), 1))
        .unwrap();
    let second = resource
        .reserve_review(&app, &registry, &selection, &request(project.path(), 2))
        .unwrap();
    for revision in [0, 1, 2, 9_007_199_254_740_992] {
        assert_eq!(
            resource
                .reserve_review(
                    &app,
                    &registry,
                    &selection,
                    &request(project.path(), revision)
                )
                .err()
                .unwrap()
                .code,
            "cancelled"
        );
        resource
            .check_review(&app, &selection, &second, Phase::Opening)
            .unwrap();
    }
    assert!(!resource.cancel_review(&app, &selection, 1, None).unwrap());
    assert!(!resource
        .cancel_review(&app, &selection, 2, Some(&first.token))
        .unwrap());
    assert!(resource
        .check_review(&app, &selection, &first, Phase::Opening)
        .is_err());
    resource
        .check_review(&app, &selection, &second, Phase::Opening)
        .unwrap();
    assert!(resource.cancel_review(&app, &selection, 2, None).unwrap());
    assert!(!resource.cancel_review(&app, &selection, 2, None).unwrap());
    assert!(resource
        .reserve_review(&app, &registry, &selection, &request(project.path(), 2))
        .is_err());
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}

#[test]
fn cancellation_before_preview_admission_records_its_revision_and_preserves_successors() {
    let (state, app, resource) = fixture();
    let project = project();
    let (registry, selection) = select(&app, &resource, project.path());
    assert!(!resource.cancel_review(&app, &selection, 1, None).unwrap());
    assert!(resource
        .reserve_review(&app, &registry, &selection, &request(project.path(), 1))
        .is_err());
    let second = resource
        .reserve_review(&app, &registry, &selection, &request(project.path(), 2))
        .unwrap();
    assert!(resource.cancel_review(&app, &selection, 3, None).unwrap());
    assert!(resource
        .check_review(&app, &selection, &second, Phase::Opening)
        .is_err());
    assert!(resource
        .reserve_review(&app, &registry, &selection, &request(project.path(), 3))
        .is_err());
    let fourth = resource
        .reserve_review(&app, &registry, &selection, &request(project.path(), 4))
        .unwrap();
    for revision in [0, 9_007_199_254_740_992] {
        assert!(resource
            .cancel_review(&app, &selection, revision, None)
            .is_err());
    }
    assert!(!resource.cancel_review(&app, &selection, 3, None).unwrap());
    resource
        .check_review(&app, &selection, &fourth, Phase::Opening)
        .unwrap();
    assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}

#[test]
fn failed_new_destination_retires_acceptance_and_cannot_restore_it() {
    let (_state, app, resource) = fixture();
    let project = project();
    let (registry, selection) = select(&app, &resource, project.path());
    let first = resource
        .reserve_review(&app, &registry, &selection, &request(project.path(), 1))
        .unwrap();
    let mut unsupported = request(project.path(), 2);
    unsupported.environment = WorkspaceEnv::Wsl {
        distro: "foreign".into(),
    };
    assert_eq!(
        resource
            .reserve_review(&app, &registry, &selection, &unsupported)
            .err()
            .unwrap()
            .code,
        "unsupported"
    );
    assert!(resource
        .check_review(&app, &selection, &first, Phase::Opening)
        .is_err());
    assert!(!app.is_preview_current(
        &resource.window,
        &resource.receipt,
        &first.selection,
        &first.receipt
    ));
    assert!(resource
        .reserve_review(&app, &registry, &selection, &request(project.path(), 2))
        .is_err());
    assert!(resource
        .reserve_review(&app, &registry, &selection, &request(project.path(), 3))
        .is_ok());
}

#[test]
fn preview_errors_never_initialize_state_or_keep_an_acceptance() {
    let (state, app, resource) = fixture();
    let project = project();
    let (registry, selection) = select(&app, &resource, project.path());
    runtime().block_on(async {
        assert_eq!(
            preview(
                &app,
                &registry,
                &resource,
                &selection,
                request(project.path(), 1)
            )
            .await
            .unwrap_err()
            .code,
            "unavailable"
        );
        assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
        let mut oversized = request(project.path(), 2);
        oversized
            .inputs
            .insert("project_name".into(), "x".repeat(16 * 1024 + 1));
        assert_eq!(
            preview(&app, &registry, &resource, &selection, oversized)
                .await
                .unwrap_err()
                .code,
            "limit"
        );
        assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
        assert!(!resource.cancel_review(&app, &selection, 2, None).unwrap());
        assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
        initialize(&app, &resource).await;
        let preferences = state.path().join("project-memory/memory-local.json");
        fs::remove_file(&preferences).unwrap();
        assert_eq!(
            preview(
                &app,
                &registry,
                &resource,
                &selection,
                request(project.path(), 3)
            )
            .await
            .unwrap_err()
            .code,
            "missingState"
        );
        assert!(!preferences.exists());
        assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
    });
}

#[test]
fn cancellation_while_private_store_is_queued_prevents_its_io_and_late_adoption() {
    let (state, app, resource) = fixture();
    let project = project();
    let (registry, selection) = select(&app, &resource, project.path());
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .max_blocking_threads(1)
        .enable_all()
        .build()
        .unwrap();
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let blocked = runtime.spawn_blocking(move || {
        started_tx.send(()).unwrap();
        release_rx.recv().unwrap();
    });
    started_rx.recv().unwrap();
    runtime.block_on(async {
        let pending = preview(&app, &registry, &resource, &selection, request(project.path(), 1));
        tokio::pin!(pending);
        tokio::select! { biased; _ = &mut pending => panic!("store must be queued"), _ = tokio::task::yield_now() => {} }
        assert!(resource.cancel_review(&app, &selection, 1, None).unwrap());
        release_tx.send(()).unwrap();
        blocked.await.unwrap();
        assert_eq!(pending.await.unwrap_err().code, "cancelled");
    });
    assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}

#[test]
fn completed_old_worker_cannot_adopt_after_a_replacement_or_selection_round_trip() {
    let (_state, app, resource) = fixture();
    let project = project();
    let (registry, selection) = select(&app, &resource, project.path());
    runtime().block_on(async {
        initialize(&app, &resource).await;
        let input = request(project.path(), 1);
        let old = resource
            .reserve_review(&app, &registry, &selection, &input)
            .unwrap();
        let store = app
            .open_preview_store(
                &resource.window,
                &resource.receipt,
                &old.selection,
                &old.receipt,
            )
            .await
            .unwrap();
        let prepared = app
            .start_preview(
                &resource.window,
                &resource.receipt,
                &old.selection,
                &old.receipt,
                input.values(store),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        let newer = resource
            .reserve_review(&app, &registry, &selection, &request(project.path(), 2))
            .unwrap();
        assert_eq!(
            resource
                .adopt_review(&app, &selection, &old, prepared)
                .unwrap_err()
                .code,
            "cancelled"
        );
        resource
            .check_review(&app, &selection, &newer, Phase::Opening)
            .unwrap();
        let next = resource
            .select(
                &app,
                &registry,
                project.path().into(),
                &WorkspaceEnv::Local,
                2,
            )
            .unwrap();
        assert!(resource
            .check_review(&app, &selection, &newer, Phase::Opening)
            .is_err());
        let fresh = preview(
            &app,
            &registry,
            &resource,
            &next,
            request(project.path(), 1),
        )
        .await
        .unwrap();
        assert_eq!(
            confirm(&app, &registry, &resource, &selection, &fresh.review)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        confirm(&app, &registry, &resource, &next, &fresh.review)
            .await
            .unwrap();
    });
}

#[test]
fn denied_write_admission_consumes_acceptance_without_falling_back_to_read_grants() {
    let (_state, app, resource) = fixture();
    let project = project();
    let (registry, selection) = select(&app, &resource, project.path());
    runtime().block_on(async {
        initialize(&app, &resource).await;
        let ready = preview(
            &app,
            &registry,
            &resource,
            &selection,
            request(project.path(), 1),
        )
        .await
        .unwrap();
        assert_eq!(
            confirm(
                &app,
                &WorkspaceRegistry::default(),
                &resource,
                &selection,
                &ready.review
            )
            .await
            .unwrap_err()
            .code,
            "denied"
        );
        assert_eq!(
            confirm(&app, &registry, &resource, &selection, &ready.review)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
    });
}

#[test]
fn duplicate_or_foreign_confirmation_cannot_borrow_or_retire_a_current_publication() {
    let (_state, app, resource) = fixture();
    let (_other_state, foreign, _other_resource) = fixture();
    let project = project();
    let (registry, selection) = select(&app, &resource, project.path());
    runtime().block_on(async {
        initialize(&app, &resource).await;
        let ready = preview(
            &app,
            &registry,
            &resource,
            &selection,
            request(project.path(), 1),
        )
        .await
        .unwrap();
        assert!(resource
            .begin_publication(&foreign, &registry, &selection, &ready.review)
            .is_err());
        assert!(resource
            .begin_publication(
                &app,
                &registry,
                &selection,
                &uuid::Uuid::new_v4().to_string()
            )
            .is_err());
        let (capture, job) = resource
            .begin_publication(&app, &registry, &selection, &ready.review)
            .unwrap();
        assert!(resource
            .begin_publication(&app, &registry, &selection, &ready.review)
            .is_err());
        let report = job.unwrap().finish().await.unwrap();
        resource
            .check_review(&app, &selection, &capture, Phase::Publishing)
            .unwrap();
        assert!(!report.created.is_empty());
        resource
            .cancel_review(&app, &selection, capture.revision, Some(&capture.token))
            .unwrap();
    });
}

#[test]
fn publication_conflict_preserves_foreign_bytes_and_returns_an_acknowledged_changes_report() {
    let (_state, app, resource) = fixture();
    let project = project();
    let (registry, selection) = select(&app, &resource, project.path());
    runtime().block_on(async {
        initialize(&app, &resource).await;
        let ready = preview(
            &app,
            &registry,
            &resource,
            &selection,
            request(project.path(), 1),
        )
        .await
        .unwrap();
        fs::create_dir(project.path().join(".voktty")).unwrap();
        fs::write(project.path().join(".voktty/INIT.md"), "foreign bytes").unwrap();
        let error = confirm(&app, &registry, &resource, &selection, &ready.review)
            .await
            .unwrap_err();
        assert!(matches!(error.code, "stale" | "scope" | "conflict"));
        let changes = error.changes.unwrap();
        assert!(changes.created.is_empty());
        assert!(changes.migrated.is_empty());
        assert_eq!(
            fs::read_to_string(project.path().join(".voktty/INIT.md")).unwrap(),
            "foreign bytes"
        );
        assert!(!project.path().join(".voktty/kit.json").exists());
        assert_eq!(
            confirm(&app, &registry, &resource, &selection, &ready.review)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
    });
}

#[test]
fn wire_contracts_reject_client_plans_and_never_serialize_native_error_details() {
    let input = json!({"revision":1,"destination":"/work/project","environment":{"kind":"local"},"inputs":{"project_name":"Example"},"links":{"agents":false,"claude":false}});
    for (field, value) in [
        ("plan", json!({})),
        ("writeAccess", json!(true)),
        ("store", json!("/private")),
    ] {
        let mut invalid = input.clone();
        invalid[field] = value;
        assert!(serde_json::from_value::<PreviewRequest>(invalid).is_err());
    }
    let mut invalid = input.clone();
    invalid["links"]["all"] = true.into();
    assert!(serde_json::from_value::<PreviewRequest>(invalid).is_err());
    invalid = input;
    invalid["inputs"]["project_name"] = json!({"injected":"nested"});
    assert!(serde_json::from_value::<PreviewRequest>(invalid).is_err());
    let error: DeploymentCommandError =
        MemoryDeploymentWorkError::Preview(PublicationError::RecoveryRequired(vec![
            "private native diagnostic".into(),
        ]))
        .into();
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        json!({"code":"recoveryRequired"})
    );
    let error: DeploymentCommandError = ReadError::Contract(vec![]).into();
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        json!({"code":"unavailable"})
    );
}

#[test]
fn preview_reports_the_owned_canonical_root_for_an_explicit_destination_alias() {
    let (_state, app, resource) = fixture();
    let project = project();
    let actual = project.path().join("actual");
    let alias = project.path().join("picked");
    fs::create_dir(&actual).unwrap();
    std::os::unix::fs::symlink(&actual, &alias).unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(project.path()).unwrap();
    registry.authorize("/dev").unwrap();
    let selected = resource
        .select(&app, &registry, actual.clone(), &WorkspaceEnv::Local, 1)
        .unwrap();
    runtime().block_on(async {
        initialize(&app, &resource).await;
        let prepared = preview(&app, &registry, &resource, &selected, request(&alias, 1))
            .await
            .unwrap();
        assert_eq!(prepared.root, fs::canonicalize(&actual).unwrap());
        assert_ne!(prepared.root, alias);
        assert!(!actual.join(".voktty").exists());
        confirm(&app, &registry, &resource, &selected, &prepared.review)
            .await
            .unwrap();
        assert!(actual.join(".voktty/kit.json").exists());
        assert!(!project.path().join(".voktty").exists());
    });
}
