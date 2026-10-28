use super::*;
use serde_json::json;
use std::fs;
use tokio::runtime::{Builder, Runtime};
use voktty_workspace_kit::{render_template, PathFact};

#[path = "selection_tests.rs"]
mod selection_tests;

#[path = "owners_tests.rs"]
mod owners_tests;

fn runtime() -> Runtime {
    Builder::new_current_thread().enable_time().build().unwrap()
}
fn project() -> tempfile::TempDir {
    #[cfg(target_os = "linux")]
    {
        tempfile::tempdir_in("/dev/shm").unwrap()
    }
    #[cfg(not(target_os = "linux"))]
    {
        tempfile::tempdir().unwrap()
    }
}
fn store() -> (tempfile::TempDir, Arc<LocalMemoryStore>) {
    let dir = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
    }
    let store = Arc::new(LocalMemoryStore::open(dir.path()).unwrap());
    store.initialize().unwrap();
    (dir, store)
}
fn populate(root: &Path) {
    for file in render_template(
        json!({"project_name":"Native authority","created_at":"2026-10-28"})
            .as_object()
            .unwrap(),
    )
    .unwrap()
    .into_iter()
    .filter(|file| file.path.starts_with(".voktty/"))
    {
        let path = root.join(file.path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, file.text).unwrap();
    }
    fs::write(root.join(".voktty/PROJECT.md"), "native project").unwrap();
}

#[test]
fn capture_requires_real_registered_roots_and_never_registers_a_request() {
    let dir = project();
    let root = fs::canonicalize(dir.path()).unwrap();
    let registry = WorkspaceRegistry::default();
    assert!(matches!(
        NativeMemorySource::capture(&registry, root.clone(), &WorkspaceEnv::Local),
        Err(MemoryWorkError::Read(ReadError::Denied))
    ));
    assert!(!registry.is_authorized(&root));
    registry.authorize(&root).unwrap();
    assert!(NativeMemorySource::capture(&registry, root, &WorkspaceEnv::Local).is_ok());
    assert!(!dir.path().join(".voktty").exists());
}

#[test]
fn nonlocal_environments_and_namespaces_never_fall_back_to_local_authority() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    for environment in [
        WorkspaceEnv::Wsl {
            distro: "unavailable".into(),
        },
        WorkspaceEnv::Docker {
            container_id: "unavailable".into(),
            container_name: None,
            image: None,
            shell: None,
            user: None,
            workdir: None,
        },
        WorkspaceEnv::Ssh {
            session_id: None,
            root: "/project".into(),
            connection: serde_json::from_value(json!({"host":"unreachable.invalid"})).unwrap(),
        },
    ] {
        assert!(matches!(
            NativeMemorySource::capture(&registry, root.clone(), &environment),
            Err(MemoryWorkError::Read(ReadError::Unsupported))
        ));
    }
    for path in [
        "remote://unresolved/project",
        r"\\unreachable.invalid\share",
        r"\\?\UNC\unreachable.invalid\share",
        r"\\?\GLOBALROOT\Device\volume",
    ] {
        assert!(matches!(
            NativeMemorySource::capture(&registry, path.into(), &WorkspaceEnv::Local),
            Err(MemoryWorkError::Read(ReadError::Unsupported))
        ));
    }
    assert!(matches!(
        NativeMemorySource::capture(&registry, root.join(".."), &WorkspaceEnv::Local),
        Err(MemoryWorkError::Read(ReadError::InvalidInput))
    ));
}

#[test]
fn metadata_enumeration_never_grants_secret_content_or_a_sensitive_workspace_root() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    let source =
        NativeMemorySource::capture(&registry, root.clone(), &WorkspaceEnv::Local).unwrap();
    for relative in [
        ".env",
        ".ssh/config",
        ".git/config",
        "credentials",
        "service-account.json",
    ] {
        let path = root.join(relative);
        assert!(source.access.allows_metadata(&path));
        assert!(!source.access.allows_read(&path));
    }
    assert!(source.access.allows_enumeration(&root.join(".git")));
    assert!(!source.access.allows_workspace_root(&root.join(".ssh")));
    assert!(source.access.allows_read(&root.join(".voktty/INIT.md")));
    assert!(!source.access.allows_read(&root.with_file_name("foreign")));
}

