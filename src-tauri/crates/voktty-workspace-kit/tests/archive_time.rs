use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{check_memory_archive_time, snapshot_memory_preservation, PathFact};

fn documents(input: &Value) -> BTreeMap<String, PathFact> {
    let mut files: BTreeMap<_, _> = [
        "PROJECT.md",
        "CONTEXT.md",
        "plans/INDEX.md",
        "plans/TRACKING.md",
        "continuity/CHANGELOG.md",
        "archive/LOG.md",
    ]
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
    for (path, text) in input.as_object().unwrap() {
        files.insert(
            path.clone(),
            PathFact::File {
                text: text.as_str().unwrap().into(),
            },
        );
    }
    files
}

#[test]
fn shared_archive_time_requires_observed_moves_and_qualified_dates() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/archive-time.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["cases"].as_array().unwrap() {
        let before = snapshot_memory_preservation(&documents(&case["before"]), true).unwrap();
        let after = snapshot_memory_preservation(&documents(&case["after"]), true).unwrap();
        let report = check_memory_archive_time(
            &before,
            &after,
            case["nowMs"].as_u64().unwrap(),
            case["afterDays"].as_u64().unwrap(),
        )
        .unwrap();
        assert_eq!(json!(report), case["expected"], "{}", case["name"]);
    }
}

#[test]
fn invalid_temporal_settings_fail_even_without_moves() {
    let snapshot = snapshot_memory_preservation(&documents(&json!({})), true).unwrap();
    for (now, days) in [
        (8640000000000001, 30),
        (u64::MAX, 30),
        (0, 0),
        (0, 36501),
        (0, u64::MAX),
    ] {
        let issues = check_memory_archive_time(&snapshot, &snapshot, now, days).unwrap_err();
        assert_eq!(issues[0].code, "KIT_ARCHIVE_TIME_INVALID");
    }
}
