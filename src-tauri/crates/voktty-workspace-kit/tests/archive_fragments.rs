use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{
    check_memory_archive_fragments, snapshot_memory_preservation, PathFact,
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

#[test]
fn shared_fragments_preserve_complete_reasons_and_append_only_archives() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/archive-fragments.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["cases"].as_array().unwrap() {
        let previous = documents(&case["before"]);
        let current = documents(&case["after"]);
        let before = snapshot_memory_preservation(&previous, true).unwrap();
        let after = snapshot_memory_preservation(&current, true).unwrap();
        let report = check_memory_archive_fragments(
            &before,
            &after,
            &previous,
            &current,
            case["nowMs"].as_u64().unwrap(),
            case["afterDays"].as_u64().unwrap(),
        )
        .unwrap();
        assert_eq!(json!(report), case["expected"], "{}", case["name"]);
    }
}

#[test]
fn unavailable_changed_and_oversized_evidence_cannot_produce_credit() {
    let mut previous = documents(&json!({}));
    let current = documents(&json!({}));
    let before = snapshot_memory_preservation(&previous, true).unwrap();
    let after = snapshot_memory_preservation(&current, true).unwrap();
    previous.insert(
        "PROJECT.md".into(),
        PathFact::File {
            text: "Changed".into(),
        },
    );
    assert_eq!(
        check_memory_archive_fragments(&before, &after, &previous, &current, 0, 30).unwrap_err()[0]
            .code,
        "KIT_ARCHIVE_FRAGMENT_SOURCE_CHANGED"
    );
    previous.insert(
        "PROJECT.md".into(),
        PathFact::File {
            text: String::new(),
        },
    );
    let changed_current = documents(&json!({"PROJECT.md": "Changed after"}));
    assert_eq!(
        check_memory_archive_fragments(&before, &after, &previous, &changed_current, 0, 30)
            .unwrap_err()[0]
            .code,
        "KIT_ARCHIVE_FRAGMENT_SOURCE_CHANGED"
    );
    previous.insert("PROJECT.md".into(), PathFact::Blocked);
    assert_eq!(
        check_memory_archive_fragments(&before, &after, &previous, &current, 0, 30).unwrap_err()[0]
            .code,
        "KIT_PRESERVATION_INCOMPLETE"
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
        check_memory_archive_fragments(&before, &after, &many, &current, 0, 30).unwrap_err()[0]
            .code,
        "KIT_PRESERVATION_FILE_LIMIT"
    );
    assert_eq!(
        check_memory_archive_fragments(&before, &after, &previous, &current, u64::MAX, 30)
            .unwrap_err()[0]
            .code,
        "KIT_ARCHIVE_TIME_INVALID"
    );
}

#[test]
fn exact_comparison_budget_still_reports_all_missing_evidence() {
    let old = (1..=256)
        .map(|i| format!("- [T-{i} done] Done · closed 2030-01-01\n"))
        .collect::<String>();
    let previous = documents(&json!({"plans/TRACKING.md": old}));
    let current = documents(&json!({"plans/TRACKING.md": "x".repeat(256 * 1024)}));
    let before = snapshot_memory_preservation(&previous, true).unwrap();
    let after = snapshot_memory_preservation(&current, true).unwrap();
    let report =
        check_memory_archive_fragments(&before, &after, &previous, &current, 2000000000000, 30)
            .unwrap();
    assert_eq!(report.missing_fragments.len(), 256);
    assert!(report.fragments.is_empty());
}

#[test]
fn exhausted_block_and_boundary_budgets_fail_explicitly() {
    let many_blocks = (1..=257)
        .map(|i| format!("- [T-{i} done] Done · closed 2030-01-01\n"))
        .collect::<String>();
    for old in [
        many_blocks,
        format!(
            "{}- [T-1 done] Done · closed 2030-01-01\n",
            "# H\n".repeat(1025)
        ),
    ] {
        let previous = documents(&json!({"plans/TRACKING.md": old}));
        let current = documents(&json!({}));
        let before = snapshot_memory_preservation(&previous, true).unwrap();
        let after = snapshot_memory_preservation(&current, true).unwrap();
        assert_eq!(
            check_memory_archive_fragments(&before, &after, &previous, &current, 2000000000000, 30)
                .unwrap_err()[0]
                .code,
            "KIT_ARCHIVE_FRAGMENT_LIMIT"
        );
    }
}
