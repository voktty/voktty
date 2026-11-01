use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{check_memory_archive_log, snapshot_memory_preservation, PathFact};

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
fn shared_archive_log_records_match_observed_movements_and_live_file_sizes() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/archive-log.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["cases"].as_array().unwrap() {
        let before = snapshot_memory_preservation(&documents(&case["before"]), true).unwrap();
        let after = snapshot_memory_preservation(&documents(&case["after"]), true).unwrap();
        let old = case["suppliedBeforeLog"]
            .as_str()
            .or_else(|| case["before"]["archive/LOG.md"].as_str())
            .unwrap_or("");
        let current = case["suppliedAfterLog"]
            .as_str()
            .or_else(|| case["after"]["archive/LOG.md"].as_str())
            .unwrap_or("");
        let result = check_memory_archive_log(&before, &after, old, current);
        if let Some(code) = case["error"].as_str() {
            assert_eq!(result.unwrap_err()[0].code, code, "{}", case["name"]);
        } else {
            assert_eq!(json!(result.unwrap()), case["expected"], "{}", case["name"]);
        }
    }
}

#[test]
fn log_and_record_budgets_fail_explicitly() {
    let base = documents(&json!({}));
    let snapshot = snapshot_memory_preservation(&base, true).unwrap();
    assert_eq!(
        check_memory_archive_log(&snapshot, &snapshot, "", &"x".repeat(262145)).unwrap_err()[0]
            .code,
        "KIT_ARCHIVE_LOG_LIMIT"
    );
    let log = "VOKTTY-unknown\n".repeat(1025);
    let after =
        snapshot_memory_preservation(&documents(&json!({"archive/LOG.md": log})), true).unwrap();
    assert_eq!(
        check_memory_archive_log(&snapshot, &after, "", &log).unwrap_err()[0].code,
        "KIT_ARCHIVE_LOG_LIMIT"
    );
    let log = format!("VOKTTY-{}\n", "x".repeat(16384));
    let after =
        snapshot_memory_preservation(&documents(&json!({"archive/LOG.md": log})), true).unwrap();
    let report = check_memory_archive_log(&snapshot, &after, "", &log).unwrap();
    assert!(!report.complete);
    assert_eq!(report.invalid_lines, vec![1]);
}
