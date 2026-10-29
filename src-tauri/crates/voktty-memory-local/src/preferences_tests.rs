use super::*;
use crate::{LocalMemoryWorkspace, MemoryReadAccess, ReadControl, ReadError};
use serde_json::json;
use std::path::Path;

const KEY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
fn instance(birth: u64) -> RootInstance {
    RootInstance::unix(
        1,
        2,
        Some(std::time::UNIX_EPOCH + std::time::Duration::from_secs(birth)),
    )
    .unwrap()
}
fn store() -> (tempfile::TempDir, LocalMemoryStore) {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let store = LocalMemoryStore::open(dir.path()).unwrap();
    store.initialize().unwrap();
    (dir, store)
}

#[test]
fn legacy_reads_preserve_bytes_and_denials_without_inheriting_positive_grants() {
    let (dir, store) = store();
    store.set_policy(0, KEY, MemoryPolicy::Always).unwrap();
    store.trust_instructions(1, KEY, HASH).unwrap();
    store.set_policy(2, OTHER, MemoryPolicy::Never).unwrap();
    let path = dir.path().join(STORE);
    let before = fs::read(&path).unwrap();
    let snapshot = store.load().unwrap();
    let effective = snapshot.project_for_root(KEY, Some(&instance(1))).unwrap();
    assert_eq!(effective.policy, MemoryPolicy::Manual);
    assert_eq!(effective.instruction_digest, None);
    assert_eq!(
        snapshot.project_for_root(OTHER, None).unwrap().policy,
        MemoryPolicy::Never
    );
    assert_eq!(snapshot.project(KEY).unwrap().policy, MemoryPolicy::Always);
    assert_eq!(snapshot.schema, 1);
    assert_eq!(fs::read(path).unwrap(), before);
}

#[test]
fn explicit_binding_migrates_once_without_reactivating_legacy_always_or_changing_other_records() {
    let (dir, store) = store();
    store.set_policy(0, KEY, MemoryPolicy::Always).unwrap();
    store.set_policy(1, OTHER, MemoryPolicy::Never).unwrap();
    let original = store.load().unwrap();
    let bound = store
        .trust_for_root(2, original.installation_id(), KEY, &instance(1), HASH)
        .unwrap();
    assert_eq!(bound.schema, 2);
    assert_eq!(bound.revision(), 3);
    assert_eq!(bound.project(KEY).unwrap().policy, MemoryPolicy::Manual);
    assert_eq!(
        bound
            .project_for_root(KEY, Some(&instance(1)))
            .unwrap()
            .instruction_digest
            .as_deref(),
        Some(HASH)
    );
    assert_eq!(bound.project(OTHER), original.project(OTHER));
    let reopened = LocalMemoryStore::open(dir.path()).unwrap().load().unwrap();
    assert_eq!(reopened, bound);
    assert!(serde_json::to_value(reopened).unwrap()["bindings"].is_array());
}

#[test]
fn reused_file_ids_with_a_new_birth_time_cannot_inherit_always_or_trust() {
    let (_dir, store) = store();
    let original = store.load().unwrap();
    store
        .trust_for_root(0, original.installation_id(), KEY, &instance(1), HASH)
        .unwrap();
    let enabled = store.set_policy(1, KEY, MemoryPolicy::Always).unwrap();
    assert_eq!(
        enabled
            .project_for_root(KEY, Some(&instance(1)))
            .unwrap()
            .policy,
        MemoryPolicy::Always
    );
    for root in [Some(instance(2)), None] {
        let effective = enabled.project_for_root(KEY, root.as_ref()).unwrap();
        assert_eq!(effective.policy, MemoryPolicy::Manual);
        assert_eq!(effective.instruction_digest, None);
    }
    let never = store.set_policy(2, KEY, MemoryPolicy::Never).unwrap();
    assert_eq!(
        never
            .project_for_root(KEY, Some(&instance(2)))
            .unwrap()
            .policy,
        MemoryPolicy::Never
    );
    let rebound = store
        .trust_for_root(3, original.installation_id(), KEY, &instance(2), HASH)
        .unwrap();
    assert_eq!(
        rebound
            .project_for_root(KEY, Some(&instance(2)))
            .unwrap()
            .policy,
        MemoryPolicy::Never
    );
    assert_eq!(
        rebound
            .project_for_root(KEY, Some(&instance(1)))
            .unwrap()
            .instruction_digest,
        None
    );
}

