use super::*;
use std::os::unix::fs::PermissionsExt;

pub(super) fn seed_store(server: &MemoryServer, control: &ReadControl) -> Arc<LocalMemoryStore> {
    let parent = server.state_parent(control).unwrap();
    LocalMemoryStore::prepare_application_parent(&parent, control).unwrap();
    let store = LocalMemoryStore::create_private(&parent, control).unwrap();
    store.initialize().unwrap();
    Arc::new(store)
}

#[test]
fn host_storage_failure_has_a_fixed_stage_without_exposing_the_private_parent() {
    let private = tempfile::tempdir().unwrap();
    std::fs::set_permissions(private.path(), std::fs::Permissions::from_mode(0o777)).unwrap();
    let server = MemoryServer {
        data_directory: Some(private.path().to_owned()),
        ..MemoryServer::default()
    };
    let error = server.store(&ReadControl::default()).err().unwrap();
    assert_eq!(
        error.value(),
        json!({"code":"denied","storage":{"stage":"application-parent","windowsError":null}})
    );
    assert_eq!(std::fs::read_dir(private.path()).unwrap().count(), 0);
    assert_eq!(
        std::fs::metadata(private.path())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o777
    );
}

#[test]
fn errors_outside_storage_keep_the_original_envelope() {
    assert_eq!(Error::new("denied").value(), json!({"code":"denied"}));
}

#[test]
fn host_and_cli_origin_share_identity_preferences_and_locks() {
    let private = tempfile::tempdir().unwrap();
    std::fs::set_permissions(private.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let server = MemoryServer {
        data_directory: Some(private.path().to_owned()),
        ..MemoryServer::default()
    };
    let control = ReadControl::default();
    let store = seed_store(&server, &control);
    let identity = store.load().unwrap().installation_id().to_owned();
    let canonical =
        voktty_memory_local::resolve_memory_application_parent(private.path(), &control).unwrap();
    let cli = LocalMemoryStore::open_private(&canonical, &control).unwrap();
    let snapshot = cli.load().unwrap();
    cli.set_policy(
        snapshot.revision(),
        &"a".repeat(64),
        voktty_memory_local::MemoryPolicy::Never,
    )
    .unwrap();
    let host = server.store(&control).unwrap().load().unwrap();
    assert_eq!(host.installation_id(), identity);
    assert_eq!(
        host.project(&"a".repeat(64)).unwrap().policy,
        voktty_memory_local::MemoryPolicy::Never
    );
    let lock = cli.try_lock_deployment().unwrap();
    assert!(matches!(
        store.try_lock_deployment(),
        Err(voktty_memory_local::StoreError::Busy)
    ));
    drop(lock);
    assert!(!private.path().join("dev.voktty").exists());
}

#[test]
fn legacy_host_state_never_opens_or_creates_a_second_store() {
    use std::fs;
    use std::os::unix::fs::symlink;
    for mode in [
        "legacy-only",
        "both",
        "corrupt",
        "empty",
        "linked-parent",
        "linked-store",
        "file-parent",
        "file-store",
    ] {
        let private = tempfile::tempdir().unwrap();
        fs::set_permissions(private.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let server = MemoryServer {
            data_directory: Some(private.path().to_owned()),
            ..Default::default()
        };
        let control = ReadControl::default();
        let store = seed_store(&server, &control);
        let canonical = private.path().join("app.voktty.voktty");
        let state = canonical.join("project-memory/memory-local.json");
        let original = fs::read(&state).unwrap();
        drop(store);
        let legacy = private.path().join("dev.voktty");
        match mode {
            "legacy-only" => fs::rename(&canonical, &legacy).unwrap(),
            "linked-parent" => symlink(&canonical, &legacy).unwrap(),
            "file-parent" => fs::write(&legacy, b"unchanged sentinel").unwrap(),
            _ => {
                fs::create_dir(&legacy).unwrap();
                let path = legacy.join("project-memory");
                match mode {
                    "linked-store" => symlink("/unavailable-origin-fixture", path).unwrap(),
                    "file-store" => fs::write(path, b"unchanged sentinel").unwrap(),
                    _ => {
                        fs::create_dir(&path).unwrap();
                        if mode != "empty" {
                            fs::write(
                                path.join("memory-local.json"),
                                if mode == "corrupt" {
                                    b"unchanged sentinel".as_slice()
                                } else {
                                    &original
                                },
                            )
                            .unwrap();
                        }
                    }
                }
            }
        }
        let legacy_before = fs::read(legacy.join("project-memory/memory-local.json")).ok();
        for _attempt in 0..2 {
            let error = server.store(&control).err().unwrap();
            assert_eq!(
                error.value(),
                json!({"code":"legacyStateRequiresReview"}),
                "{mode}"
            );
        }
        assert_eq!(
            fs::read(legacy.join("project-memory/memory-local.json")).ok(),
            legacy_before
        );
        if mode == "legacy-only" {
            assert!(!canonical.exists());
        } else {
            assert_eq!(fs::read(state).unwrap(), original);
        }
    }
}

#[test]
fn a_late_legacy_store_does_not_block_project_publication() {
    use std::fs;
    let private = tempfile::tempdir().unwrap();
    fs::set_permissions(private.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let project = tempfile::tempdir_in("/dev/shm").unwrap();
    let root = project.path();
    let mut server = MemoryServer {
        data_directory: Some(private.path().to_owned()),
        ..Default::default()
    };
    let control = DiscoveryControl::default();
    let mut execute =
        |params| server.execute(root, serde_json::from_value(params).unwrap(), &control);
    let handle = execute(json!({"operation":"open"})).unwrap();
    let selection = execute(json!({"operation":"select","handle":handle,"path":root,"revision":1,"inspectAncestors":true})).unwrap();
    let review = execute(json!({"operation":"preview","handle":handle,"selection":selection,"revision":1,
        "inputs":{"project_name":"Origin test","created_at":"2026-11-03"},"links":{"agents":false,"claude":false}})).unwrap();
    let legacy = private.path().join("dev.voktty");
    fs::create_dir(&legacy).unwrap();
    fs::create_dir(legacy.join("project-memory")).unwrap();
    let confirmation = json!({"operation":"confirm","handle":handle,"selection":selection,"review":review["review"]});
    execute(confirmation.clone()).unwrap();
    assert_eq!(execute(confirmation).unwrap_err().code, "cancelled");
    assert!(root.join(".voktty/kit.json").exists());
    assert_eq!(
        fs::read_dir(legacy.join("project-memory")).unwrap().count(),
        0
    );
}
