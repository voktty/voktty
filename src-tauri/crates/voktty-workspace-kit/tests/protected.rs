use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{
    compare_memory_protected, is_memory_protected_path, memory_protected_paths,
    snapshot_memory_protected, PathFact,
};

fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/protected.json"
    ))
    .unwrap()
}
fn facts(overrides: &Value) -> BTreeMap<String, PathFact> {
    let mut sources: BTreeMap<_, _> = memory_protected_paths()
        .into_iter()
        .map(|p| (p, PathFact::Absent))
        .collect();
    sources
        .extend(serde_json::from_value::<BTreeMap<String, PathFact>>(overrides.clone()).unwrap());
    sources
}

#[test]
fn shared_fixed_inventory_snapshots_and_unqualified_paths_match() {
    let corpus = corpus();
    assert_eq!(json!(memory_protected_paths()), corpus["requiredPaths"]);
    for case in corpus["snapshots"].as_array().unwrap() {
        let snapshot = json!(snapshot_memory_protected(&facts(&case["documents"]), true).unwrap());
        let files: Vec<_> = snapshot["files"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| f["kind"] == "file")
            .collect();
        assert_eq!(json!(files), case["expected"], "{}", case["name"]);
        assert!(snapshot["files"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| f["kind"] == "absent")
            .all(|f| f["sha256"].is_null() && f["bytes"].is_null()));
    }
    for path in corpus["invalidPaths"].as_array().unwrap() {
        let path = path.as_str().unwrap();
        assert!(!is_memory_protected_path(path), "{path}");
        let mut sources = facts(&json!({}));
        sources.insert(
            path.into(),
            PathFact::File {
                text: String::new(),
            },
        );
        assert_eq!(
            snapshot_memory_protected(&sources, true).unwrap_err()[0].code,
            "KIT_PROTECTED_PATH_INVALID"
        );
    }
}

#[test]
fn shared_protected_comparisons_preserve_every_change() {
    for case in corpus()["comparisons"].as_array().unwrap() {
        let before = snapshot_memory_protected(&facts(&case["before"]), true).unwrap();
        let after = snapshot_memory_protected(&facts(&case["after"]), true).unwrap();
        assert_eq!(
            json!(compare_memory_protected(&before, &after)),
            case["expected"],
            "{}",
            case["name"]
        );
    }
}

#[test]
fn unavailable_observations_and_resource_limits_never_produce_partial_snapshots() {
    let base = facts(&json!({}));
    for path in memory_protected_paths() {
        let mut missing = base.clone();
        missing.remove(&path);
        assert_eq!(
            snapshot_memory_protected(&missing, true).unwrap_err()[0].code,
            "KIT_PROTECTED_INCOMPLETE"
        );
        let mut blocked = base.clone();
        blocked.insert(path, PathFact::Blocked);
        assert_eq!(
            snapshot_memory_protected(&blocked, true).unwrap_err()[0].code,
            "KIT_PROTECTED_INCOMPLETE"
        );
    }
    assert_eq!(
        snapshot_memory_protected(&base, false).unwrap_err()[0].code,
        "KIT_PROTECTED_INCOMPLETE"
    );
    for (text, error) in [
        ("a\0b".to_owned(), "KIT_PROTECTED_TEXT_INVALID"),
        ("é".repeat(131073), "KIT_PROTECTED_BYTE_LIMIT"),
    ] {
        let mut sources = base.clone();
        sources.insert("AGENTS.md".into(), PathFact::File { text });
        assert_eq!(
            snapshot_memory_protected(&sources, true).unwrap_err()[0].code,
            error
        );
    }
    let mut large = base.clone();
    for n in 0..17 {
        large.insert(
            format!(".voktty/team/roles/role-{n}.md"),
            PathFact::File {
                text: "x".repeat(256 * 1024),
            },
        );
    }
    assert_eq!(
        snapshot_memory_protected(&large, true).unwrap_err()[0].code,
        "KIT_PROTECTED_BYTE_LIMIT"
    );
    let mut many = base;
    for n in 0..129 {
        many.insert(format!(".voktty/team/roles/role-{n}.md"), PathFact::Absent);
    }
    assert_eq!(
        snapshot_memory_protected(&many, true).unwrap_err()[0].code,
        "KIT_PROTECTED_FILE_LIMIT"
    );
}
