use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{compare_memory_preservation, snapshot_memory_preservation, PathFact};

#[test]
fn shared_preservation_snapshots_and_loss_diagnostics_match() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/preservation.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["snapshots"].as_array().unwrap() {
        let files = serde_json::from_value(case["documents"].clone()).unwrap();
        assert_eq!(
            json!(snapshot_memory_preservation(&files, true).unwrap()),
            case["expected"],
            "{}",
            case["name"]
        );
    }
    for case in corpus["comparisons"].as_array().unwrap() {
        let before = snapshot_memory_preservation(
            &serde_json::from_value(case["before"].clone()).unwrap(),
            true,
        )
        .unwrap();
        let after = snapshot_memory_preservation(
            &serde_json::from_value(case["after"].clone()).unwrap(),
            true,
        )
        .unwrap();
        assert_eq!(
            json!(compare_memory_preservation(&before, &after)),
            case["expected"],
            "{}",
            case["name"]
        );
    }
    for case in corpus["invalid"].as_array().unwrap() {
        let files = serde_json::from_value(case["documents"].clone()).unwrap();
        assert_eq!(
            snapshot_memory_preservation(&files, case["complete"].as_bool().unwrap()).unwrap_err()
                [0]
            .code,
            case["error"].as_str().unwrap(),
            "{}",
            case["name"]
        );
    }
}

#[test]
fn snapshot_resource_limits_and_unavailable_facts_fail_explicitly() {
    let paths = [
        "PROJECT.md",
        "CONTEXT.md",
        "plans/INDEX.md",
        "plans/TRACKING.md",
        "continuity/CHANGELOG.md",
        "archive/LOG.md",
    ];
    let base: BTreeMap<_, _> = paths
        .into_iter()
        .map(|path| {
            (
                path.into(),
                PathFact::File {
                    text: String::new(),
                },
            )
        })
        .collect();
    for fact in [PathFact::Absent, PathFact::Blocked] {
        let mut files = base.clone();
        files.insert("CONTEXT.md".into(), fact);
        assert_eq!(
            snapshot_memory_preservation(&files, true).unwrap_err()[0].code,
            "KIT_PRESERVATION_INCOMPLETE"
        );
    }
    let mut files = base.clone();
    for n in 0..123 {
        files.insert(
            format!("domains/{n}.md"),
            PathFact::File {
                text: String::new(),
            },
        );
    }
    assert_eq!(
        snapshot_memory_preservation(&files, true).unwrap_err()[0].code,
        "KIT_PRESERVATION_FILE_LIMIT"
    );
    for text in ["[T-1] ".repeat(8193), format!("[T-{}]", "1".repeat(63))] {
        let mut files = base.clone();
        files.insert("CONTEXT.md".into(), PathFact::File { text });
        assert_eq!(
            snapshot_memory_preservation(&files, true).unwrap_err()[0].code,
            "KIT_PRESERVATION_ITEM_LIMIT"
        );
    }
    let mut files = base;
    for n in 0..17 {
        files.insert(
            format!("domains/{n}.md"),
            PathFact::File {
                text: "a".repeat(256 * 1024),
            },
        );
    }
    assert_eq!(
        snapshot_memory_preservation(&files, true).unwrap_err()[0].code,
        "KIT_PRESERVATION_BYTE_LIMIT"
    );
}
