use std::fs;
use std::path::Path;
use voktty_memory_local::{LocalMemoryStore, ReadControl, ReadError, StoreError};

fn parent() -> tempfile::TempDir {
    let temporary_root = fs::canonicalize(std::env::temp_dir()).unwrap();
    let parent = tempfile::tempdir_in(temporary_root).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o700)).unwrap();
    }
    parent
}

#[test]
fn directory_creation_is_private_and_identity_initialization_remains_explicit() {
    let parent = parent();
    let store = LocalMemoryStore::create_private(parent.path(), &ReadControl::default()).unwrap();
    let path = parent.path().join("project-memory");
    assert!(path.is_dir());
    assert_eq!(fs::read_dir(&path).unwrap().count(), 0);
    assert!(matches!(store.load(), Err(StoreError::Missing)));
    let first = store.initialize().unwrap();
    let before = fs::read(path.join("memory-local.json")).unwrap();
    let reopened =
        LocalMemoryStore::create_private(parent.path(), &ReadControl::default()).unwrap();
    assert_eq!(reopened.initialize().unwrap(), first);
    assert_eq!(fs::read(path.join("memory-local.json")).unwrap(), before);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
}

#[test]
fn existing_corrupt_preferences_are_preserved_without_reset() {
    let parent = parent();
    let store = LocalMemoryStore::create_private(parent.path(), &ReadControl::default()).unwrap();
    let record = parent.path().join("project-memory/memory-local.json");
    fs::write(&record, "foreign or corrupt state").unwrap();
    assert!(matches!(store.initialize(), Err(StoreError::InvalidStore)));
    let reopened =
        LocalMemoryStore::create_private(parent.path(), &ReadControl::default()).unwrap();
    assert!(matches!(
        reopened.initialize(),
        Err(StoreError::InvalidStore)
    ));
    assert_eq!(
        fs::read_to_string(record).unwrap(),
        "foreign or corrupt state"
    );
}

#[test]
fn invalid_missing_or_cancelled_parents_do_not_create_directories() {
    let parent = parent();
    let control = ReadControl::default();
    control.cancel();
    assert!(matches!(
        LocalMemoryStore::create_private(parent.path(), &control),
        Err(ReadError::Cancelled)
    ));
    assert!(matches!(
        LocalMemoryStore::create_private(
            parent.path(),
            &ReadControl::new(std::time::Duration::ZERO)
        ),
        Err(ReadError::Timeout)
    ));
    assert!(matches!(
        LocalMemoryStore::create_private(Path::new("relative"), &ReadControl::default()),
        Err(ReadError::InvalidInput)
    ));
    for path in [
        "//unreachable.invalid/share",
        r"\\unreachable.invalid\share",
    ] {
        assert!(matches!(
            LocalMemoryStore::create_private(Path::new(path), &ReadControl::default()),
            Err(ReadError::Unsupported)
        ));
    }
    assert!(LocalMemoryStore::create_private(
        &parent.path().join("missing"),
        &ReadControl::default()
    )
    .is_err());
    assert!(matches!(
        LocalMemoryStore::create_private(&parent.path().join(".."), &ReadControl::default()),
        Err(ReadError::InvalidInput)
    ));
    assert_eq!(fs::read_dir(parent.path()).unwrap().count(), 0);
}

#[test]
fn concurrent_creators_share_one_empty_directory_without_initializing_identity() {
    let parent = parent();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
    let handles = (0..4)
        .map(|_| {
            let path = parent.path().to_path_buf();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                LocalMemoryStore::create_private(&path, &ReadControl::default())
            })
        })
        .collect::<Vec<_>>();
    for handle in handles {
        assert!(handle.join().unwrap().is_ok());
    }
    assert_eq!(fs::read_dir(parent.path()).unwrap().count(), 1);
    assert_eq!(
        fs::read_dir(parent.path().join("project-memory"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn an_existing_file_is_never_replaced_by_a_state_directory() {
    let parent = parent();
    let file = parent.path().join("project-memory");
    fs::write(&file, "preserve").unwrap();
    assert!(LocalMemoryStore::create_private(parent.path(), &ReadControl::default()).is_err());
    assert_eq!(fs::read_to_string(file).unwrap(), "preserve");
}

#[cfg(unix)]
#[test]
fn links_at_the_parent_or_private_child_never_redirect_creation() {
    let outer = parent();
    let target = parent();
    let link = outer.path().join("alias");
    std::os::unix::fs::symlink(target.path(), &link).unwrap();
    assert!(LocalMemoryStore::create_private(&link, &ReadControl::default()).is_err());
    assert!(!target.path().join("project-memory").exists());
    fs::create_dir(target.path().join("app")).unwrap();
    assert!(LocalMemoryStore::create_private(&link.join("app"), &ReadControl::default()).is_err());
    assert!(!target.path().join("app/project-memory").exists());
    std::os::unix::fs::symlink(target.path(), outer.path().join("project-memory")).unwrap();
    assert!(LocalMemoryStore::create_private(outer.path(), &ReadControl::default()).is_err());
    assert_eq!(fs::read_dir(target.path()).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn permissive_existing_directories_are_rejected_without_chmod_or_deletion() {
    use std::os::unix::fs::PermissionsExt;
    let parent = parent();
    fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o777)).unwrap();
    assert!(matches!(
        LocalMemoryStore::create_private(parent.path(), &ReadControl::default()),
        Err(ReadError::Denied)
    ));
    assert!(!parent.path().join("project-memory").exists());
    fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let child = parent.path().join("project-memory");
    fs::create_dir(&child).unwrap();
    fs::set_permissions(&child, fs::Permissions::from_mode(0o755)).unwrap();
    fs::write(child.join("preserved"), "user data").unwrap();
    assert!(matches!(
        LocalMemoryStore::create_private(parent.path(), &ReadControl::default()),
        Err(ReadError::Denied)
    ));
    assert_eq!(
        fs::metadata(&child).unwrap().permissions().mode() & 0o777,
        0o755
    );
    assert_eq!(
        fs::read_to_string(child.join("preserved")).unwrap(),
        "user data"
    );
}
