use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{
    check_memory_archive_links, check_memory_archive_log_with_sources,
    compare_memory_archive_files, compare_memory_preservation, snapshot_memory_preservation,
    PathFact,
};

fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/preservation-live-scope.json"
    ))
    .unwrap()
}

fn facts() -> BTreeMap<String, PathFact> {
    [
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
    .collect()
}

fn file(text: &Value) -> PathFact {
    PathFact::File {
        text: text.as_str().unwrap().into(),
    }
}

#[test]
fn shared_factual_snapshots_and_unsupported_paths_match() {
    let corpus = corpus();
    for case in corpus["snapshots"].as_array().unwrap() {
        let mut sources = facts();
        sources.insert(case["path"].as_str().unwrap().into(), file(&case["text"]));
        let snapshot = json!(snapshot_memory_preservation(&sources, true).unwrap());
        assert_eq!(
            snapshot["files"]
                .as_array()
                .unwrap()
                .iter()
                .find(|f| f["path"] == case["path"])
                .unwrap(),
            &case["expected"],
            "{}",
            case["name"]
        );
    }
    for path in corpus["invalidPaths"].as_array().unwrap() {
        let mut sources = facts();
        sources.insert(
            path.as_str().unwrap().into(),
            PathFact::File {
                text: String::new(),
            },
        );
        assert_eq!(
            snapshot_memory_preservation(&sources, true).unwrap_err()[0].code,
            "KIT_PRESERVATION_PATH_INVALID",
            "{path}"
        );
    }
}

#[test]
fn shared_factual_losses_cannot_be_rescued_by_history_or_archiving_open_items() {
    for case in corpus()["losses"].as_array().unwrap() {
        let path = case["path"].as_str().unwrap();
        let mut previous = facts();
        previous.insert(path.into(), file(&case["before"]));
        let mut current = facts();
        if !case["after"].is_null() {
            current.insert(path.into(), file(&case["after"]));
        }
        if !case["archive"].is_null() {
            current.insert("archive/2026-01/old.md".into(), file(&case["archive"]));
        }
        if !case["handoff"].is_null() {
            current.insert(
                "continuity/handoffs/legacy.md".into(),
                file(&case["handoff"]),
            );
        }
        let before = snapshot_memory_preservation(&previous, true).unwrap();
        let after = snapshot_memory_preservation(&current, true).unwrap();
        assert_eq!(
            json!(compare_memory_preservation(&before, &after)),
            case["expected"],
            "{}",
            case["name"]
        );
        assert_eq!(
            json!(compare_memory_archive_files(&before, &after).ineligible_removed_files),
            case["ineligibleRemovedFiles"],
            "{}",
            case["name"]
        );
    }
}

#[test]
fn shared_factual_fragment_reasons_and_owner_links_match() {
    for case in corpus()["fragments"].as_array().unwrap() {
        let path = case["path"].as_str().unwrap();
        let target = case["target"].as_str().unwrap();
        let mut previous = facts();
        previous.insert(path.into(), file(&case["before"]));
        let mut current = facts();
        current.insert(path.into(), file(&case["after"]));
        current.insert(target.into(), file(&case["archive"]));
        let before = snapshot_memory_preservation(&previous, true).unwrap();
        let after = snapshot_memory_preservation(&current, true).unwrap();
        let report = json!(check_memory_archive_links(
            &before,
            &after,
            &previous,
            &current,
            1793491200000,
            30
        )
        .unwrap());
        let fragments = report["fragments"]["fragments"].as_array().unwrap();
        let keys: Vec<_> = fragments
            .iter()
            .map(|f| format!("{}#L{}", f["source"].as_str().unwrap(), f["line"]))
            .collect();
        assert_eq!(json!(keys), case["expectedKeys"], "{}", case["name"]);
        assert_eq!(
            report["fragments"]["missingFragments"], case["expectedMissing"],
            "{}",
            case["name"]
        );
        assert_eq!(
            report["linkedFragments"], case["expectedKeys"],
            "{}",
            case["name"]
        );
        assert_eq!(report["missingFragments"], json!([]), "{}", case["name"]);
        if !fragments.is_empty() {
            assert_eq!(
                fragments[0],
                json!({"source":path,"line":2,"target":target,
                "bytes":case["bytes"],"sha256":case["sha256"]})
            );
        } else {
            assert_eq!(report["fragments"]["unattributedArchives"], json!([target]));
        }
    }
}

#[test]
fn shared_factual_fragment_and_size_log_records_are_recomputed() {
    for case in corpus()["fragments"].as_array().unwrap() {
        let path = case["path"].as_str().unwrap();
        let mut previous = facts();
        previous.insert(path.into(), file(&case["before"]));
        let mut current = facts();
        current.insert(path.into(), file(&case["after"]));
        current.insert(
            case["target"].as_str().unwrap().into(),
            file(&case["archive"]),
        );
        current.insert("archive/LOG.md".into(), file(&case["log"]));
        let before = snapshot_memory_preservation(&previous, true).unwrap();
        let after = snapshot_memory_preservation(&current, true).unwrap();
        let report = json!(check_memory_archive_log_with_sources(
            &before,
            &after,
            &previous,
            &current,
            1793491200000,
            30
        )
        .unwrap());
        assert_eq!(report["log"], case["expectedLog"], "{}", case["name"]);
        assert_eq!(
            report["loggedFragments"], case["expectedKeys"],
            "{}",
            case["name"]
        );
        assert_eq!(
            report["fragments"]["missingFragments"], case["expectedMissing"],
            "{}",
            case["name"]
        );
    }
}
