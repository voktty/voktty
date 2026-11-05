#![cfg(target_os = "linux")]

use super::*;
use voktty_memory_local::OriginMigrationReview;

#[test]
fn live_helper_recognizes_only_the_reviewed_marker_without_resetting_identity() {
    let project = tempfile::tempdir_in("/dev/shm").unwrap();
    let private = tempfile::tempdir().unwrap();
    fs::set_permissions(private.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let data = private.path();
    let legacy = data.join("dev.voktty");
    let control = ReadControl::default();
    LocalMemoryStore::prepare_application_parent(&legacy, &control).unwrap();
    let store = LocalMemoryStore::create_private(&legacy, &control).unwrap();
    store.initialize().unwrap();
    store
        .set_policy(0, &"a".repeat(64), voktty_memory_local::MemoryPolicy::Never)
        .unwrap();
    let state = fs::read(legacy.join("project-memory/memory-local.json")).unwrap();
    let root = project.path();
    let mut helper = Helper::start(data);
    helper.handshake(root);
    let handle = helper.ok(json!({"operation":"open"}));
    let selection = helper.ok(json!({"operation":"select","handle":handle,"path":root,"revision":1,"inspectAncestors":true}));
    assert_eq!(
        helper.memory(
            json!({"operation":"reviewTrust","handle":handle,"selection":selection,"revision":1})
        )["error"]["code"],
        "legacyStateRequiresReview"
    );
    assert!(!data.join("app.voktty.voktty").exists());
    let review = OriginMigrationReview::prepare(data, &control).unwrap();
    let digest = review.digest().to_owned();
    review.accept(&digest, &control).unwrap();
    let reviewed = helper.memory(
        json!({"operation":"reviewTrust","handle":handle,"selection":selection,"revision":2}),
    );
    assert_eq!(reviewed["error"]["code"], "scope");
    let path = data.join("app.voktty.voktty/project-memory/memory-local.json");
    assert_eq!(fs::read(&path).unwrap(), state);
    fs::write(legacy.join("project-memory"), b"foreign marker bytes").unwrap();
    assert_eq!(
        helper.memory(
            json!({"operation":"reviewTrust","handle":handle,"selection":selection,"revision":3})
        )["error"]["code"],
        "legacyStateRequiresReview"
    );
    helper.ok(json!({"operation":"close","handle":handle}));
    assert_eq!(fs::read(path).unwrap(), state);
    assert_eq!(fs::read_dir(root).unwrap().count(), 0);
}
