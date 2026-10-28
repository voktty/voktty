use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{
    inspect_memory_text, measure_memory, render_template, HandoffFile, HandoffInventory, PathFact,
};

fn config() -> Value {
    let values = json!({"project_name":"Fixture", "language":"en", "created_at":"2026-10-28"});
    let files = render_template(values.as_object().unwrap()).unwrap();
    serde_json::from_str(
        &files
            .iter()
            .find(|file| file.path == ".voktty/kit.json")
            .unwrap()
            .text,
    )
    .unwrap()
}

#[test]
fn every_shared_text_inspection_matches() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/memory.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["text"].as_array().unwrap() {
        let result = inspect_memory_text(
            case["text"].as_str().unwrap(),
            case["heading"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(json!(result), case["expected"], "{}", case["name"]);
    }
}

#[test]
fn every_shared_measurement_matches() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/memory.json"
    ))
    .unwrap();
    for case in corpus["measurement"].as_array().unwrap() {
        let mut config = config();
        config["limits"] = case["limits"].clone();
        let documents = serde_json::from_value(case["documents"].clone()).unwrap();
        let handoffs = serde_json::from_value(case["handoffs"].clone()).unwrap();
        let result = measure_memory(
            &config.to_string(),
            &documents,
            &handoffs,
            case["nowMs"].as_u64().unwrap(),
            case["heading"].as_str().unwrap(),
        );
        if let Some(code) = case.get("error") {
            assert_eq!(
                result.unwrap_err()[0].code,
                code.as_str().unwrap(),
                "{}",
                case["name"]
            );
        } else {
            assert_eq!(json!(result.unwrap()), case["expected"], "{}", case["name"]);
        }
    }
}

#[test]
fn text_inventory_budgets_and_integral_numbers_are_explicit() {
    assert_eq!(
        inspect_memory_text(&"a".repeat(262145), "Up next").unwrap_err()[0].code,
        "KIT_MEMORY_TEXT_TOO_LARGE"
    );
    assert_eq!(
        inspect_memory_text("\0", "Up next").unwrap_err()[0].code,
        "KIT_MEMORY_TEXT_INVALID"
    );
    let text = format!("## Up next\n{}", "- a\n".repeat(60000));
    assert_eq!(
        inspect_memory_text(&text, "Up next").unwrap().up_next,
        Some(60000)
    );
    let mut data = config();
    data["limits"] = json!({"continuity/handoffs/":{"maxFiles":1,"maxAgeDays":1}});
    let handoffs = HandoffInventory {
        complete: true,
        files: (0..20001)
            .map(|_| HandoffFile {
                name: "a.md".into(),
                created_at_ms: Some(0),
            })
            .collect(),
    };
    assert_eq!(
        measure_memory(&data.to_string(), &BTreeMap::new(), &handoffs, 0, "Up next").unwrap_err()
            [0]
        .code,
        "KIT_MEMORY_INVENTORY_TOO_LARGE"
    );
    data["limits"] = json!({"CONTEXT.md":{"maxChars":2}});
    let text = data
        .to_string()
        .replace("\"maxChars\":2", "\"maxChars\":2.0");
    let facts = BTreeMap::from([(
        "CONTEXT.md".into(),
        PathFact::File {
            text: "é😀".into()
        },
    )]);
    let empty = HandoffInventory {
        complete: true,
        files: vec![],
    };
    assert_eq!(
        measure_memory(&text, &facts, &empty, 0, "Up next")
            .unwrap()
            .measurements[0]
            .status,
        "ok"
    );
}
