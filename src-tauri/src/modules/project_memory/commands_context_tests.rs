use super::*;
use crate::modules::project_memory::commands::tests::fixture;
use crate::modules::project_memory::tests::{populate, project, runtime};
use serde_json::json;
use std::fs;

fn select(
    app: &NativeMemoryApplication,
    presentation: &PresentationResource,
    root: &Path,
) -> (WorkspaceRegistry, String) {
    populate(root);
    fs::create_dir(root.join("src")).unwrap();
    let registry = WorkspaceRegistry::default();
    registry.authorize(root).unwrap();
    let selected = presentation
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
async fn review(
    app: &NativeMemoryApplication,
    presentation: &PresentationResource,
    selected: &str,
    revision: u64,
) -> String {
    let reply = trust::review(
        app,
        presentation,
        selected,
        serde_json::from_value(json!({"revision":revision,"role":null})).unwrap(),
    )
    .await
    .unwrap();
    serde_json::to_value(reply).unwrap()["review"]
        .as_str()
        .unwrap()
        .into()
}
async fn trusted(
    app: &NativeMemoryApplication,
    presentation: &PresentationResource,
    selected: &str,
) -> String {
    app.store(
        &presentation.window,
        MemoryStoreMode::Initialize,
        ReadControl::default(),
    )
    .await
    .unwrap();
    let token = review(app, presentation, selected, 1).await;
    trust::confirm(app, presentation, selected, &token)
        .await
        .unwrap();
    review(app, presentation, selected, 2).await
}
fn request(review: &str, mode: &str) -> ContextBindRequest {
    serde_json::from_value(json!({"review":review,"mode":mode})).unwrap()
}
fn handle(table: &mut ResourceTable, resource: &Arc<ContextResource>) -> ContextHandle {
    ContextHandle {
        id: table.add_arc(resource.clone()),
        token: resource.token.clone(),
    }
}

#[test]
fn empty_context_handles_are_window_owned_readless_and_never_initialize_state() {
    let (state, app, presentation) = fixture();
    let context = ContextResource::open(&app, presentation.window.clone()).unwrap();
    let mut table = ResourceTable::default();
    let handle = handle(&mut table, &context);
    runtime().block_on(async {
        assert_eq!(read(&app, &context).await.unwrap_err().code, "cancelled");
    });
    assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
    assert!(app
        .context_root(&presentation.window, &context.receipt)
        .is_err());
    let receipt = context.receipt.clone();
    take(&mut table, &handle).unwrap().close();
    assert!(receipt.identity.upgrade().is_none());
    assert!(lookup(&table, &handle).is_err());
}

#[test]
fn token_only_context_confirmation_preserves_preferences_and_survives_panel_close() {
    let (state, app, presentation) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &presentation, dir.path());
    runtime().block_on(async {
        let review = trusted(&app, &presentation, &selected).await;
        let before = fs::read(state.path().join("project-memory/memory-local.json")).unwrap();
        let context = ContextResource::open(&app, presentation.window.clone()).unwrap();
        let reply = bind(
            &app,
            &presentation,
            &selected,
            &context,
            request(&review, "enabled"),
        )
        .await
        .unwrap();
        assert_eq!(
            serde_json::to_value(reply).unwrap(),
            json!({"schema":1,"root":dir.path()})
        );
        assert!(presentation.check(&app, &selected).is_err());
        presentation.retire();
        let result = read(&app, &context).await.unwrap();
        assert!(result.decision.context_allowed);
        assert!(!result.decision.capture_allowed);
        let packet = result.packet.unwrap();
        assert!(packet.bytes <= 24 * 1024);
        assert!(packet.text.contains("native project"));
        assert_eq!(
            fs::read(state.path().join("project-memory/memory-local.json")).unwrap(),
            before
        );
        context.retire();
        assert_eq!(read(&app, &context).await.unwrap_err().code, "cancelled");
    });
}

#[test]
fn duplicate_context_confirmation_does_not_close_the_pending_or_ready_incumbent() {
    let (_state, app, presentation) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &presentation, dir.path());
    runtime().block_on(async {
        let token = trusted(&app, &presentation, &selected).await;
        let context = ContextResource::open(&app, presentation.window.clone()).unwrap();
        context.begin(&app, &presentation.window).unwrap();
        assert_eq!(
            bind(
                &app,
                &presentation,
                &selected,
                &context,
                request(&token, "enabled")
            )
            .await
            .unwrap_err()
            .code,
            "busy"
        );
        assert_eq!(context.phase.load(Ordering::Acquire), BINDING);
        trust::bind_context(
            &app,
            &presentation,
            &selected,
            &token,
            &context,
            MemorySessionUse::Enabled,
        )
        .await
        .unwrap();
        context.phase.store(READY, Ordering::Release);
        assert_eq!(
            bind(
                &app,
                &presentation,
                &selected,
                &context,
                request(&token, "enabled")
            )
            .await
            .unwrap_err()
            .code,
            "cancelled"
        );
        assert!(read(&app, &context).await.unwrap().packet.is_some());
    });
}

