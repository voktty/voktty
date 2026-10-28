use super::*;
use crate::modules::project_memory::{NativeMemorySelection, NativeMemorySource};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};
use std::fs;
use tokio::runtime::{Builder, Runtime};
use voktty_memory_local::{DiscoveryControl, DiscoveryPurpose, StoreError};

fn runtime() -> Runtime {
    Builder::new_current_thread().enable_time().build().unwrap()
}
fn parent() -> tempfile::TempDir {
    let dir = tempfile::tempdir_in(fs::canonicalize(std::env::temp_dir()).unwrap()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
    }
    dir
}

#[test]
fn opening_existing_storage_never_creates_a_directory_or_identity() {
    let dir = parent();
    let storage = NativeMemoryStorage {
        parent: dir.path().to_path_buf(),
    };
    runtime().block_on(async {
        assert!(storage
            .open(ReadControl::default())
            .unwrap()
            .finish()
            .await
            .is_err());
    });
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    LocalMemoryStore::create_private(dir.path(), &ReadControl::default()).unwrap();
    runtime().block_on(async {
        assert!(matches!(
            storage.open(ReadControl::default()).unwrap().finish().await,
            Err(MemoryWorkError::Read(ReadError::Store(StoreError::Missing)))
        ));
    });
    assert!(!dir.path().join("project-memory/memory-local.json").exists());
}

#[test]
fn explicit_initialization_reopens_one_identity_without_granting_workspace_access() {
    let dir = parent();
    let project = parent();
    let storage = NativeMemoryStorage {
        parent: dir.path().to_path_buf(),
    };
    let registry = WorkspaceRegistry::default();
    runtime().block_on(async {
        let store = storage
            .initialize(ReadControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        let snapshot = store.load().unwrap();
        let reopened = storage
            .open(ReadControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(reopened.load().unwrap(), snapshot);
        assert!(matches!(
            NativeMemorySource::capture(
                &registry,
                project.path().to_path_buf(),
                &WorkspaceEnv::Local
            ),
            Err(MemoryWorkError::Read(ReadError::Denied))
        ));
        let root = registry.authorize(project.path()).unwrap();
        let mut selected = NativeMemorySelection::default();
        let receipt = selected
            .select(&registry, root, &WorkspaceEnv::Local)
            .unwrap();
        let observation = selected
            .scope(
                &receipt,
                reopened,
                DiscoveryPurpose::Discover,
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(!observation.scope.ancestry_complete);
        assert_eq!(store.load().unwrap(), snapshot);
    });
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}

#[test]
fn corrupt_storage_survives_both_open_and_initialization_failures() {
    let dir = parent();
    let storage = NativeMemoryStorage {
        parent: dir.path().to_path_buf(),
    };
    runtime().block_on(async {
        let store = storage
            .initialize(ReadControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        drop(store);
        let path = dir.path().join("project-memory/memory-local.json");
        fs::write(&path, "corrupt stored preferences").unwrap();
        for mode in [MemoryStoreMode::OpenExisting, MemoryStoreMode::Initialize] {
            assert!(matches!(
                MemoryWorkers::default()
                    .store(storage.parent.clone(), mode, ReadControl::default())
                    .unwrap()
                    .finish()
                    .await,
                Err(MemoryWorkError::Read(ReadError::Store(
                    StoreError::InvalidStore
                )))
            ));
        }
        assert_eq!(
            fs::read_to_string(path).unwrap(),
            "corrupt stored preferences"
        );
    });
}

#[test]
fn cancelled_initialization_never_starts_private_state_io() {
    let dir = parent();
    let storage = NativeMemoryStorage {
        parent: dir.path().to_path_buf(),
    };
    let control = ReadControl::default();
    control.cancel();
    assert!(matches!(
        storage.initialize(control),
        Err(MemoryWorkError::Read(ReadError::Cancelled))
    ));
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}
