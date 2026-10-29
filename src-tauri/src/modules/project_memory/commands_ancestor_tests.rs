use super::*;
use crate::modules::project_memory::commands::tests::fixture;
use crate::modules::project_memory::tests::{populate, project, runtime};
use std::fs;

fn request(root: &Path) -> PreviewRequest {
    serde_json::from_value(serde_json::json!({
        "revision": 1, "destination": root, "environment": {"kind":"local"},
        "inputs": {"project_name":"Explicit inspection", "created_at":"2026-10-29"},
        "links": {"agents":false, "claude":false}
    }))
    .unwrap()
}

#[test]
fn explicit_selection_inspection_allows_real_deployment_without_authorizing_parents() {
    let (state, app, resource) = fixture();
    let parent = project();
    let root = parent.path().join("project");
    fs::create_dir(&root).unwrap();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(root).unwrap();
    let ordinary = resource
        .select(&app, &registry, root.clone(), &WorkspaceEnv::Local, 1)
        .unwrap();
    runtime().block_on(async {
        app.store(
            &resource.window,
            MemoryStoreMode::Initialize,
            ReadControl::default(),
        )
        .await
        .unwrap();
        let preferences = fs::read(state.path().join("project-memory/memory-local.json")).unwrap();
        assert!(
            !super::super::discover(&app, &resource, &ordinary)
                .await
                .unwrap()
                .scope
                .ancestry_complete
        );
        let inspected = resource
            .select_with_inspection(&app, &registry, root.clone(), &WorkspaceEnv::Local, 2, true)
            .unwrap();
        assert!(resource.check(&app, &ordinary).is_err());
        assert!(
            super::super::discover(&app, &resource, &inspected)
                .await
                .unwrap()
                .scope
                .ancestry_complete
        );
        let prepared = preview(&app, &registry, &resource, &inspected, request(&root))
            .await
            .unwrap();
        assert!(prepared.deployment.plan.can_publish);
        assert!(!root.join(".voktty").exists());
        let report = confirm(&app, &registry, &resource, &inspected, &prepared.review)
            .await
            .unwrap();
        assert!(report.created.contains(&".voktty/kit.json".to_owned()));
        assert!(!parent.path().join(".voktty").exists());
        assert!(!registry.is_authorized(parent.path()));
        assert!(!registry.is_authorized(Path::new("/dev")));
        assert_eq!(
            fs::read(state.path().join("project-memory/memory-local.json")).unwrap(),
            preferences
        );
        let disabled = resource
            .select(&app, &registry, root.clone(), &WorkspaceEnv::Local, 3)
            .unwrap();
        assert!(resource.check(&app, &inspected).is_err());
        assert!(
            !super::super::discover(&app, &resource, &disabled)
                .await
                .unwrap()
                .scope
                .ancestry_complete
        );
    });
}

#[test]
fn inspecting_parent_memory_cannot_promote_it_to_a_workspace_or_publish_nested_memory() {
    let (_state, app, resource) = fixture();
    let parent = project();
    populate(parent.path());
    let root = parent.path().join("project");
    fs::create_dir(&root).unwrap();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(root).unwrap();
    let selected = resource
        .select_with_inspection(&app, &registry, root.clone(), &WorkspaceEnv::Local, 1, true)
        .unwrap();
    runtime().block_on(async {
        app.store(
            &resource.window,
            MemoryStoreMode::Initialize,
            ReadControl::default(),
        )
        .await
        .unwrap();
        let observed = super::super::discover(&app, &resource, &selected)
            .await
            .unwrap();
        assert_eq!(observed.scope.state, "ready");
        assert_eq!(observed.root.as_deref(), parent.path().to_str());
        let error = preview(&app, &registry, &resource, &selected, request(&root))
            .await
            .unwrap_err();
        assert_eq!(error.code, "scope");
        assert!(!root.join(".voktty").exists());
        let mut parent_request = request(parent.path());
        parent_request.revision = 2;
        let denied = preview(&app, &registry, &resource, &selected, parent_request)
            .await
            .unwrap_err();
        assert_eq!(denied.code, "denied");
    });
    assert!(!registry.is_authorized(parent.path()));
}

#[test]
fn a_registered_unrelated_destination_cannot_borrow_the_origins_ancestor_consent() {
    let (_state, app, resource) = fixture();
    let first = project();
    let second = project();
    let registry = WorkspaceRegistry::default();
    let origin = first.path().join("project");
    let destination = second.path().join("project");
    fs::create_dir(&origin).unwrap();
    fs::create_dir(&destination).unwrap();
    let origin = registry.authorize(origin).unwrap();
    let destination = registry.authorize(destination).unwrap();
    let selected = resource
        .select_with_inspection(&app, &registry, origin, &WorkspaceEnv::Local, 1, true)
        .unwrap();
    runtime().block_on(async {
        app.store(
            &resource.window,
            MemoryStoreMode::Initialize,
            ReadControl::default(),
        )
        .await
        .unwrap();
        let error = preview(&app, &registry, &resource, &selected, request(&destination))
            .await
            .unwrap_err();
        assert_eq!(error.code, "scope");
        assert!(!destination.join(".voktty").exists());
        let consented = resource
            .select_with_inspection(
                &app,
                &registry,
                destination.clone(),
                &WorkspaceEnv::Local,
                2,
                true,
            )
            .unwrap();
        let prepared = preview(
            &app,
            &registry,
            &resource,
            &consented,
            request(&destination),
        )
        .await
        .unwrap();
        assert!(prepared.deployment.plan.can_publish);
        assert!(!destination.join(".voktty").exists());
    });
    assert!(!registry.is_authorized(second.path()));
}
