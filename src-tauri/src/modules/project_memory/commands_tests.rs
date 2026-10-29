use super::*;
use crate::modules::project_memory::tests::{populate, project, runtime};

pub(super) fn fixture() -> (
    tempfile::TempDir,
    NativeMemoryApplication,
    Arc<PresentationResource>,
) {
    let state = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(state.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let (app, window) = NativeMemoryApplication::test_origin(NativeMemoryStorage::test_origin(
        state.path().to_path_buf(),
    ));
    let receipt = app.open_presentation(&window).unwrap();
    let resource = Arc::new(PresentationResource {
        token: uuid::Uuid::new_v4().to_string(),
        window,
        receipt,
        selected: Mutex::new(SelectionState::default()),
        live: AtomicBool::new(true),
    });
    (state, app, resource)
}

#[test]
fn opaque_handles_reject_foreign_tables_types_replays_and_reused_ids() {
    let (_state, _app, resource) = fixture();
    let mut table = ResourceTable::default();
    let handle = PresentationHandle {
        id: table.add_arc(resource.clone()),
        token: resource.token.clone(),
    };
    assert!(lookup(&ResourceTable::default(), &handle).is_err());
    assert!(lookup(&table, &handle).is_ok());
    let mut forged = handle.clone();
    forged.token = uuid::Uuid::new_v4().to_string();
    assert!(take(&mut table, &forged).is_err());
    assert!(lookup(&table, &handle).is_ok());
    let removed = take(&mut table, &handle).unwrap();
    removed.retire();
    assert!(lookup(&table, &handle).is_err());
    assert!(resource.validate(&handle).is_err());
    let (_second_state, _second_app, replacement) = fixture();
    let id = table.add_arc(resource.clone());
    let replacement_token = replacement.token.clone();
    table.replace(
        id,
        Arc::try_unwrap(replacement).unwrap_or_else(|_| panic!("fixture resource was shared")),
    );
    let stale = PresentationHandle {
        id,
        token: handle.token,
    };
    assert!(take(&mut table, &stale).is_err());
    let current = PresentationHandle {
        id,
        token: replacement_token,
    };
    assert!(lookup(&table, &current).is_ok());
    struct Foreign;
    impl Resource for Foreign {}
    table.replace(id, Foreign);
    assert!(take(&mut table, &current).is_err());
    assert!(table.get::<Foreign>(id).is_ok());
}

#[test]
fn selection_round_trips_and_failed_destinations_retire_previous_authority() {
    let (_state, app, resource) = fixture();
    let dir = project();
    let outside = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    let first = resource
        .select(&app, &registry, root.clone(), &WorkspaceEnv::Local, 1)
        .unwrap();
    let second = resource
        .select(&app, &registry, root.clone(), &WorkspaceEnv::Local, 2)
        .unwrap();
    assert_ne!(first, second);
    assert!(resource.check(&app, &first).is_err());
    for stale in [0, 1, 2, 9_007_199_254_740_992] {
        assert!(resource
            .select(&app, &registry, root.clone(), &WorkspaceEnv::Local, stale)
            .is_err());
        assert!(resource.check(&app, &second).is_ok());
    }
    let captured = resource.check(&app, &second).unwrap();
    assert!(resource
        .select(
            &app,
            &registry,
            outside.path().into(),
            &WorkspaceEnv::Local,
            3
        )
        .is_err());
    assert!(!app.is_current(&resource.window, &resource.receipt, &captured));
    assert!(resource.check(&app, &second).is_err());
    let third = resource
        .select(&app, &registry, root.clone(), &WorkspaceEnv::Local, 4)
        .unwrap();
    let error = resource
        .select(
            &app,
            &registry,
            root,
            &WorkspaceEnv::Wsl {
                distro: "unavailable".into(),
            },
            5,
        )
        .unwrap_err();
    assert_eq!(error.code, "unsupported");
    assert!(resource.check(&app, &third).is_err());
    assert!(!registry.is_authorized(outside.path()));
    assert!(!outside.path().join(".voktty").exists());
}

#[test]
fn readonly_discovery_never_initializes_private_state_or_project_files() {
    let (state, app, resource) = fixture();
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    let token = resource
        .select(&app, &registry, root, &WorkspaceEnv::Local, 1)
        .unwrap();
    runtime().block_on(async {
        assert!(discover(&app, &resource, &token).await.is_err());
        assert_eq!(std::fs::read_dir(state.path()).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        app.store(
            &resource.window,
            MemoryStoreMode::Initialize,
            ReadControl::default(),
        )
        .await
        .unwrap();
        let before = std::fs::read(state.path().join("project-memory/memory-local.json")).unwrap();
        let reply = discover(&app, &resource, &token).await.unwrap();
        assert_eq!(reply.scope.state, "incomplete");
        assert_eq!(reply.scope.initialization, "not_requested");
        assert!(reply.root.is_none());
        assert_eq!(
            std::fs::read(state.path().join("project-memory/memory-local.json")).unwrap(),
            before
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    });
}

#[test]
fn discovery_reply_keeps_native_preferences_instructions_and_blocked_paths_private() {
    let (_state, app, resource) = fixture();
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    populate(&root);
    let token = resource
        .select(&app, &registry, root, &WorkspaceEnv::Local, 1)
        .unwrap();
    runtime().block_on(async {
        app.store(
            &resource.window,
            MemoryStoreMode::Initialize,
            ReadControl::default(),
        )
        .await
        .unwrap();
        let reply = discover(&app, &resource, &token).await.unwrap();
        let json = serde_json::to_value(reply).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 4);
        assert_eq!(json["schema"], 1);
        assert!(json["root"].is_string());
        for forbidden in [
            "facts",
            "localPreferences",
            "installationId",
            "instructions",
            "blockedPaths",
        ] {
            assert!(json.get(forbidden).is_none());
        }
        resource.retire();
        assert_eq!(
            discover(&app, &resource, &token).await.unwrap_err().code,
            "cancelled"
        );
    });
}

#[test]
fn closing_with_a_pending_read_retires_delivery_and_preserves_siblings() {
    let (_state, app, resource) = fixture();
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    let token = resource
        .select(&app, &registry, root, &WorkspaceEnv::Local, 1)
        .unwrap();
    runtime().block_on(async {
        let store = app
            .store(
                &resource.window,
                MemoryStoreMode::Initialize,
                ReadControl::default(),
            )
            .await
            .unwrap();
        let selected = resource.check(&app, &token).unwrap();
        let read = app
            .discover(
                &resource.window,
                &resource.receipt,
                &selected,
                store,
                DiscoveryControl::default(),
            )
            .unwrap();
        let sibling = app.open_presentation(&resource.window).unwrap();
        resource.clone().close();
        assert!(matches!(
            resource.check(&app, &token),
            Err(MemoryCommandError { code: "cancelled" })
        ));
        assert!(matches!(
            read.finish().await,
            Err(MemoryWorkError::Read(ReadError::Cancelled))
        ));
        assert!(app.close_presentation(&resource.window, &sibling).unwrap());
    });
}

#[test]
fn command_errors_and_handles_have_bounded_redacted_wire_shapes() {
    let error: MemoryCommandError = MemoryWorkError::Read(ReadError::Contract(Vec::new())).into();
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        serde_json::json!({"code":"unavailable"})
    );
    assert!(serde_json::from_value::<PresentationHandle>(
        serde_json::json!({"id":1,"token":"x","path":"foreign"})
    )
    .is_err());
    let (_state, _app, resource) = fixture();
    for token in [
        "".to_owned(),
        "x".repeat(37),
        resource.token.replace('-', ""),
    ] {
        assert!(resource
            .validate(&PresentationHandle { id: 0, token })
            .is_err());
    }
}
