use super::*;
use crate::modules::project_memory::tests::{populate, project, runtime, store};
use tauri::ResourceTable;

fn application() -> NativeMemoryApplication {
    NativeMemoryApplication {
        storage: Err(ReadError::Unavailable.into()),
        owners: Arc::new(Mutex::new(Some(NativeMemoryOwners::default()))),
    }
}

#[test]
fn native_resource_lookup_and_close_preserve_exact_window_ownership() {
    let app = application();
    let owner = app.register_window("main").unwrap();
    let presentation = app.open_presentation(&owner).unwrap();
    let mut original = ResourceTable::default();
    let id = original.add_arc(owner.clone());
    let foreign = ResourceTable::default();
    assert!(foreign.get::<NativeMemoryWindow>(id).is_err());
    assert!(Arc::ptr_eq(
        &original.get::<NativeMemoryWindow>(id).unwrap(),
        &owner
    ));
    original.close(id).unwrap();
    assert!(app.open_presentation(&owner).is_err());
    assert!(!app.close_presentation(&owner, &presentation).unwrap());
    assert!(original.get::<NativeMemoryWindow>(id).is_err());
    let replacement = app.register_window("main").unwrap();
    drop(owner);
    assert!(app.open_presentation(&replacement).is_ok());
}

#[test]
fn ordinary_window_events_preserve_authority_and_only_destruction_retires_it() {
    let app = application();
    let owner = app.register_window("main").unwrap();
    let presentation = app.open_presentation(&owner).unwrap();
    for event in [WindowEvent::Focused(false), WindowEvent::Focused(true)] {
        owner.observe(&event);
        assert!(app.open_presentation(&owner).is_ok());
    }
    owner.observe(&WindowEvent::Destroyed);
    owner.observe(&WindowEvent::Destroyed);
    assert!(app.open_presentation(&owner).is_err());
    assert!(!app.close_presentation(&owner, &presentation).unwrap());
    let replacement = app.register_window("main").unwrap();
    owner.observe(&WindowEvent::Destroyed);
    assert!(app.open_presentation(&replacement).is_ok());
}

#[test]
fn application_boundaries_shutdown_and_last_resource_drop_fail_closed() {
    let app = application();
    let foreign = application();
    let owner = app.register_window("main").unwrap();
    assert!(foreign.open_presentation(&owner).is_err());
    let presentation = app.open_presentation(&owner).unwrap();
    let receipt = owner.receipt.clone();
    drop(owner);
    assert!(!app
        .owners
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .close_presentation(&receipt, &presentation));
    let owner = app.register_window("main").unwrap();
    app.shutdown();
    app.shutdown();
    assert!(app.register_window("main").is_err());
    assert!(app.open_presentation(&owner).is_err());
    runtime().block_on(async {
        assert!(matches!(
            app.store(&owner, MemoryStoreMode::Initialize, ReadControl::default())
                .await,
            Err(MemoryWorkError::Read(ReadError::Cancelled))
        ));
    });
    owner.retire();
}

#[test]
fn native_destroy_and_application_exit_retire_admitted_discovery() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    populate(&root);
    let (_state, store) = store();
    runtime().block_on(async {
        for shutdown in [false, true] {
            let app = application();
            let owner = app.register_window("main").unwrap();
            let presentation = app.open_presentation(&owner).unwrap();
            let selected = app
                .select(
                    &owner,
                    &presentation,
                    &registry,
                    root.clone(),
                    &WorkspaceEnv::Local,
                )
                .unwrap();
            let read = app
                .discover(
                    &owner,
                    &presentation,
                    &selected,
                    store.clone(),
                    DiscoveryControl::default(),
                )
                .unwrap();
            if shutdown {
                app.shutdown();
            } else {
                owner.observe(&WindowEvent::Destroyed);
            }
            assert!(!app.is_current(&owner, &presentation, &selected));
            assert!(matches!(
                read.finish().await,
                Err(MemoryWorkError::Read(ReadError::Cancelled))
            ));
        }
        let app = application();
        let owner = app.register_window("main").unwrap();
        let presentation = app.open_presentation(&owner).unwrap();
        let selected = app
            .select(
                &owner,
                &presentation,
                &registry,
                root.clone(),
                &WorkspaceEnv::Local,
            )
            .unwrap();
        let observation = app
            .discover(
                &owner,
                &presentation,
                &selected,
                store,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(observation.scope.root_key.is_some());
        assert!(app.is_current(&owner, &presentation, &selected));
        drop(app);
        assert!(owner.owners.upgrade().is_none());
    });
}

#[test]
fn explicit_storage_actions_require_the_current_application_and_window() {
    let dir = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let mut app = application();
    app.storage = Ok(NativeMemoryStorage::test_origin(dir.path().to_path_buf()));
    let foreign = application();
    let foreign_owner = foreign.register_window("main").unwrap();
    let owner = app.register_window("main").unwrap();
    runtime().block_on(async {
        assert!(matches!(
            app.store(
                &foreign_owner,
                MemoryStoreMode::Initialize,
                ReadControl::default()
            )
            .await,
            Err(MemoryWorkError::Read(ReadError::Cancelled))
        ));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        assert!(app
            .store(
                &owner,
                MemoryStoreMode::OpenExisting,
                ReadControl::default()
            )
            .await
            .is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        let initialized = app
            .store(&owner, MemoryStoreMode::Initialize, ReadControl::default())
            .await
            .unwrap();
        let snapshot = initialized.load().unwrap();
        let reopened = app
            .store(
                &owner,
                MemoryStoreMode::OpenExisting,
                ReadControl::default(),
            )
            .await
            .unwrap();
        assert_eq!(reopened.load().unwrap(), snapshot);
        owner.retire();
        assert!(matches!(
            app.store(&owner, MemoryStoreMode::Initialize, ReadControl::default())
                .await,
            Err(MemoryWorkError::Read(ReadError::Cancelled))
        ));
        assert_eq!(initialized.load().unwrap(), snapshot);
    });
}

#[test]
fn poisoned_owner_lock_still_retires_captured_read_authority() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    let (_state, store) = store();
    runtime().block_on(async {
        let app = application();
        let owner = app.register_window("main").unwrap();
        let presentation = app.open_presentation(&owner).unwrap();
        let selected = app
            .select(&owner, &presentation, &registry, root, &WorkspaceEnv::Local)
            .unwrap();
        let read = app
            .discover(
                &owner,
                &presentation,
                &selected,
                store,
                DiscoveryControl::default(),
            )
            .unwrap();
        let shared = app.owners.clone();
        assert!(std::thread::spawn(move || {
            let _guard = shared.lock().unwrap();
            panic!("poison native memory ownership fixture");
        })
        .join()
        .is_err());
        assert!(app.open_presentation(&owner).is_err());
        owner.retire();
        assert!(matches!(
            read.finish().await,
            Err(MemoryWorkError::Read(ReadError::Cancelled))
        ));
        app.shutdown();
    });
}
