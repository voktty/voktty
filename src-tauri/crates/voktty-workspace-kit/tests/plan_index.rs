use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{check_memory_plan_index, snapshot_memory_preservation, PathFact};

fn documents(text: &str, plans: &Value) -> BTreeMap<String, PathFact> {
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
    files.insert(
        "plans/INDEX.md".into(),
        PathFact::File { text: text.into() },
    );
    for (path, state) in plans.as_object().unwrap() {
        files.insert(
            path.clone(),
            PathFact::File {
                text: format!("State: {}\n", state.as_str().unwrap()),
            },
        );
    }
    files
}

#[test]
fn shared_plan_index_reports_qualify_actual_local_links() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/plan-index.json"
    ))
    .unwrap();
    for case in corpus["cases"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let snapshot =
            snapshot_memory_preservation(&documents(text, &case["plans"]), true).unwrap();
        assert_eq!(
            json!(check_memory_plan_index(&snapshot, text).unwrap()),
            case["expected"],
            "{}",
            case["name"]
        );
    }
}

#[test]
fn changed_index_and_exhausted_link_budgets_cannot_return_a_complete_report() {
    let snapshot = snapshot_memory_preservation(&documents("", &json!({})), true).unwrap();
    assert_eq!(
        check_memory_plan_index(&snapshot, "[Topic](topic.md)").unwrap_err()[0].code,
        "KIT_PLAN_INDEX_CHANGED"
    );
    assert_eq!(
        check_memory_plan_index(&snapshot, &"a".repeat(262145)).unwrap_err()[0].code,
        "KIT_MEMORY_TEXT_TOO_LARGE"
    );
    for text in [
        "[Topic](topic.md)\n".repeat(1025),
        "[Topic][ref]\n".repeat(1025),
        "    [Topic](topic.md)\n".repeat(1025),
    ] {
        let snapshot = snapshot_memory_preservation(&documents(&text, &json!({})), true).unwrap();
        assert_eq!(
            check_memory_plan_index(&snapshot, &text).unwrap_err()[0].code,
            "KIT_PLAN_INDEX_LIMIT"
        );
    }
    for text in [
        format!("[P]({}.md)", "x".repeat(4097)),
        format!("[P]({}topic.md{})", "(".repeat(16), ")".repeat(16)),
    ] {
        let snapshot = snapshot_memory_preservation(&documents(&text, &json!({})), true).unwrap();
        let result = check_memory_plan_index(&snapshot, &text).unwrap();
        assert!(!result.complete);
        assert_eq!(result.unverified_lines, vec![1]);
    }
    let text = format!("{}[Topic](topic.md)", "\\".repeat(100000));
    let snapshot =
        snapshot_memory_preservation(&documents(&text, &json!({"plans/topic.md":"open"})), true)
            .unwrap();
    assert_eq!(
        check_memory_plan_index(&snapshot, &text)
            .unwrap()
            .linked_plans,
        vec!["plans/topic.md"]
    );
    let text = format!("[P]({})", "\\".repeat(100000));
    let snapshot = snapshot_memory_preservation(&documents(&text, &json!({})), true).unwrap();
    assert!(!check_memory_plan_index(&snapshot, &text).unwrap().complete);
}