#[test]
fn dropping_a_source_permanently_retires_reads_without_retiring_its_replacement() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    populate(&root);
    let (state, store) = store();
    let preferences = fs::read(state.path().join("memory-local.json")).unwrap();
    runtime().block_on(async {
        let original =
            NativeMemorySource::capture(&registry, root.clone(), &WorkspaceEnv::Local).unwrap();
        let old = original
            .context(store.clone(), None, ReadControl::default())
            .unwrap();
        drop(original);
        let replacement =
            NativeMemorySource::capture(&registry, root.clone(), &WorkspaceEnv::Local).unwrap();
        assert!(matches!(
            old.finish().await,
            Err(MemoryWorkError::Read(ReadError::Cancelled))
        ));
        let current = replacement
            .context(store.clone(), None, ReadControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(matches!(current.project, PathFact::File { text } if text == "native project"));
    });
    assert_eq!(
        fs::read(state.path().join("memory-local.json")).unwrap(),
        preferences
    );
}

#[cfg(unix)]
#[test]
fn canonical_secret_root_and_unregistered_symlink_targets_are_denied_by_the_worker() {
    let dir = project();
    let outside = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    fs::create_dir(root.join(".ssh")).unwrap();
    std::os::unix::fs::symlink(root.join(".ssh"), root.join("innocent")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.join("escape")).unwrap();
    let (_state, store) = store();
    runtime().block_on(async {
        for alias in ["innocent", "escape"] {
            let source =
                NativeMemorySource::capture(&registry, root.join(alias), &WorkspaceEnv::Local)
                    .unwrap();
            let result = source
                .scope(
                    store.clone(),
                    DiscoveryPurpose::Discover,
                    DiscoveryControl::default(),
                )
                .unwrap()
                .finish()
                .await;
            assert!(matches!(
                result,
                Err(MemoryWorkError::Read(ReadError::Denied))
            ));
        }
    });
    assert!(!registry.is_authorized(&fs::canonicalize(outside.path()).unwrap()));
}

#[cfg(target_os = "linux")]
#[test]
fn a_missing_ancestor_grant_blocks_initialization_and_existing_sources_never_widen() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    let (_state, store) = store();
    runtime().block_on(async {
        let original =
            NativeMemorySource::capture(&registry, root.clone(), &WorkspaceEnv::Local).unwrap();
        let first = original
            .scope(
                store.clone(),
                DiscoveryPurpose::Initialize,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(!first.scope.ancestry_complete);
        assert_eq!(first.scope.initialization, "blocked");
        registry.authorize("/dev").unwrap();
        let retained = original
            .scope(
                store.clone(),
                DiscoveryPurpose::Initialize,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(!retained.scope.ancestry_complete);
        let fresh = NativeMemorySource::capture(&registry, root, &WorkspaceEnv::Local).unwrap();
        let authorized = fresh
            .scope(
                store.clone(),
                DiscoveryPurpose::Initialize,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(authorized.scope.ancestry_complete);
        assert_eq!(authorized.scope.initialization, "clear");
    });
    assert!(!dir.path().join(".voktty").exists());
}

#[test]
fn registry_snapshots_bound_root_count_and_encoded_path_bytes_without_evicting_grants() {
    let dir = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(dir.path()).unwrap();
    assert!(matches!(
        registry.snapshot_authorized_roots(0, 1024),
        Err(RegistrySnapshotError::Limit)
    ));
    assert!(matches!(
        registry.snapshot_authorized_roots(256, 0),
        Err(RegistrySnapshotError::Limit)
    ));
    for n in 0..256 {
        let path = root.join(n.to_string());
        fs::create_dir(&path).unwrap();
        registry.authorize(path).unwrap();
    }
    assert!(matches!(
        NativeMemorySource::capture(&registry, root.clone(), &WorkspaceEnv::Local),
        Err(MemoryWorkError::Read(ReadError::Limit))
    ));
    assert!(registry.is_authorized(&root));
    assert!(registry.is_authorized(&root.join("255")));
}
