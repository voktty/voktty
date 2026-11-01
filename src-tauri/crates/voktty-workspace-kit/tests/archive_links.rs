use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{check_memory_archive_links, snapshot_memory_preservation, PathFact};

fn documents(input: &Value) -> BTreeMap<String, PathFact> {
    let mut result: BTreeMap<_, _> = [
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
        result.insert(
            path.clone(),
            PathFact::File {
                text: text.as_str().unwrap().into(),
            },
        );
    }
    result
}

#[test]
fn shared_source_bound_archive_links_match() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/archive-links.json"
    ))
    .unwrap();
    for test in corpus["cases"].as_array().unwrap() {
        let previous = documents(&test["before"]);
        let current = documents(&test["after"]);
        let before = snapshot_memory_preservation(&previous, true).unwrap();
        let after = snapshot_memory_preservation(&current, true).unwrap();
        let mut report = json!(check_memory_archive_links(
            &before,
            &after,
            &previous,
            &current,
            corpus["nowMs"].as_u64().unwrap(),
            30
        )
        .unwrap());
        let fragments = report.as_object_mut().unwrap().remove("fragments").unwrap();
        assert_eq!(report, test["expected"], "{}", test["name"]);
        assert_eq!(
            fragments["fragments"].as_array().unwrap().len() as u64,
            test["fragmentCount"].as_u64().unwrap(),
            "{}",
            test["name"]
        );
        for (key, value) in fragments.as_object().unwrap() {
            if key != "fragments" {
                assert_eq!(value, &json!([]), "{}: {key}", test["name"]);
            }
        }
    }
}

#[test]
fn changed_navigation_bytes_cannot_credit_a_snapshot() {
    let mut previous = documents(&json!({"PROJECT.md": "Old"}));
    let current = documents(&json!({}));
    let before = snapshot_memory_preservation(&previous, true).unwrap();
    let after = snapshot_memory_preservation(&current, true).unwrap();
    previous.insert(
        "PROJECT.md".into(),
        PathFact::File {
            text: "Forged".into(),
        },
    );
    assert_eq!(
        check_memory_archive_links(&before, &after, &previous, &current, 2000000000000, 30)
            .unwrap_err()[0]
            .code,
        "KIT_ARCHIVE_FRAGMENT_SOURCE_CHANGED"
    );
}