#[test]
fn failed_binding_retires_its_known_resource_without_removing_a_replacement() {
    let (_state, app, presentation) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &presentation, dir.path());
    runtime().block_on(async {
        let token = trusted(&app, &presentation, &selected).await;
        let context = ContextResource::open(&app, presentation.window.clone()).unwrap();
        let mut table = ResourceTable::default();
        let handle = handle(&mut table, &context);
        fs::write(dir.path().join(".voktty/INIT.md"), "Foreign instructions").unwrap();
        assert_eq!(
            bind(
                &app,
                &presentation,
                &selected,
                &context,
                request(&token, "enabled")
            )
            .await
            .unwrap_err()
            .code,
            "stale"
        );
        assert_eq!(context.phase.load(Ordering::Acquire), CLOSED);
        assert!(!app.is_context_current(&presentation.window, &context.receipt));
        remove_failed(&mut table, &handle, &context);
        assert!(lookup(&table, &handle).is_err());
        let replacement = ContextResource::open(&app, presentation.window.clone()).unwrap();
        let replacement_token = replacement.token.clone();
        let id = table.add_arc(context.clone());
        table.replace(
            id,
            Arc::try_unwrap(replacement).unwrap_or_else(|_| panic!("fixture shared")),
        );
        remove_failed(
            &mut table,
            &ContextHandle {
                id,
                token: handle.token,
            },
            &context,
        );
        assert!(lookup(
            &table,
            &ContextHandle {
                id,
                token: replacement_token
            }
        )
        .is_ok());
        assert!(presentation.check(&app, &selected).is_ok());
    });
}

#[test]
fn handles_reject_foreign_tables_types_nonces_and_old_ids_even_when_retired() {
    let (_state, app, presentation) = fixture();
    let context = ContextResource::open(&app, presentation.window.clone()).unwrap();
    let mut table = ResourceTable::default();
    let handle = handle(&mut table, &context);
    assert!(lookup(&ResourceTable::default(), &handle).is_err());
    for token in ["".into(), "x".repeat(37), uuid::Uuid::new_v4().to_string()] {
        assert!(take(
            &mut table,
            &ContextHandle {
                id: handle.id,
                token
            }
        )
        .is_err());
        assert!(lookup(&table, &handle).is_ok());
    }
    struct Foreign;
    impl Resource for Foreign {}
    context.retire();
    table.replace(handle.id, Foreign);
    assert!(take(&mut table, &handle).is_err());
    assert!(table.get::<Foreign>(handle.id).is_ok());
}

#[test]
fn a_context_from_another_native_window_cannot_consume_the_original_review() {
    let (_state, app, presentation) = fixture();
    let (_other_state, other, other_presentation) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &presentation, dir.path());
    runtime().block_on(async {
        let token = trusted(&app, &presentation, &selected).await;
        let foreign = ContextResource::open(&other, other_presentation.window.clone()).unwrap();
        assert_eq!(
            bind(
                &app,
                &presentation,
                &selected,
                &foreign,
                request(&token, "enabled")
            )
            .await
            .unwrap_err()
            .code,
            "cancelled"
        );
        assert_eq!(foreign.phase.load(Ordering::Acquire), OPEN);
        let context = ContextResource::open(&app, presentation.window.clone()).unwrap();
        bind(
            &app,
            &presentation,
            &selected,
            &context,
            request(&token, "enabled"),
        )
        .await
        .unwrap();
        assert!(read(&app, &context).await.unwrap().packet.is_some());
    });
}

