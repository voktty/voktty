use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{compare_memory_archive_files, snapshot_memory_preservation, PathFact};

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
fn shared_archive_file_evidence_requires_exact_new_unambiguous_targets() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/archive-files.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["cases"].as_array().unwrap() {
        let before = snapshot_memory_preservation(&documents(&case["before"]), true).unwrap();
        let after = snapshot_memory_preservation(&documents(&case["after"]), true).unwrap();
        assert_eq!(
            json!(compare_memory_archive_files(&before, &after)),
            case["expected"],
            "{}",
            case["name"]
        );
    }
}
