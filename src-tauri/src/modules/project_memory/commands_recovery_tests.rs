use super::*;
use crate::modules::project_memory::commands::tests::fixture;
use crate::modules::project_memory::tests::{project, runtime};
use serde_json::json;
use std::fs;
use std::time::Duration;
use voktty_memory_local::MemoryWriteAccess;

#[test]
fn cancelling_queued_recovery_store_prevents_io_and_cannot_adopt_after_retirement() {
    let (state, app, resource) = fixture();
    let project = project();
    let (registry, selected) = select(&app, &resource, project.path());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    runtime.block_on(async {
        let (started, observed) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel();
        let occupied = tokio::task::spawn_blocking(move || {
            started.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(3)).unwrap();
        });
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        let pending = review_recovery(&app, &registry, &resource, &selected, request(project.path(), 1));
        tokio::pin!(pending);
        tokio::select! { biased; _ = &mut pending => panic!("store should be queued"), _ = tokio::task::yield_now() => {} }
        assert!(resource.cancel_review(&app, &selected, 1, None).unwrap());
        release.send(()).unwrap();
        occupied.await.unwrap();
        assert_eq!(pending.await.unwrap_err().code, "cancelled");
        assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
        assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
    });
}

#[test]
fn late_recovery_artifact_cannot_replace_a_publication_or_same_path_successor() {
    for replace_selection in [false, true] {
        let (_state, app, resource) = fixture();
        let project = project();
        let (registry, selected) = select(&app, &resource, project.path());
        runtime().block_on(async {
            interrupted(&app, &resource, &registry, &selected, project.path()).await;
            let capture = resource
                .reserve_recovery_review(&app, &registry, &selected, &request(project.path(), 1))
                .unwrap();
            let store = app
                .open_recovery_store(
                    &resource.window,
                    &resource.receipt,
                    &capture.selection,
                    &capture.receipt,
                )
                .await
                .unwrap();
            let prepared = app
                .start_recovery(
                    &resource.window,
                    &resource.receipt,
                    &capture.selection,
                    &capture.receipt,
                    store,
                )
                .unwrap()
                .finish()
                .await
                .unwrap();
            let current_selection = if replace_selection {
                resource
                    .select(
                        &app,
                        &registry,
                        project.path().into(),
                        &WorkspaceEnv::Local,
                        2,
                    )
                    .unwrap()
            } else {
                selected.clone()
            };
            let current = resource
                .reserve_review(
                    &app,
                    &registry,
                    &current_selection,
                    &publication_request(project.path(), 2),
                )
                .unwrap();
            assert_eq!(
                resource
                    .adopt_recovery_review(&app, &selected, &capture, prepared)
                    .unwrap_err()
                    .code,
                "cancelled"
            );
            assert!(!resource
                .cancel_review(&app, &current_selection, 1, Some(&capture.token))
                .unwrap());
            resource
                .check_review(&app, &current_selection, &current, Phase::Opening)
                .unwrap();
        });
    }
}

#[test]
fn retiring_presentation_during_queued_confirmation_preserves_original_and_suppresses_result() {
    let (_state, app, resource) = fixture();
    let project = project();
    let (registry, selected) = select(&app, &resource, project.path());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    runtime.block_on(async {
        let backup = interrupted(&app, &resource, &registry, &selected, project.path()).await;
        let reply = review_recovery(&app, &registry, &resource, &selected, request(project.path(), 1)).await.unwrap();
        let (started, observed) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel();
        let occupied = tokio::task::spawn_blocking(move || {
            started.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(3)).unwrap();
        });
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        let pending = confirm_recovery(&app, &registry, &resource, &selected, confirmation(&reply));
        tokio::pin!(pending);
        tokio::select! { biased; _ = &mut pending => panic!("restore should be queued"), _ = tokio::task::yield_now() => {} }
        resource.retire();
        release.send(()).unwrap();
        occupied.await.unwrap();
        assert_eq!(pending.await.unwrap_err().code, "cancelled");
        assert_eq!(fs::read(project.path().join(backup)).unwrap(), b"*\r\n");
        assert!(!project.path().join(".voktty/.gitignore").exists());
    });
}

