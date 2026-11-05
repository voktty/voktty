use super::*;
use voktty_memory_local::{MemorySessionUse, MemoryStoreMode};
use voktty_workspace_kit::RootLinks;

#[test]
fn authorize_initialize_reserved_directory_and_use_reviewed_memory_without_touching_sessions() {
    let project = project();
    let state = storage_parent();
    let root = fs::canonicalize(project.path()).unwrap();
    fs::create_dir_all(root.join(".voktty/sessions")).unwrap();
    fs::write(
        root.join(".voktty/sessions/existing.json"),
        "reserved session",
    )
    .unwrap();
    fs::write(root.join(".voktty/.gitignore"), "*\n").unwrap();
    fs::write(root.join("AGENTS.md"), "Existing root rules\n").unwrap();
    let registry = WorkspaceRegistry::default();
    let (app, window) = NativeMemoryApplication::test_origin(NativeMemoryStorage::test_origin(
        state.path().to_owned(),
    ));
    let presentation = app.open_presentation(&window).unwrap();
    assert!(matches!(
        app.select(
            &window,
            &presentation,
            &registry,
            root.clone(),
            &WorkspaceEnv::Local
        ),
        Err(MemoryWorkError::Read(ReadError::Denied))
    ));
    let authorized = registry.authorize(&root).unwrap();
    let selected = app
        .select_with_inspection(
            &window,
            &presentation,
            &registry,
            authorized.clone(),
            &WorkspaceEnv::Local,
        )
        .unwrap();
    runtime().block_on(async {
        let observed = app.inspect_scope(&window, &presentation, &selected, DiscoveryControl::default())
            .unwrap().finish().await.unwrap();
        assert_eq!(observed.scope.state, "reserved");
        assert!(observed.scope.ancestry_complete);
        assert_eq!(fs::read_dir(state.path()).unwrap().count(), 0);
        assert!(!root.join(".voktty/kit.json").exists());

        let store = app.store(&window, MemoryStoreMode::Initialize, ReadControl::default()).await.unwrap();
        let reservation = app.reserve_preview(&window, &presentation, &selected, &registry,
            NativeMemoryPreviewTarget { destination: authorized.clone(), environment: WorkspaceEnv::Local, control: DiscoveryControl::default() }
        ).unwrap();
        let prepared = app.start_preview(&window, &presentation, &selected, &reservation,
            NativeMemoryPreviewValues {
                inputs: json!({ "project_name": "Fresh integration", "created_at": "2026-11-02", "language": "es" }).as_object().unwrap().clone(),
                links: RootLinks::default(),
            }
        ).unwrap().finish().await.unwrap();
        let review = app.accept_preview(&window, &presentation, &selected, prepared).unwrap();
        let snapshot = app.preview_snapshot(&window, &presentation, &selected, &review).unwrap();
        assert!(snapshot.deployment.plan.can_publish);
        assert!(snapshot.publication_blocker.is_none());
        assert!(!root.join(".voktty/kit.json").exists());
        let report = app.confirm_preview(&window, &presentation, &selected, &review, &registry, DiscoveryControl::default())
            .unwrap().finish().await.unwrap();
        assert!(report.created.iter().any(|path| path == ".voktty/kit.json"));
        assert_eq!(fs::read_to_string(root.join(".voktty/sessions/existing.json")).unwrap(), "reserved session");
        assert_eq!(fs::read_to_string(root.join("AGENTS.md")).unwrap(), "Existing root rules\n");

        let observed = app.inspect_scope(&window, &presentation, &selected, DiscoveryControl::default())
            .unwrap().finish().await.unwrap();
        assert_eq!(observed.scope.state, "ready");
        let reserved = app.reserve_trust(&window, &presentation, &selected, DiscoveryControl::default()).unwrap();
        let instructions = app.review_trust(&window, &presentation, &selected, &reserved, store.clone(), None)
            .unwrap().finish().await.unwrap();
        let snapshot = instructions.snapshot(&reserved).unwrap();
        let digest = snapshot.fingerprint.digest;
        let preference = app.accept_trust(&window, &presentation, &selected, instructions, DiscoveryControl::default())
            .unwrap().finish().await.unwrap();
        assert_eq!(preference.instruction_digest.as_deref(), Some(digest.as_str()));
        assert_eq!(preference.policy, voktty_memory_local::MemoryPolicy::Manual);

        let reserved = app.reserve_trust(&window, &presentation, &selected, DiscoveryControl::default()).unwrap();
        let instructions = app.review_trust(&window, &presentation, &selected, &reserved, store, None)
            .unwrap().finish().await.unwrap();
        let context = app.open_context(&window).unwrap();
        let target = NativeMemoryContextTarget { context: &context, presentation: &presentation, selected: &selected };
        let bound = app.bind_context_session(&window, target, instructions, MemorySessionUse::Enabled, DiscoveryControl::default())
            .unwrap().finish().await.unwrap();
        app.promote_context(&window, NativeMemoryContextTarget { context: &context, presentation: &presentation, selected: &selected }, bound).unwrap();
        app.close_presentation(&window, &presentation).unwrap();
        let used = app.session_context(&window, &context, DiscoveryControl::default()).unwrap().finish().await.unwrap();
        assert!(used.decision.context_allowed);
        assert!(!used.decision.capture_allowed);
        let packet = used.packet.unwrap();
        assert!(packet.text.contains("Fresh integration"));
        assert!(packet.bytes <= 24 * 1024);
        app.close_context(&window, &context).unwrap();
    });
    assert_eq!(
        fs::read_to_string(root.join(".voktty/sessions/existing.json")).unwrap(),
        "reserved session"
    );
}