#[test]
fn unavailable_or_empty_birth_information_is_never_a_persisted_root_identity() {
    assert!(RootInstance::unix(1, 2, None).is_none());
    assert!(RootInstance::unix(1, 2, Some(std::time::UNIX_EPOCH)).is_none());
    assert!(RootInstance::unix(
        1,
        0,
        Some(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1))
    )
    .is_none());
    assert!(RootInstance::valid(&instance(1).0));
}

#[test]
fn schema_binding_corruption_and_mixed_versions_are_never_repaired() {
    let (dir, store) = store();
    let initial = store.load().unwrap();
    let valid = store
        .trust_for_root(0, initial.installation_id(), KEY, &instance(1), HASH)
        .unwrap();
    let valid = serde_json::to_value(valid).unwrap();
    let binding = valid["bindings"][0].clone();
    let mut cases = Vec::new();
    for (field, value) in [
        ("schema", json!(1)),
        ("schema", json!(3)),
        ("bindings", json!(null)),
        ("bindings", json!([binding.clone(), binding.clone()])),
        (
            "bindings",
            json!([{"projectKey":OTHER,"root":binding["root"]}]),
        ),
        ("bindings", json!([{"projectKey":KEY,"root":"untrusted"}])),
        (
            "bindings",
            json!([{"projectKey":KEY,"root":binding["root"],"permit":true}]),
        ),
    ] {
        let mut bad = valid.clone();
        bad[field] = value;
        cases.push(serde_json::to_vec(&bad).unwrap());
    }
    let mut absent = valid.clone();
    absent.as_object_mut().unwrap().remove("bindings");
    cases.push(serde_json::to_vec(&absent).unwrap());
    let mut null_legacy = serde_json::to_value(initial).unwrap();
    null_legacy["bindings"] = json!(null);
    cases.push(serde_json::to_vec(&null_legacy).unwrap());
    let text = valid.to_string();
    cases.push(
        text.replacen("\"bindings\":", "\"bindings\":[],\"bindings\":", 1)
            .into_bytes(),
    );
    let path = dir.path().join(STORE);
    for bytes in cases {
        fs::write(&path, &bytes).unwrap();
        assert_eq!(store.load(), Err(StoreError::InvalidStore));
        assert_eq!(store.initialize(), Err(StoreError::InvalidStore));
        assert_eq!(
            store.trust_for_root(
                1,
                valid["installationId"].as_str().unwrap(),
                KEY,
                &instance(1),
                HASH
            ),
            Err(StoreError::InvalidStore)
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn stale_revision_or_installation_cannot_bind_a_new_store_or_override_never() {
    let (dir, store) = store();
    let initial = store.load().unwrap();
    store.set_policy(0, KEY, MemoryPolicy::Never).unwrap();
    let before = fs::read(dir.path().join(STORE)).unwrap();
    assert_eq!(
        store.trust_for_root(0, initial.installation_id(), KEY, &instance(1), HASH),
        Err(StoreError::Conflict)
    );
    assert_eq!(fs::read(dir.path().join(STORE)).unwrap(), before);
    fs::remove_file(dir.path().join(STORE)).unwrap();
    store.initialize().unwrap();
    let fresh = fs::read(dir.path().join(STORE)).unwrap();
    assert_eq!(
        store.trust_for_root(0, initial.installation_id(), KEY, &instance(1), HASH),
        Err(StoreError::Conflict)
    );
    assert_eq!(fs::read(dir.path().join(STORE)).unwrap(), fresh);
}

#[test]
fn binding_capacity_and_revision_overflow_never_evict_denials_or_mutate_state() {
    let (dir, store) = store();
    let initial = store.load().unwrap();
    let mut value = serde_json::to_value(initial).unwrap();
    value["projects"] = json!((0..256)
        .map(
            |n| json!({"projectKey":format!("{n:064x}"),"policy":"never","instructionDigest":null})
        )
        .collect::<Vec<_>>());
    let path = dir.path().join(STORE);
    fs::write(&path, value.to_string()).unwrap();
    let before = fs::read(&path).unwrap();
    assert_eq!(
        store.trust_for_root(
            0,
            value["installationId"].as_str().unwrap(),
            KEY,
            &instance(1),
            HASH
        ),
        Err(StoreError::Limit)
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    value["revision"] = json!(u64::MAX);
    fs::write(&path, value.to_string()).unwrap();
    let before = fs::read(&path).unwrap();
    assert_eq!(
        store.trust_for_root(
            u64::MAX,
            value["installationId"].as_str().unwrap(),
            &format!("{:064x}", 0),
            &instance(1),
            HASH
        ),
        Err(StoreError::Limit)
    );
    assert_eq!(fs::read(path).unwrap(), before);
}

struct Access(std::path::PathBuf);
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
    fn allows_read(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
}
fn populate(root: &Path) {
    for file in voktty_workspace_kit::render_template(
        json!({"project_name":"Root binding", "created_at":"2026-10-29"})
            .as_object()
            .unwrap(),
    )
    .unwrap()
    {
        if !file.path.starts_with(".voktty/") {
            continue;
        }
        let path = root.join(file.path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, file.text).unwrap();
    }
}

#[test]
fn reopening_the_same_native_root_preserves_trust_across_ordinary_directory_changes() {
    let (_state, store) = store();
    let project = tempfile::tempdir_in("/dev/shm").unwrap();
    populate(project.path());
    let access = Access(project.path().to_owned());
    let workspace =
        LocalMemoryWorkspace::open(&store, project.path(), &access, &ReadControl::default())
            .unwrap();
    let observed = workspace
        .observe_context(None, &ReadControl::default())
        .unwrap();
    let accepted = workspace
        .trust_instructions(0, &observed.fingerprint.digest, &ReadControl::default())
        .unwrap();
    assert_eq!(accepted.schema, 2);
    store
        .set_policy(1, workspace.project_key(), MemoryPolicy::Always)
        .unwrap();
    fs::write(project.path().join("new-file"), "ordinary edit").unwrap();
    let again =
        LocalMemoryWorkspace::open(&store, project.path(), &access, &ReadControl::default())
            .unwrap();
    let after = again
        .observe_context(None, &ReadControl::default())
        .unwrap();
    assert_eq!(
        after.preference.as_ref().unwrap().policy,
        MemoryPolicy::Always
    );
    assert_eq!(
        after
            .preference
            .as_ref()
            .unwrap()
            .instruction_digest
            .as_deref(),
        Some(observed.fingerprint.digest.as_str())
    );
    assert_eq!(workspace.project_key(), again.project_key());
}

#[test]
fn a_cold_replacement_at_the_same_native_path_keeps_its_key_but_not_positive_permissions() {
    for policy in [MemoryPolicy::Always, MemoryPolicy::Never] {
        let (state, store) = store();
        let project = tempfile::tempdir_in("/dev/shm").unwrap();
        let root = project.path().join("current");
        fs::create_dir(&root).unwrap();
        populate(&root);
        let access = Access(root.clone());
        let workspace =
            LocalMemoryWorkspace::open(&store, &root, &access, &ReadControl::default()).unwrap();
        let observed = workspace
            .observe_context(None, &ReadControl::default())
            .unwrap();
        workspace
            .trust_instructions(0, &observed.fingerprint.digest, &ReadControl::default())
            .unwrap();
        store
            .set_policy(1, workspace.project_key(), policy)
            .unwrap();
        drop(workspace);
        drop(store);
        fs::rename(&root, project.path().join("previous")).unwrap();
        fs::create_dir(&root).unwrap();
        populate(&root);
        let store = LocalMemoryStore::open(state.path()).unwrap();
        let before = fs::read(state.path().join(STORE)).unwrap();
        let fresh =
            LocalMemoryWorkspace::open(&store, &root, &access, &ReadControl::default()).unwrap();
        let current = fresh
            .observe_context(None, &ReadControl::default())
            .unwrap();
        assert_eq!(current.project_key, observed.project_key);
        assert_eq!(current.fingerprint, observed.fingerprint);
        assert_eq!(
            current.preference.as_ref().unwrap().instruction_digest,
            None
        );
        assert_eq!(
            current.preference.as_ref().unwrap().policy,
            if policy == MemoryPolicy::Never {
                MemoryPolicy::Never
            } else {
                MemoryPolicy::Manual
            }
        );
        assert!(matches!(
            fresh.trust_instructions(1, HASH, &ReadControl::default()),
            Err(ReadError::Store(StoreError::Conflict))
        ));
        assert_eq!(fs::read(state.path().join(STORE)).unwrap(), before);
        let accepted = fresh
            .trust_instructions(2, &current.fingerprint.digest, &ReadControl::default())
            .unwrap();
        assert_eq!(
            accepted.project(&current.project_key).unwrap().policy,
            current.preference.as_ref().unwrap().policy
        );
    }
}
