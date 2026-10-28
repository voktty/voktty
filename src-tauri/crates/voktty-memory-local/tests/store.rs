use std::fs::{self, File, OpenOptions};
use std::process::Command;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use voktty_memory_local::{LocalMemoryStore, MemoryPolicy, StoreError};

const KEY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

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

#[test]
fn initialization_is_explicit_stable_and_distinct_per_installation() {
    let (directory, store) = setup();
    assert_eq!(store.load(), Err(StoreError::Missing));
    assert!(!directory.path().join("memory-local.json").exists());
    let first = store.initialize().unwrap();
    assert_eq!(first.revision(), 0);
    assert!(first.project(KEY).is_none());
    assert_eq!(store.initialize().unwrap(), first);
    assert_eq!(
        LocalMemoryStore::open(directory.path())
            .unwrap()
            .load()
            .unwrap(),
        first
    );
    let (_other, other) = setup();
    assert_ne!(
        first.installation_id(),
        other.initialize().unwrap().installation_id()
    );
}

#[test]
fn policy_trust_and_revocation_are_independent_and_persist() {
    let (directory, store) = setup();
    store.initialize().unwrap();
    let policy = store.set_policy(0, KEY, MemoryPolicy::Never).unwrap();
    assert_eq!(policy.project(KEY).unwrap().instruction_digest, None);
    let trusted = store.trust_instructions(1, KEY, HASH).unwrap();
    assert_eq!(trusted.project(KEY).unwrap().policy, MemoryPolicy::Never);
    let second = store.trust_instructions(2, OTHER, HASH).unwrap();
    assert_eq!(second.project(OTHER).unwrap().policy, MemoryPolicy::Manual);
    let revoked = store.revoke_trust(3, KEY).unwrap();
    assert_eq!(revoked.project(KEY).unwrap().policy, MemoryPolicy::Never);
    assert_eq!(revoked.project(KEY).unwrap().instruction_digest, None);
    assert_eq!(
        revoked
            .project(OTHER)
            .unwrap()
            .instruction_digest
            .as_deref(),
        Some(HASH)
    );
    assert_eq!(store.load().unwrap(), revoked);
    let bytes = fs::read_to_string(directory.path().join("memory-local.json")).unwrap();
    assert!(!bytes.contains("session"));
    assert!(!bytes.contains("capture"));
}

#[test]
fn stale_acceptance_cannot_overwrite_a_new_policy_or_trust_revocation() {
    let (directory, store) = setup();
    store.initialize().unwrap();
    store.trust_instructions(0, KEY, HASH).unwrap();
    let second = LocalMemoryStore::open(directory.path()).unwrap();
    let stale = second.load().unwrap();
    store.revoke_trust(1, KEY).unwrap();
    assert_eq!(
        second.set_policy(stale.revision(), KEY, MemoryPolicy::Always),
        Err(StoreError::Conflict)
    );
    assert_eq!(
        second.trust_instructions(stale.revision(), KEY, HASH),
        Err(StoreError::Conflict)
    );
    let current = second.load().unwrap();
    assert_eq!(current.revision(), 2);
    assert_eq!(current.project(KEY).unwrap().policy, MemoryPolicy::Manual);
    assert_eq!(current.project(KEY).unwrap().instruction_digest, None);
}

#[test]
fn legacy_ask_is_manual_and_migrates_on_the_next_explicit_write() {
    let (directory, store) = setup();
    let initial = store.initialize().unwrap();
    let mut value = serde_json::to_value(initial).unwrap();
    value["projects"] = json!([{"projectKey":KEY,"policy":"ask","instructionDigest":null}]);
    let path = directory.path().join("memory-local.json");
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(
        store.load().unwrap().project(KEY).unwrap().policy,
        MemoryPolicy::Manual
    );
    assert!(fs::read_to_string(&path).unwrap().contains("ask"));
    store.trust_instructions(0, KEY, HASH).unwrap();
    let text = fs::read_to_string(path).unwrap();
    assert!(!text.contains("ask"));
    assert!(text.contains("manual"));
}