fn select(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
    root: &Path,
) -> (WorkspaceRegistry, String) {
    let registry = WorkspaceRegistry::default();
    registry.authorize(root).unwrap();
    registry.authorize("/dev").unwrap();
    let selected = resource
        .select(app, &registry, root.into(), &WorkspaceEnv::Local, 1)
        .unwrap();
    (registry, selected)
}
fn request(root: &Path, revision: u64) -> RecoveryRequest {
    serde_json::from_value(
        json!({"revision":revision,"destination":root,"environment":{"kind":"local"}}),
    )
    .unwrap()
}
fn publication_request(root: &Path, revision: u64) -> PreviewRequest {
    serde_json::from_value(json!({"revision":revision,"destination":root,"environment":{"kind":"local"},
        "inputs":{"project_name":"Recovery IPC","created_at":"2026-11-03"},"links":{"agents":false,"claude":false}})).unwrap()
}
fn confirmation(reply: &RecoveryReviewReply) -> RecoveryConfirmation {
    RecoveryConfirmation {
        review: reply.review.clone(),
        digest: reply.digest.clone(),
    }
}

struct InterruptedMigration(PathBuf);
impl MemoryWriteAccess for InterruptedMigration {
    fn allows_create(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
            && !(path.ends_with("RULES.md") && self.0.join(".voktty/INIT.md").exists())
    }
    fn allows_replace(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
}

async fn interrupted(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
    registry: &WorkspaceRegistry,
    selected: &str,
    root: &Path,
) -> String {
    fs::create_dir(root.join(".voktty")).unwrap();
    fs::write(root.join(".voktty/.gitignore"), "*\r\n").unwrap();
    let store = app
        .store(
            &resource.window,
            MemoryStoreMode::Initialize,
            ReadControl::default(),
        )
        .await
        .unwrap();
    let native_selection = resource.capture(selected).unwrap();
    let read = app
        .prepare_preview(
            &resource.window,
            &resource.receipt,
            &native_selection,
            registry,
            NativeMemoryPreviewRequest {
                destination: root.into(),
                environment: WorkspaceEnv::Local,
                store,
                inputs: json!({"project_name":"Recovery IPC","created_at":"2026-11-03"})
                    .as_object()
                    .unwrap()
                    .clone(),
                links: RootLinks::default(),
                control: DiscoveryControl::default(),
            },
        )
        .unwrap();
    let receipt = app
        .accept_preview(
            &resource.window,
            &resource.receipt,
            &native_selection,
            read.finish().await.unwrap(),
        )
        .unwrap();
    let failure = app
        .publish_preview(
            &resource.window,
            &resource.receipt,
            &native_selection,
            &receipt,
            Arc::new(InterruptedMigration(root.into())),
            DiscoveryControl::default(),
        )
        .unwrap()
        .finish()
        .await
        .unwrap_err();
    let MemoryDeploymentWorkError::Publication(failure) = failure else {
        panic!("interrupted migration required")
    };
    let backup = failure.possible_recovery_files[0].clone();
    assert_eq!(fs::read(root.join(&backup)).unwrap(), b"*\r\n");
    fs::remove_file(root.join(".voktty/.gitignore")).unwrap();
    backup
}

#[test]
fn recovery_ipc_restores_exact_reviewed_bytes_once_and_preserves_intent_and_preferences() {
    let (state, app, resource) = fixture();
    let project = project();
    let (registry, selected) = select(&app, &resource, project.path());
    runtime().block_on(async {
        let backup = interrupted(&app, &resource, &registry, &selected, project.path()).await;
        let intent = fs::read(state.path().join("project-memory/memory-deployment.json")).unwrap();
        let prefs = fs::read(state.path().join("project-memory/memory-local.json")).unwrap();
        let reply = review_recovery(
            &app,
            &registry,
            &resource,
            &selected,
            request(project.path(), 1),
        )
        .await
        .unwrap();
        let accepted = confirmation(&reply);
        let duplicate = confirmation(&reply);
        let mut wire = serde_json::to_value(&reply).unwrap();
        assert_eq!(wire.as_object().unwrap().len(), 6);
        assert_eq!(wire["schema"], 1);
        assert_eq!(
            wire["entries"][0],
            json!({"target":".voktty/.gitignore","backup":backup,"text":"*\r\n"})
        );
        wire["entries"][0]["text"] = "forged display".into();
        wire["root"] = "forged destination".into();
        assert!(!project.path().join(".voktty/.gitignore").exists());
        assert_eq!(
            super::super::confirm(&app, &registry, &resource, &selected, &reply.review)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        let result = confirm_recovery(&app, &registry, &resource, &selected, accepted)
            .await
            .unwrap();
        assert_eq!(result.created, vec![".voktty/.gitignore"]);
        assert_eq!(result.cleaned, vec![backup]);
        assert_eq!(
            fs::read(project.path().join(".voktty/.gitignore")).unwrap(),
            b"*\r\n"
        );
        assert_eq!(
            fs::read(state.path().join("project-memory/memory-deployment.json")).unwrap(),
            intent
        );
        assert_eq!(
            fs::read(state.path().join("project-memory/memory-local.json")).unwrap(),
            prefs
        );
        assert!(!project.path().join(".voktty/kit.json").exists());
        assert_eq!(
            confirm_recovery(&app, &registry, &resource, &selected, duplicate)
                .await
                .unwrap_err()
                .code,
            "cancelled"
        );
        let preview = super::super::preview(
            &app,
            &registry,
            &resource,
            &selected,
            publication_request(project.path(), 2),
        )
        .await
        .unwrap();
        super::super::confirm(&app, &registry, &resource, &selected, &preview.review)
            .await
            .unwrap();
        assert!(project.path().join(".voktty/kit.json").exists());
    });
}

#[test]
fn shared_revision_and_cancel_tombstones_order_both_deployment_operations() {
    let (state, app, resource) = fixture();
    let project = project();
    let (registry, selected) = select(&app, &resource, project.path());
    let recovery = resource
        .reserve_recovery_review(&app, &registry, &selected, &request(project.path(), 1))
        .unwrap();
    let preview = resource
        .reserve_review(
            &app,
            &registry,
            &selected,
            &publication_request(project.path(), 2),
        )
        .unwrap();
    assert!(resource
        .reserve_recovery_review(&app, &registry, &selected, &request(project.path(), 1))
        .is_err());
    assert!(resource
        .reserve_recovery_review(&app, &registry, &selected, &request(project.path(), 2))
        .is_err());
    assert!(!resource
        .cancel_review(&app, &selected, 1, Some(&recovery.token))
        .unwrap());
    resource
        .check_review(&app, &selected, &preview, Phase::Opening)
        .unwrap();
    assert!(resource.cancel_review(&app, &selected, 3, None).unwrap());
    assert!(resource
        .reserve_recovery_review(&app, &registry, &selected, &request(project.path(), 3))
        .is_err());
    let newer = resource
        .reserve_recovery_review(&app, &registry, &selected, &request(project.path(), 4))
        .unwrap();
    assert!(!resource
        .cancel_review(&app, &selected, 2, Some(&preview.token))
        .unwrap());
    resource
        .check_recovery_review(&app, &selected, &newer, Phase::Opening)
        .unwrap();
    assert!(resource
        .reserve_review(
            &app,
            &registry,
            &selected,
            &publication_request(project.path(), 3)
        )
        .is_err());
    assert!(resource.cancel_review(&app, &selected, 5, None).unwrap());
    assert!(resource
        .reserve_review(
            &app,
            &registry,
            &selected,
            &publication_request(project.path(), 5)
        )
        .is_err());
    for revision in [0, 9_007_199_254_740_992] {
        assert!(resource
            .reserve_recovery_review(
                &app,
                &registry,
                &selected,
                &request(project.path(), revision)
            )
            .is_err());
    }
    assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}

#[test]
fn recovery_errors_do_not_initialize_state_and_failed_new_target_retires_both_kinds() {
    let (state, app, resource) = fixture();
    let project = project();
    let (registry, selected) = select(&app, &resource, project.path());
    runtime().block_on(async {
        assert_eq!(
            review_recovery(
                &app,
                &registry,
                &resource,
                &selected,
                request(project.path(), 1)
            )
            .await
            .unwrap_err()
            .code,
            "unavailable"
        );
        assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
        let old = resource
            .reserve_review(
                &app,
                &registry,
                &selected,
                &publication_request(project.path(), 2),
            )
            .unwrap();
        let mut input = request(project.path(), 3);
        input.environment = WorkspaceEnv::Wsl {
            distro: "unsupported".into(),
        };
        assert_eq!(
            resource
                .reserve_recovery_review(&app, &registry, &selected, &input)
                .err()
                .unwrap()
                .code,
            "unsupported"
        );
        assert!(!app.is_preview_current(
            &resource.window,
            &resource.receipt,
            &old.selection,
            &old.receipt
        ));
        let recovery = resource
            .reserve_recovery_review(&app, &registry, &selected, &request(project.path(), 4))
            .unwrap();
        let mut input = publication_request(project.path(), 5);
        input.environment = WorkspaceEnv::Wsl {
            distro: "unsupported".into(),
        };
        assert!(resource
            .reserve_review(&app, &registry, &selected, &input)
            .is_err());
        assert!(!app.is_recovery_current(
            &resource.window,
            &resource.receipt,
            &recovery.selection,
            &recovery.receipt
        ));
        assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
    });
}

#[test]
fn wrong_digest_or_denied_write_consumes_recovery_without_moving_backups() {
    for invalid in [false, true] {
        let (_state, app, resource) = fixture();
        let project = project();
        let (registry, selected) = select(&app, &resource, project.path());
        runtime().block_on(async {
            let backup = interrupted(&app, &resource, &registry, &selected, project.path()).await;
            let reply = review_recovery(
                &app,
                &registry,
                &resource,
                &selected,
                request(project.path(), 1),
            )
            .await
            .unwrap();
            let mut input = confirmation(&reply);
            let empty = WorkspaceRegistry::default();
            if invalid {
                input.digest = "0".repeat(64);
            }
            let error = confirm_recovery(
                &app,
                if invalid { &registry } else { &empty },
                &resource,
                &selected,
                input,
            )
            .await
            .unwrap_err();
            assert_eq!(error.code, if invalid { "stale" } else { "denied" });
            assert_eq!(
                confirm_recovery(&app, &registry, &resource, &selected, confirmation(&reply))
                    .await
                    .unwrap_err()
                    .code,
                "cancelled"
            );
            assert_eq!(fs::read(project.path().join(backup)).unwrap(), b"*\r\n");
            assert!(!project.path().join(".voktty/.gitignore").exists());
        });
    }
}

#[test]
fn foreign_or_duplicate_confirmations_cannot_consume_the_current_restoration() {
    let (_state, app, resource) = fixture();
    let (_other, foreign, _foreign_resource) = fixture();
    let project = project();
    let (registry, selected) = select(&app, &resource, project.path());
    runtime().block_on(async {
        interrupted(&app, &resource, &registry, &selected, project.path()).await;
        let reply = review_recovery(
            &app,
            &registry,
            &resource,
            &selected,
            request(project.path(), 1),
        )
        .await
        .unwrap();
        assert!(resource
            .begin_restoration(&foreign, &registry, &selected, confirmation(&reply))
            .is_err());
        let (capture, job) = resource
            .begin_restoration(&app, &registry, &selected, confirmation(&reply))
            .unwrap();
        assert!(resource
            .begin_restoration(&app, &registry, &selected, confirmation(&reply))
            .is_err());
        job.unwrap().finish().await.unwrap();
        resource
            .check_recovery_review(&app, &selected, &capture, Phase::Restoring)
            .unwrap();
        resource
            .cancel_review(&app, &selected, capture.revision, Some(&capture.token))
            .unwrap();
    });
}

#[test]
fn changed_target_returns_partial_change_report_and_preserves_foreign_bytes() {
    let (_state, app, resource) = fixture();
    let project = project();
    let (registry, selected) = select(&app, &resource, project.path());
    runtime().block_on(async {
        let backup = interrupted(&app, &resource, &registry, &selected, project.path()).await;
        let reply = review_recovery(
            &app,
            &registry,
            &resource,
            &selected,
            request(project.path(), 1),
        )
        .await
        .unwrap();
        fs::write(project.path().join(".voktty/.gitignore"), "foreign").unwrap();
        let error = confirm_recovery(&app, &registry, &resource, &selected, confirmation(&reply))
            .await
            .unwrap_err();
        assert_eq!(error.code, "stale");
        let report = error.changes.unwrap();
        assert!(report.created.is_empty());
        assert!(report.cleaned.is_empty());
        assert_eq!(
            fs::read(project.path().join(".voktty/.gitignore")).unwrap(),
            b"foreign"
        );
        assert_eq!(fs::read(project.path().join(backup)).unwrap(), b"*\r\n");
    });
}

#[test]
fn recovery_wire_contracts_reject_client_plans_and_bound_native_path_inputs() {
    let input = json!({"revision":1,"destination":"/work/project","environment":{"kind":"local"}});
    for field in [
        "entries",
        "digest",
        "store",
        "writeAccess",
        "origin",
        "plan",
    ] {
        let mut invalid = input.clone();
        invalid[field] = json!({});
        assert!(serde_json::from_value::<RecoveryRequest>(invalid).is_err());
    }
    let accepted = json!({"review":uuid::Uuid::new_v4().to_string(),"digest":"0".repeat(64)});
    for field in ["entries", "root", "writeAccess", "revision"] {
        let mut invalid = accepted.clone();
        invalid[field] = true.into();
        assert!(serde_json::from_value::<RecoveryConfirmation>(invalid).is_err());
    }
    assert!(request(Path::new("relative"), 1).validate().is_err());
    assert_eq!(
        request(Path::new(&format!("/{}", "x".repeat(4096))), 1).validate(),
        Err(ReadError::Limit)
    );
}
