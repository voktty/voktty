use std::fs;
use std::time::Duration;
use voktty_memory_local::{
    LocalMemoryStore, MemoryStoreMode, MemoryWorkers, ReadControl, ReadError,
};

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
fn explicit_preparation_creates_only_missing_native_components_without_identity() {
    let dir = parent();
    let app = dir.path().join("data/voktty");
    assert!(matches!(
        LocalMemoryStore::check_application_parent(&app, &ReadControl::default()),
        Err(ReadError::Unavailable)
    ));
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    LocalMemoryStore::prepare_application_parent(&app, &ReadControl::default()).unwrap();
    assert_eq!(fs::read_dir(&app).unwrap().count(), 0);
    LocalMemoryStore::check_application_parent(&app, &ReadControl::default()).unwrap();
    LocalMemoryStore::prepare_application_parent(&app, &ReadControl::default()).unwrap();
    assert_eq!(fs::read_dir(&app).unwrap().count(), 0);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in [dir.path().join("data"), app] {
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
    }
}

#[test]
fn application_parent_creation_is_used_by_the_owned_initialization_worker() {
    let dir = parent();
    let app = dir.path().join("absent/application");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    runtime.block_on(async {
        let workers = MemoryWorkers::default();
        assert!(workers
            .store(
                app.clone(),
                MemoryStoreMode::OpenExisting,
                ReadControl::default()
            )
            .unwrap()
            .finish()
            .await
            .is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        let store = workers
            .store(
                app.clone(),
                MemoryStoreMode::Initialize,
                ReadControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        let snapshot = store.load().unwrap();
        let reopened = workers
            .store(
                app.clone(),
                MemoryStoreMode::OpenExisting,
                ReadControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(reopened.load().unwrap(), snapshot);
        assert!(!app.join(".voktty").exists());
    });
}

#[test]
fn cancelled_expired_and_invalid_preparation_never_creates_a_suffix() {
    let dir = parent();
    let app = dir.path().join("absent/application");
    let cancelled = ReadControl::default();
    cancelled.cancel();
    assert!(matches!(
        LocalMemoryStore::prepare_application_parent(&app, &cancelled),
        Err(ReadError::Cancelled)
    ));
    assert!(matches!(
        LocalMemoryStore::prepare_application_parent(&app, &ReadControl::new(Duration::ZERO)),
        Err(ReadError::Timeout)
    ));
    assert!(matches!(
        LocalMemoryStore::prepare_application_parent(
            &dir.path().join("absent/../application"),
            &ReadControl::default()
        ),
        Err(ReadError::InvalidInput)
    ));
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn existing_files_block_suffix_creation_without_replacement() {
    let dir = parent();
    fs::write(dir.path().join("data"), "preserve").unwrap();
    assert!(matches!(
        LocalMemoryStore::prepare_application_parent(
            &dir.path().join("data/application"),
            &ReadControl::default()
        ),
        Err(ReadError::Denied)
    ));
    assert_eq!(
        fs::read_to_string(dir.path().join("data")).unwrap(),
        "preserve"
    );
}

#[test]
fn concurrent_application_preparations_do_not_create_identity_or_duplicate_directories() {
    let dir = parent();
    let app = dir.path().join("data/application");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
    let workers = (0..4)
        .map(|_| {
            let path = app.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                LocalMemoryStore::prepare_application_parent(&path, &ReadControl::default())
            })
        })
        .collect::<Vec<_>>();
    for worker in workers {
        worker.join().unwrap().unwrap();
    }
    assert!(fs::read_dir(&app).unwrap().next().is_none());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn symlink_ancestors_never_redirect_preparation_or_existing_state_checks() {
    let dir = parent();
    let outside = parent();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("data")).unwrap();
    let app = dir.path().join("data/application");
    assert!(matches!(
        LocalMemoryStore::prepare_application_parent(&app, &ReadControl::default()),
        Err(ReadError::Denied)
    ));
    assert!(LocalMemoryStore::check_application_parent(&app, &ReadControl::default()).is_err());
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[cfg(unix)]
#[test]
fn a_shared_writable_ancestor_blocks_even_a_private_existing_leaf_without_chmod() {
    use std::os::unix::fs::PermissionsExt;
    let dir = parent();
    let unsafe_parent = dir.path().join("shared");
    let leaf = unsafe_parent.join("private");
    fs::create_dir_all(&leaf).unwrap();
    fs::set_permissions(&unsafe_parent, fs::Permissions::from_mode(0o777)).unwrap();
    fs::set_permissions(&leaf, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(matches!(
        LocalMemoryStore::prepare_application_parent(
            &leaf.join("application"),
            &ReadControl::default()
        ),
        Err(ReadError::Denied)
    ));
    assert!(matches!(
        LocalMemoryStore::check_application_parent(&leaf, &ReadControl::default()),
        Err(ReadError::Denied)
    ));
    assert_eq!(
        fs::metadata(unsafe_parent).unwrap().permissions().mode() & 0o777,
        0o777
    );
    assert!(!leaf.join("application").exists());
}