#[test]
fn corrupt_unknown_duplicate_and_oversized_stores_are_preserved_and_block_all_operations() {
    let (directory, store) = setup();
    let initial = serde_json::to_value(store.initialize().unwrap()).unwrap();
    let entry = json!({"projectKey":KEY,"policy":"never","instructionDigest":null});
    let mut cases = vec![b"{".to_vec(), vec![b' '; 256 * 1024 + 1]];
    for (field, value) in [
        ("schema", json!(2)),
        ("installationId", json!("not-an-id")),
        ("revision", json!(-1)),
        ("projects", json!([entry.clone(), entry])),
        ("session", json!({})),
        (
            "projects",
            json!([{"projectKey":KEY,"policy":"always","instructionDigest":"wrong"}]),
        ),
    ] {
        let mut bad = initial.clone();
        bad[field] = value;
        cases.push(serde_json::to_vec(&bad).unwrap());
    }
    let text = serde_json::to_string(&initial).unwrap();
    cases.push(
        text.replacen("\"schema\":1", "\"schema\":1,\"schema\":1", 1)
            .into_bytes(),
    );
    let path = directory.path().join("memory-local.json");
    for bytes in cases {
        fs::write(&path, &bytes).unwrap();
        assert_eq!(store.load(), Err(StoreError::InvalidStore));
        assert_eq!(store.initialize(), Err(StoreError::InvalidStore));
        assert_eq!(
            store.set_policy(0, KEY, MemoryPolicy::Always),
            Err(StoreError::InvalidStore)
        );
        assert_eq!(
            store.trust_instructions(0, KEY, HASH),
            Err(StoreError::InvalidStore)
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn invalid_inputs_do_not_change_revision_or_disk_bytes() {
    let (directory, store) = setup();
    store.initialize().unwrap();
    let path = directory.path().join("memory-local.json");
    let before = fs::read(&path).unwrap();
    for key in ["", "../project", &"a".repeat(65), &"A".repeat(64)] {
        assert_eq!(
            store.set_policy(0, key, MemoryPolicy::Always),
            Err(StoreError::InvalidInput)
        );
    }
    assert_eq!(
        store.trust_instructions(0, KEY, "bad"),
        Err(StoreError::InvalidInput)
    );
    assert_eq!(fs::read(path).unwrap(), before);
}

#[test]
fn full_store_and_revision_overflow_do_not_evict_never_or_mutate_bytes() {
    let (directory, store) = setup();
    let mut value = serde_json::to_value(store.initialize().unwrap()).unwrap();
    value["projects"] = Value::Array((0..256).map(|n| json!({"projectKey":format!("{n:064x}"),"policy":"never","instructionDigest":null})).collect());
    let path = directory.path().join("memory-local.json");
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    let before = fs::read(&path).unwrap();
    assert_eq!(
        store.set_policy(0, KEY, MemoryPolicy::Always),
        Err(StoreError::Limit)
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    value["revision"] = json!(u64::MAX);
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    let before = fs::read(&path).unwrap();
    assert_eq!(
        store.set_policy(u64::MAX, &format!("{:064x}", 0), MemoryPolicy::Always),
        Err(StoreError::Limit)
    );
    assert_eq!(fs::read(path).unwrap(), before);
}

#[test]
fn locked_store_fails_promptly_and_release_does_not_leave_a_stale_lock() {
    let (directory, store) = setup();
    store.initialize().unwrap();
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(directory.path().join("memory-local.lock"))
        .unwrap();
    file.try_lock().unwrap();
    let start = Instant::now();
    assert_eq!(store.load(), Err(StoreError::Busy));
    assert_eq!(store.initialize(), Err(StoreError::Busy));
    assert_eq!(
        store.set_policy(0, KEY, MemoryPolicy::Always),
        Err(StoreError::Busy)
    );
    assert!(start.elapsed() < Duration::from_secs(1));
    drop(file);
    store.set_policy(0, KEY, MemoryPolicy::Never).unwrap();
}

#[test]
fn lock_child() {
    let Some(directory) = std::env::var_os("VOKTTY_MEMORY_TEST_LOCK_DIRECTORY") else {
        return;
    };
    let store = LocalMemoryStore::open(std::path::Path::new(&directory)).unwrap();
    assert_eq!(store.load(), Err(StoreError::Busy));
    assert_eq!(store.initialize(), Err(StoreError::Busy));
    assert_eq!(
        store.trust_instructions(0, KEY, HASH),
        Err(StoreError::Busy)
    );
}

#[test]
fn exclusion_applies_to_a_separate_process() {
    let (directory, store) = setup();
    store.initialize().unwrap();
    let lock = File::options()
        .read(true)
        .write(true)
        .open(directory.path().join("memory-local.lock"))
        .unwrap();
    lock.try_lock().unwrap();
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "lock_child", "--nocapture"])
        .env("VOKTTY_MEMORY_TEST_LOCK_DIRECTORY", directory.path())
        .spawn()
        .unwrap();
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        if start.elapsed() > Duration::from_secs(10) {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("child lock check timed out");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    drop(lock);
    assert_eq!(store.load().unwrap().revision(), 0);
}

#[cfg(unix)]
#[test]
fn symlinks_hardlinks_and_special_files_never_read_or_modify_their_targets() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let (directory, store) = setup();
    let target = directory.path().join("unrelated");
    fs::write(&target, "untouched").unwrap();
    for name in ["memory-local.lock", "memory-local.json"] {
        let path = directory.path().join(name);
        symlink(&target, &path).unwrap();
        assert!(store.initialize().is_err());
        fs::remove_file(&path).unwrap();
        fs::hard_link(&target, &path).unwrap();
        assert!(store.initialize().is_err());
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(store.initialize().is_err());
        fs::remove_dir(&path).unwrap();
        use std::os::unix::ffi::OsStrExt;
        let fifo = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        assert!(store.initialize().is_err());
        fs::remove_file(&path).unwrap();
    }
    assert_eq!(fs::read_to_string(target).unwrap(), "untouched");
    store.initialize().unwrap();
    for name in ["memory-local.lock", "memory-local.json"] {
        assert_eq!(
            fs::metadata(directory.path().join(name))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn atomic_replacement_leaves_no_staging_artifacts() {
    let (directory, store) = setup();
    store.initialize().unwrap();
    for n in 0..20 {
        store.set_policy(n, KEY, MemoryPolicy::Never).unwrap();
    }
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
    assert_eq!(store.load().unwrap().revision(), 20);
}

#[cfg(unix)]
#[test]
fn shared_writable_directories_and_records_are_rejected() {
    use std::os::unix::fs::PermissionsExt;
    let (directory, store) = setup();
    store.initialize().unwrap();
    let path = directory.path().join("memory-local.json");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();
    assert_eq!(store.load(), Err(StoreError::InvalidStore));
    assert_eq!(
        store.set_policy(0, KEY, MemoryPolicy::Always),
        Err(StoreError::InvalidStore)
    );
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o777)).unwrap();
    assert!(matches!(
        LocalMemoryStore::open(directory.path()),
        Err(StoreError::InvalidInput)
    ));
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
}

#[test]
fn persisted_preferences_still_need_native_scope_trust_and_session_capture_consent() {
    let (_directory, store) = setup();
    store.initialize().unwrap();
    store.set_policy(0, KEY, MemoryPolicy::Always).unwrap();
    let snapshot = store.trust_instructions(1, KEY, HASH).unwrap();
    let preference = snapshot.project(KEY).unwrap();
    let mut input = json!({"schema":1,"projectKey":KEY,"sessionId":"session","kitState":"ready","instructionDigest":HASH,
        "localPolicy":{"projectKey":preference.project_key,"mode":preference.policy},
        "trust":{"projectKey":preference.project_key,"instructionDigest":preference.instruction_digest},
        "session":null,"capabilities":{"context":true,"capture":true}});
    let decision =
        |value: &Value| voktty_workspace_kit::evaluate_memory_use(&value.to_string()).unwrap();
    assert!(decision(&input).context_allowed);
    assert!(!decision(&input).capture_allowed);
    input["instructionDigest"] = json!(OTHER);
    assert_eq!(decision(&input).reason, "KIT_MEMORY_INSTRUCTIONS_CHANGED");
    input["instructionDigest"] = json!(HASH);
    input["kitState"] = json!("incomplete");
    assert_eq!(decision(&input).reason, "KIT_MEMORY_INCOMPLETE");
    input["kitState"] = json!("ready");
    input["projectKey"] = json!(OTHER);
    assert_eq!(decision(&input).reason, "KIT_MEMORY_CONSENT_REQUIRED");
}
