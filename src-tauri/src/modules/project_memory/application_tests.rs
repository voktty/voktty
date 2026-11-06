use super::*;
use crate::modules::project_memory::tests::{populate, project, runtime};
use tauri::ResourceTable;

fn application() -> NativeMemoryApplication {
    NativeMemoryApplication {
        owners: Arc::new(Mutex::new(Some(NativeMemoryOwners::default()))),
        bindings: Mutex::new(HashMap::new()),
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
fn native_window_binding_checks_resource_identity_even_when_labels_and_ids_match() {
    let app = application();
    let original = app.register_window("main").unwrap();
    let mut original_table = ResourceTable::default();
    let id = original_table.add_arc(original.clone());
    assert!(app
        .resolve_binding(&original_table, id, &Arc::downgrade(&original))
        .is_ok());
    let replacement = app.register_window("main").unwrap();
    assert!(app
        .resolve_binding(&original_table, id, &Arc::downgrade(&original))
        .is_err());
    assert!(app
        .resolve_binding(&original_table, id, &Arc::downgrade(&replacement))
        .is_err());
    let mut replacement_table = ResourceTable::default();
    let replacement_id = replacement_table.add_arc(replacement.clone());
    assert!(app
        .resolve_binding(
            &replacement_table,
            replacement_id,
            &Arc::downgrade(&replacement)
        )
        .is_ok());
    original_table.close(id).unwrap();
    assert!(app
        .resolve_binding(
            &replacement_table,
            replacement_id,
            &Arc::downgrade(&replacement)
        )
        .is_ok());
    replacement_table.close(replacement_id).unwrap();
    assert!(app
        .resolve_binding(
            &replacement_table,
            replacement_id,
            &Arc::downgrade(&replacement)
        )
        .is_err());
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
    assert!(app.open_context(&owner).is_err());
    owner.retire();
}

#[test]
fn native_destroy_and_application_exit_retire_admitted_discovery() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    populate(&root);
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
                .inspect_scope(
                    &owner,
                    &presentation,
                    &selected,
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
            .inspect_scope(
                &owner,
                &presentation,
                &selected,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(observation.scope.state, "incomplete");
        assert!(app.is_current(&owner, &presentation, &selected));
        drop(app);
        assert!(owner.owners.upgrade().is_none());
    });
}

#[test]
fn poisoned_owner_lock_still_retires_captured_read_authority() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    populate(&root);
    runtime().block_on(async {
        let app = application();
        let owner = app.register_window("main").unwrap();
        let presentation = app.open_presentation(&owner).unwrap();
        let selected = app
            .select(&owner, &presentation, &registry, root, &WorkspaceEnv::Local)
            .unwrap();
        let read = app
            .inspect_scope(
                &owner,
                &presentation,
                &selected,
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
