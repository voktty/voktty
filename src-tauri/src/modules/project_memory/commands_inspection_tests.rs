use super::*;
use crate::modules::project_memory::tests::{populate, project, runtime};

#[test]
fn marker_inspection_needs_no_private_state_and_returns_only_scope_metadata() {
    let (state, app, resource) = tests::fixture();
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    let token = resource
        .select(&app, &registry, root.clone(), &WorkspaceEnv::Local, 1)
        .unwrap();
    runtime().block_on(async {
        let reply = inspect(&app, &resource, &token).await.unwrap();
        assert_eq!(reply.scope.state, "incomplete");
        assert!(!reply.scope.ancestry_complete);
        assert!(reply.root.is_none());
        assert_eq!(std::fs::read_dir(state.path()).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        populate(&root);
        let token = resource
            .select_with_inspection(&app, &registry, root, &WorkspaceEnv::Local, 2, true)
            .unwrap();
        let reply = inspect(&app, &resource, &token).await.unwrap();
        assert_eq!(reply.scope.state, "ready");
        assert!(reply.scope.ancestry_complete);
        assert!(reply.root.is_some());
        let value = serde_json::to_value(reply).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 4);
        for forbidden in [
            "instructions",
            "localPreferences",
            "installationId",
            "blockedPaths",
            "facts",
        ] {
            assert!(value.get(forbidden).is_none());
        }
        assert_eq!(std::fs::read_dir(state.path()).unwrap().count(), 0);
        assert!(!dir.path().join(".voktty/state").exists());
    });
}

#[test]
fn marker_inspection_rejects_foreign_and_retired_selections_and_pending_delivery() {
    for retirement in ["selection", "presentation", "window", "shutdown"] {
        let (state, app, resource) = tests::fixture();
        let (_foreign_state, foreign, _foreign_resource) = tests::fixture();
        let dir = project();
        let registry = WorkspaceRegistry::default();
        let root = registry.authorize(dir.path()).unwrap();
        let token = resource
            .select(&app, &registry, root.clone(), &WorkspaceEnv::Local, 1)
            .unwrap();
        runtime().block_on(async {
            assert_eq!(
                inspect(&foreign, &resource, &token).await.unwrap_err().code,
                "cancelled"
            );
            let selected = resource.check(&app, &token).unwrap();
            let pending = app
                .inspect_scope(
                    &resource.window,
                    &resource.receipt,
                    &selected,
                    DiscoveryControl::default(),
                )
                .unwrap();
            match retirement {
                "selection" => {
                    resource
                        .select(&app, &registry, root, &WorkspaceEnv::Local, 2)
                        .unwrap();
                }
                "presentation" => resource.retire(),
                "window" => resource.window.retire(),
                "shutdown" => app.shutdown(),
                _ => unreachable!(),
            }
            assert!(matches!(
                pending.finish().await,
                Err(MemoryWorkError::Read(ReadError::Cancelled))
            ));
            assert_eq!(
                inspect(&app, &resource, &token).await.unwrap_err().code,
                "cancelled"
            );
            assert_eq!(std::fs::read_dir(state.path()).unwrap().count(), 0);
        });
    }
}

#[test]
fn marker_inspection_uses_the_shared_four_job_budget_and_original_deadline() {
    let (_state, app, resource) = tests::fixture();
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    let token = resource
        .select(&app, &registry, root, &WorkspaceEnv::Local, 1)
        .unwrap();
    runtime().block_on(async {
        let selected = resource.check(&app, &token).unwrap();
        let mut pending = Vec::new();
        for _ in 0..4 {
            pending.push(
                app.inspect_scope(
                    &resource.window,
                    &resource.receipt,
                    &selected,
                    DiscoveryControl::default(),
                )
                .unwrap(),
            );
        }
        assert!(matches!(
            app.inspect_scope(
                &resource.window,
                &resource.receipt,
                &selected,
                DiscoveryControl::default()
            ),
            Err(MemoryWorkError::Read(ReadError::Busy))
        ));
        for job in pending {
            job.finish().await.unwrap();
        }
        assert!(matches!(
            app.inspect_scope(
                &resource.window,
                &resource.receipt,
                &selected,
                DiscoveryControl::new(std::time::Duration::ZERO)
            ),
            Err(MemoryWorkError::Read(ReadError::Timeout))
        ));
        inspect(&app, &resource, &token).await.unwrap();
    });
}

#[cfg(unix)]
#[test]
fn marker_inspection_refuses_secret_and_unregistered_canonical_aliases() {
    let (state, app, resource) = tests::fixture();
    let dir = project();
    let outside = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    std::fs::create_dir(root.join(".ssh")).unwrap();
    std::os::unix::fs::symlink(root.join(".ssh"), root.join("secret-alias")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.join("outside-alias")).unwrap();
    runtime().block_on(async {
        for (index, alias) in ["secret-alias", "outside-alias"].iter().enumerate() {
            let token = resource
                .select(
                    &app,
                    &registry,
                    root.join(alias),
                    &WorkspaceEnv::Local,
                    index as u64 + 1,
                )
                .unwrap();
            assert_eq!(
                inspect(&app, &resource, &token).await.unwrap_err().code,
                "denied"
            );
        }
        assert_eq!(std::fs::read_dir(state.path()).unwrap().count(), 0);
        assert!(!registry.is_authorized(outside.path()));
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
    });
}
