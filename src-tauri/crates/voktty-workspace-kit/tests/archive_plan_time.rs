use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{
    check_memory_archive_time_with_sources, snapshot_memory_preservation, PathFact,
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
fn shared_plan_closure_dates_require_bound_original_sources() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/archive-plan-time.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["cases"].as_array().unwrap() {
        let before = snapshot_memory_preservation(&documents(&case["before"]), true).unwrap();
        let after = snapshot_memory_preservation(&documents(&case["after"]), true).unwrap();
        let report = check_memory_archive_time_with_sources(
            &before,
            &after,
            &documents(&case["sources"]),
            case["nowMs"].as_u64().unwrap(),
            case["afterDays"].as_u64().unwrap(),
        );
        if let Some(error) = case["error"].as_str() {
            assert_eq!(report.unwrap_err()[0].code, error, "{}", case["name"]);
        } else {
            assert_eq!(json!(report.unwrap()), case["expected"], "{}", case["name"]);
        }
    }
}

#[test]
fn source_aware_time_preserves_handoff_qualification_without_sources() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/archive-time.json"
    ))
    .unwrap();
    for case in corpus["cases"].as_array().unwrap() {
        let before = snapshot_memory_preservation(&documents(&case["before"]), true).unwrap();
        let after = snapshot_memory_preservation(&documents(&case["after"]), true).unwrap();
        let report = check_memory_archive_time_with_sources(
            &before,
            &after,
            &BTreeMap::new(),
            case["nowMs"].as_u64().unwrap(),
            case["afterDays"].as_u64().unwrap(),
        )
        .unwrap();
        assert_eq!(json!(report), case["expected"], "{}", case["name"]);
    }
}

#[test]
fn source_limits_and_blocked_facts_never_supply_qualified_dates() {
    let text = "State: closed 2030-01-01\n";
    let before =
        snapshot_memory_preservation(&documents(&json!({"plans/P.md": text})), true).unwrap();
    let after =
        snapshot_memory_preservation(&documents(&json!({"archive/2030-01/P.md": text})), true)
            .unwrap();
    let run = |sources: &BTreeMap<String, PathFact>, now, days| {
        check_memory_archive_time_with_sources(&before, &after, sources, now, days)
    };
    let blocked = BTreeMap::from([("plans/P.md".into(), PathFact::Blocked)]);
    assert_eq!(
        run(&blocked, 2000000000000, 30).unwrap().unknown_dates,
        vec!["plans/P.md"]
    );
    let many = (0..129)
        .map(|i| (format!("plans/{i}.md"), PathFact::Absent))
        .collect();
    assert_eq!(
        run(&many, 0, 30).unwrap_err()[0].code,
        "KIT_ARCHIVE_TIME_SOURCE_LIMIT"
    );
    for text in ["a".repeat(256 * 1024 + 1), "é".repeat(128 * 1024 + 1)] {
        let sources = BTreeMap::from([("plans/P.md".into(), PathFact::File { text })]);
        assert_eq!(
            run(&sources, 0, 30).unwrap_err()[0].code,
            "KIT_ARCHIVE_TIME_SOURCE_LIMIT"
        );
    }
    assert_eq!(
        run(&blocked, u64::MAX, 30).unwrap_err()[0].code,
        "KIT_ARCHIVE_TIME_INVALID"
    );
    assert_eq!(
        run(&blocked, 0, 0).unwrap_err()[0].code,
        "KIT_ARCHIVE_TIME_INVALID"
    );
}

#[test]
fn all_captured_byte_limits_are_checked_before_source_hashes() {
    let mut previous = documents(&json!({}));
    let mut current = documents(&json!({}));
    let mut sources = BTreeMap::new();
    for i in 0..17 {
        let source = format!("plans/P{i}.md");
        previous.insert(
            source.clone(),
            PathFact::File {
                text: "State: closed 2030-01-01\n".into(),
            },
        );
        current.insert(
            format!("archive/2030-01/P{i}.md"),
            PathFact::File {
                text: "State: closed 2030-01-01\n".into(),
            },
        );
        sources.insert(
            source,
            PathFact::File {
                text: "a".repeat(256 * 1024),
            },
        );
    }
    let before = snapshot_memory_preservation(&previous, true).unwrap();
    let after = snapshot_memory_preservation(&current, true).unwrap();
    let result = check_memory_archive_time_with_sources(&before, &after, &sources, 0, 30);
    assert_eq!(result.unwrap_err()[0].code, "KIT_ARCHIVE_TIME_SOURCE_LIMIT");
}