#[test]
fn queued_confirmation_is_cancelled_by_context_panel_selection_window_or_app_retirement() {
    for retire in 0..5 {
        let (_state, app, presentation) = fixture();
        let dir = project();
        let (registry, selected) = select(&app, &presentation, dir.path());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .max_blocking_threads(1)
            .build()
            .unwrap();
        runtime.block_on(async {
            let token = trusted(&app, &presentation, &selected).await;
            let context = ContextResource::open(&app, presentation.window.clone()).unwrap();
            let (started, observed) = std::sync::mpsc::channel();
            let (release, blocked) = std::sync::mpsc::channel();
            let blocker = tokio::task::spawn_blocking(move || {
                started.send(()).unwrap();
                blocked.recv_timeout(std::time::Duration::from_secs(3)).unwrap();
            });
            observed.recv_timeout(std::time::Duration::from_secs(3)).unwrap();
            let pending = bind(&app, &presentation, &selected, &context, request(&token,"enabled"));
            tokio::pin!(pending);
            tokio::select! { biased; _ = &mut pending => panic!("binding must be queued"), _ = tokio::task::yield_now() => {} }
            match retire {
                0 => context.retire(),
                1 => presentation.retire(),
                2 => { presentation.select_with_inspection(&app,&registry,dir.path().join("src"),&WorkspaceEnv::Local,2,true).unwrap(); },
                3 => presentation.window.retire(),
                _ => app.shutdown(),
            }
            release.send(()).unwrap();
            blocker.await.unwrap();
            assert_eq!(pending.await.unwrap_err().code, "cancelled");
            assert_eq!(context.phase.load(Ordering::Acquire), CLOSED);
        });
    }
}

#[test]
fn queued_context_read_cannot_publish_after_its_resource_is_closed() {
    let (_state, app, presentation) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &presentation, dir.path());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    runtime.block_on(async {
        let token = trusted(&app, &presentation, &selected).await;
        let context = ContextResource::open(&app, presentation.window.clone()).unwrap();
        bind(&app, &presentation, &selected, &context, request(&token,"enabled")).await.unwrap();
        let (started, observed) = std::sync::mpsc::channel();
        let (release, blocked) = std::sync::mpsc::channel();
        let blocker = tokio::task::spawn_blocking(move || {
            started.send(()).unwrap();
            blocked.recv_timeout(std::time::Duration::from_secs(3)).unwrap();
        });
        observed.recv_timeout(std::time::Duration::from_secs(3)).unwrap();
        let pending = read(&app, &context);
        tokio::pin!(pending);
        tokio::select! { biased; _ = &mut pending => panic!("read must be queued"), _ = tokio::task::yield_now() => {} }
        context.retire();
        release.send(()).unwrap();
        blocker.await.unwrap();
        assert_eq!(pending.await.unwrap_err().code, "cancelled");
    });
}

#[test]
fn strict_context_wire_accepts_no_root_trust_policy_or_capture_facts() {
    for field in [
        "root",
        "projectKey",
        "digest",
        "instructions",
        "store",
        "policy",
        "captures",
        "sessionId",
    ] {
        let mut input = json!({"review":"token","mode":"enabled"});
        input[field] = json!(true);
        assert!(serde_json::from_value::<ContextBindRequest>(input).is_err());
    }
    for mode in ["always", "never", "ask", "ENABLED", ""] {
        assert!(serde_json::from_value::<ContextBindRequest>(
            json!({"review":"token","mode":mode})
        )
        .is_err());
    }
    assert!(serde_json::from_value::<ContextHandle>(
        json!({"id":1,"token":"token","path":"/forged"})
    )
    .is_err());
}

#[test]
fn confirming_context_never_accepts_instruction_trust_or_changes_local_policy() {
    let (state, app, presentation) = fixture();
    let dir = project();
    let (_registry, selected) = select(&app, &presentation, dir.path());
    runtime().block_on(async {
        app.store(
            &presentation.window,
            MemoryStoreMode::Initialize,
            ReadControl::default(),
        )
        .await
        .unwrap();
        let before = fs::read(state.path().join("project-memory/memory-local.json")).unwrap();
        let review = review(&app, &presentation, &selected, 1).await;
        let context = ContextResource::open(&app, presentation.window.clone()).unwrap();
        bind(
            &app,
            &presentation,
            &selected,
            &context,
            request(&review, "enabled"),
        )
        .await
        .unwrap();
        let result = read(&app, &context).await.unwrap();
        assert_eq!(result.decision.reason, "KIT_MEMORY_TRUST_REQUIRED");
        assert!(!result.decision.context_allowed);
        assert!(!result.decision.capture_allowed);
        assert!(result.packet.is_none());
        assert_eq!(
            fs::read(state.path().join("project-memory/memory-local.json")).unwrap(),
            before
        );
    });
}

#[test]
fn resource_close_and_drop_retire_native_context_even_without_application_state() {
    let (_state, app, presentation) = fixture();
    let context = ContextResource::open(&app, presentation.window.clone()).unwrap();
    let receipt = context.receipt.clone();
    let mut table = ResourceTable::default();
    let handle = handle(&mut table, &context);
    drop(app);
    take(&mut table, &handle).unwrap().close();
    assert!(receipt.identity.upgrade().is_none());
    assert_eq!(context.phase.load(Ordering::Acquire), CLOSED);
}
