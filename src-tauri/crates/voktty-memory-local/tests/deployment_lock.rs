use std::fs;
use std::path::Path;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use voktty_memory_local::{LocalMemoryStore, MemoryPolicy, StoreError};

const LOCK: &str = "memory-deployment.lock";
const CHILD_DIRECTORY: &str = "VOKTTY_MEMORY_DEPLOYMENT_TEST_DIRECTORY";
const CHILD_MODE: &str = "VOKTTY_MEMORY_DEPLOYMENT_TEST_MODE";

fn setup() -> (tempfile::TempDir, LocalMemoryStore) {
    let directory = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
    }
    let store = LocalMemoryStore::open(directory.path()).unwrap();
    (directory, store)
}

struct OwnedChild(Child);

impl Drop for OwnedChild {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

fn child(directory: &Path, mode: &str) -> OwnedChild {
    OwnedChild(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "deployment_child", "--nocapture"])
            .env(CHILD_DIRECTORY, directory)
            .env(CHILD_MODE, mode)
            .spawn()
            .unwrap(),
    )
}

fn wait_success(child: &mut OwnedChild) {
    let start = Instant::now();
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            assert!(status.success());
            return;
        }
        assert!(start.elapsed() < Duration::from_secs(10), "child timed out");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn deployment_child() {
    let Some(directory) = std::env::var_os(CHILD_DIRECTORY) else {
        return;
    };
    let directory = Path::new(&directory);
    let store = LocalMemoryStore::open(directory).unwrap();
    match std::env::var(CHILD_MODE).unwrap().as_str() {
        "contend" => assert!(matches!(store.try_lock_deployment(), Err(StoreError::Busy))),
        "hold" => {
            let _lock = store.try_lock_deployment().unwrap();
            fs::write(directory.join("child-ready"), b"locked").unwrap();
            // The parent kills this exact child after observing readiness.
            loop {
                std::thread::park();
            }
        }
        "exit" => {
            let _lock = store.try_lock_deployment().unwrap();
            // Exit without destructors, as after a worker-process failure.
            std::process::exit(0);
        }
        _ => panic!("unexpected child mode"),
    }
}

#[test]
fn one_stable_lock_covers_all_destinations_and_does_not_lock_preferences() {
    let (directory, store) = setup();
    let lock = store.try_lock_deployment().unwrap();
    assert!(!directory.path().join("memory-local.json").exists());
    let before = fs::read(directory.path().join(LOCK)).unwrap();
    let other = LocalMemoryStore::open(directory.path()).unwrap();
    let start = Instant::now();
    assert!(matches!(other.try_lock_deployment(), Err(StoreError::Busy)));
    assert!(start.elapsed() < Duration::from_secs(1));
    store.initialize().unwrap();
    let key = "a".repeat(64);
    other.set_policy(0, &key, MemoryPolicy::Never).unwrap();
    assert_eq!(store.load().unwrap().revision(), 1);
    drop(lock);
    let _second = other.try_lock_deployment().unwrap();
    assert!(matches!(store.try_lock_deployment(), Err(StoreError::Busy)));
    assert_eq!(fs::read(directory.path().join(LOCK)).unwrap(), before);
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 3);
}

#[test]
fn separate_processes_contend_and_exit_without_a_stale_lease() {
    let (directory, store) = setup();
    let lock = store.try_lock_deployment().unwrap();
    wait_success(&mut child(directory.path(), "contend"));
    drop(lock);
    wait_success(&mut child(directory.path(), "exit"));
    let _recovered = store.try_lock_deployment().unwrap();
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn killing_the_owned_holder_releases_the_os_lock() {
    let (directory, store) = setup();
    let mut holder = child(directory.path(), "hold");
    let start = Instant::now();
    while !directory.path().join("child-ready").exists() {
        assert!(holder.0.try_wait().unwrap().is_none(), "holder exited");
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "holder timed out"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(matches!(store.try_lock_deployment(), Err(StoreError::Busy)));
    holder.0.kill().unwrap();
    holder.0.wait().unwrap();
    let _recovered = store.try_lock_deployment().unwrap();
    assert!(directory.path().join(LOCK).is_file());
    assert!(!directory.path().join("memory-local.json").exists());
}

#[cfg(unix)]
#[test]
fn unsafe_lock_entries_are_preserved_and_never_followed_or_truncated() {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};

    let (directory, store) = setup();
    let target = directory.path().join("unrelated");
    let lock_path = directory.path().join(LOCK);
    fs::write(&target, "unchanged").unwrap();
    symlink(&target, &lock_path).unwrap();
    assert!(store.try_lock_deployment().is_err());
    fs::remove_file(&lock_path).unwrap();
    fs::hard_link(&target, &lock_path).unwrap();
    assert!(matches!(
        store.try_lock_deployment(),
        Err(StoreError::InvalidStore)
    ));
    fs::remove_file(&lock_path).unwrap();
    fs::create_dir(&lock_path).unwrap();
    assert!(store.try_lock_deployment().is_err());
    fs::remove_dir(&lock_path).unwrap();
    let fifo = std::ffi::CString::new(lock_path.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
    assert!(store.try_lock_deployment().is_err());
    fs::remove_file(&lock_path).unwrap();
    fs::write(&lock_path, "keep lock bytes").unwrap();
    fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o666)).unwrap();
    assert!(matches!(
        store.try_lock_deployment(),
        Err(StoreError::InvalidStore)
    ));
    fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o600)).unwrap();
    let inode = fs::metadata(&lock_path).unwrap().ino();
    let lock = store.try_lock_deployment().unwrap();
    drop(lock);
    let _again = store.try_lock_deployment().unwrap();
    assert_eq!(fs::metadata(&lock_path).unwrap().ino(), inode);
    assert_eq!(fs::read_to_string(&lock_path).unwrap(), "keep lock bytes");
    assert_eq!(fs::read_to_string(target).unwrap(), "unchanged");
}
