use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{
    check_memory_archive_log, check_memory_archive_log_with_sources, snapshot_memory_preservation,
    PathFact,
};

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
fn log(facts: &BTreeMap<String, PathFact>) -> &str {
    match facts.get("archive/LOG.md").unwrap() {
        PathFact::File { text } => text,
        _ => panic!("Missing LOG fixture"),
    }
}

#[test]
fn shared_fragment_log_requires_exact_recomputed_receipts() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/archive-fragment-log.json"
    ))
    .unwrap();
    let fragments: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/archive-fragments.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["cases"].as_array().unwrap() {
        let fixture = fragments["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["name"] == case["fixture"])
            .unwrap();
        let mut previous = documents(&fixture["before"]);
        let mut current = documents(&fixture["after"]);
        for (key, value) in [("extraBefore", &mut previous), ("extraAfter", &mut current)] {
            if let Some(extra) = case[key].as_object() {
                for (path, text) in extra {
                    value.insert(
                        path.clone(),
                        PathFact::File {
                            text: text.as_str().unwrap().into(),
                        },
                    );
                }
            }
        }
        previous.insert(
            "archive/LOG.md".into(),
            PathFact::File {
                text: case["beforeLog"].as_str().unwrap().into(),
            },
        );
        current.insert(
            "archive/LOG.md".into(),
            PathFact::File {
                text: case["afterLog"].as_str().unwrap().into(),
            },
        );
        let before = snapshot_memory_preservation(&previous, true).unwrap();
        let after = snapshot_memory_preservation(&current, true).unwrap();
        let result = check_memory_archive_log_with_sources(
            &before,
            &after,
            &previous,
            &current,
            fixture["nowMs"].as_u64().unwrap(),
            fixture["afterDays"].as_u64().unwrap(),
        );
        if let Some(error) = case["error"].as_str() {
            assert_eq!(result.unwrap_err()[0].code, error, "{}", case["name"]);
        } else {
            let report = result.unwrap();
            assert_eq!(
                json!({"log":report.log,"loggedFragments":report.logged_fragments,"missingFragments":report.missing_fragments}),
                case["expected"],
                "{}",
                case["name"]
            );
            assert_eq!(
                json!(report.fragments),
                fixture["expected"],
                "{}",
                case["name"]
            );
        }
    }
}

#[test]
fn source_aware_log_preserves_all_legacy_actual_inventory_results() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/archive-log.json"
    ))
    .unwrap();
    for case in corpus["cases"].as_array().unwrap() {
        let previous = documents(&case["before"]);
        let current = documents(&case["after"]);
        let before = snapshot_memory_preservation(&previous, true).unwrap();
        let after = snapshot_memory_preservation(&current, true).unwrap();
        let old = check_memory_archive_log(&before, &after, log(&previous), log(&current));
        let new = check_memory_archive_log_with_sources(
            &before,
            &after,
            &previous,
            &current,
            2000000000000,
            30,
        )
        .map(|report| report.log);
        assert_eq!(json!(new), json!(old), "{}", case["name"]);
    }
}

#[test]
fn changed_sources_and_exhausted_record_budgets_cannot_return_receipts() {
    let previous = documents(&json!({}));
    let mut current = documents(&json!({}));
    let before = snapshot_memory_preservation(&previous, true).unwrap();
    let after = snapshot_memory_preservation(&current, true).unwrap();
    current.insert(
        "PROJECT.md".into(),
        PathFact::File {
            text: "Changed".into(),
        },
    );
    assert_eq!(
        check_memory_archive_log_with_sources(&before, &after, &previous, &current, 0, 30)
            .unwrap_err()[0]
            .code,
        "KIT_ARCHIVE_FRAGMENT_SOURCE_CHANGED"
    );
    assert_eq!(
        check_memory_archive_log_with_sources(&before, &after, &previous, &current, u64::MAX, 30)
            .unwrap_err()[0]
            .code,
        "KIT_ARCHIVE_TIME_INVALID"
    );
    let many = (0..129)
        .map(|i| {
            (
                format!("domains/{i}.md"),
                PathFact::File {
                    text: String::new(),
                },
            )
        })
        .collect();
    assert_eq!(
        check_memory_archive_log_with_sources(&before, &after, &many, &current, 0, 30).unwrap_err()
            [0]
        .code,
        "KIT_PRESERVATION_FILE_LIMIT"
    );
    current = documents(&json!({"archive/LOG.md": "VOKTTY-unknown\n".repeat(1025)}));
    let after = snapshot_memory_preservation(&current, true).unwrap();
    assert_eq!(
        check_memory_archive_log_with_sources(&before, &after, &previous, &current, 0, 30)
            .unwrap_err()[0]
            .code,
        "KIT_ARCHIVE_LOG_LIMIT"
    );
}

#[test]
fn legacy_rejects_fragment_syntax_while_source_aware_requires_matching_evidence() {
    let row = format!("VOKTTY-FRAGMENT-1\t2030-03-01\tagent\tplans/TRACKING.md\t3\tarchive/2030-01/TRACKING.md\t1\t{}\n", "0".repeat(64));
    let previous = documents(&json!({}));
    let current = documents(&json!({"archive/LOG.md": row}));
    let before = snapshot_memory_preservation(&previous, true).unwrap();
    let after = snapshot_memory_preservation(&current, true).unwrap();
    let old = check_memory_archive_log(&before, &after, log(&previous), log(&current)).unwrap();
    assert_eq!(old.invalid_lines, vec![1]);
    assert!(old.unmatched_lines.is_empty());
    let new = check_memory_archive_log_with_sources(
        &before,
        &after,
        &previous,
        &current,
        2000000000000,
        30,
    )
    .unwrap();
    assert!(new.log.invalid_lines.is_empty());
    assert_eq!(new.log.unmatched_lines, vec![1]);
    assert!(new.logged_fragments.is_empty());
}
