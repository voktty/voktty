use super::*;
use crate::modules::project_memory::tests::{populate, project, runtime};

fn target<'a>(
    context: &'a NativeMemoryContextReceipt,
    presentation: &'a NativeMemoryPresentationReceipt,
    selected: &'a NativeMemorySelectionReceipt,
) -> NativeMemoryContextTarget<'a> {
    NativeMemoryContextTarget {
        context,
        presentation,
        selected,
    }
}

#[test]
fn project_context_reservations_cannot_borrow_another_context_or_retire_its_successor() {
    let project = project();
    let state = tempfile::tempdir().unwrap();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(project.path()).unwrap();
    registry.authorize("/dev").unwrap();
    populate(&root);
    let (app, window) = NativeMemoryApplication::test_origin(NativeMemoryStorage::test_origin(
        state.path().to_owned(),
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
    runtime().block_on(async {
        let first = app.open_context(&window).unwrap();
        let foreign = app.open_context(&window).unwrap();
        let binding = app
            .bind_project_context(
                &window,
                target(&first, &presentation, &selected),
                DiscoveryControl::default(),
            )
            .unwrap();
        assert!(matches!(
            app.bind_project_context(
                &window,
                target(&foreign, &presentation, &selected),
                DiscoveryControl::default()
            ),
            Err(MemoryTrustError::Worker(MemoryWorkError::Read(
                ReadError::Busy
            )))
        ));
        let prepared = binding.finish().await.unwrap();
        assert!(app
            .promote_context(
                &window,
                target(&foreign, &presentation, &selected),
                prepared
            )
            .is_err());
        app.close_context(&window, &first).unwrap();
        let successor = app.open_context(&window).unwrap();
        let prepared = app
            .bind_project_context(
                &window,
                target(&successor, &presentation, &selected),
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        app.promote_context(
            &window,
            target(&successor, &presentation, &selected),
            prepared,
        )
        .unwrap();
        app.close_context(&window, &foreign).unwrap();
        assert!(!app.close_context(&window, &first).unwrap());
        assert!(app
            .session_context(&window, &successor, DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap()
            .packet
            .is_some());
    });
    assert_eq!(std::fs::read_dir(state.path()).unwrap().count(), 0);
}

#[test]
fn project_context_ready_artifacts_never_adopt_a_replaced_selection() {
    let project = project();
    let state = tempfile::tempdir().unwrap();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(project.path()).unwrap();
    registry.authorize("/dev").unwrap();
    populate(&root);
    let (app, window) = NativeMemoryApplication::test_origin(NativeMemoryStorage::test_origin(
        state.path().to_owned(),
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
    runtime().block_on(async {
        let old = app.open_context(&window).unwrap();
        let prepared = app
            .bind_project_context(
                &window,
                target(&old, &presentation, &selected),
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        let replacement = app
            .select(
                &window,
                &presentation,
                &registry,
                root,
                &WorkspaceEnv::Local,
            )
            .unwrap();
        assert!(app
            .promote_context(&window, target(&old, &presentation, &replacement), prepared)
            .is_err());
        let current = app.open_context(&window).unwrap();
        let prepared = app
            .bind_project_context(
                &window,
                target(&current, &presentation, &replacement),
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        app.promote_context(
            &window,
            target(&current, &presentation, &replacement),
            prepared,
        )
        .unwrap();
        app.close_context(&window, &old).unwrap();
        assert!(app
            .session_context(&window, &current, DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap()
            .packet
            .is_some());
    });
    assert_eq!(std::fs::read_dir(state.path()).unwrap().count(), 0);
}
