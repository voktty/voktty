use serde_json::{json, Value};
use voktty_workspace_kit::evaluate_memory_use;

#[test]
fn every_shared_memory_use_decision_matches() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/memory-use.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["cases"].as_array().unwrap() {
        let mut input = corpus["baseline"].as_object().unwrap().clone();
        input.extend(case["changes"].as_object().unwrap().clone());
        let result = evaluate_memory_use(&json!(input).to_string());
        if case["invalid"] == true || case.get("error").is_some() {
            let errors = result.unwrap_err();
            if let Some(code) = case.get("error") {
                assert_eq!(errors[0].code, code.as_str().unwrap(), "{}", case["name"]);
            }
        } else {
            assert_eq!(
                json!(result.unwrap()),
                json!({
                    "schema": 1, "policy": case["policy"], "reason": case["reason"],
                    "contextAllowed": case["context"], "captureAllowed": case["capture"]
                }),
                "{}",
                case["name"]
            );
        }
    }
}

#[test]
fn policy_document_budget_and_unicode_are_bounded() {
    assert_eq!(
        evaluate_memory_use(&" ".repeat(16385)).unwrap_err()[0].code,
        "KIT_DOCUMENT_TOO_LARGE"
    );
    assert_eq!(
        evaluate_memory_use(r#"{"sessionId":"\ud800"}"#).unwrap_err()[0].code,
        "KIT_DOCUMENT_INVALID_UNICODE"
    );
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/memory-use.json"
    ))
    .unwrap();
    let input = corpus["baseline"].to_string();
    let padded = format!("{input}{}", " ".repeat(16384 - input.len()));
    assert!(evaluate_memory_use(&padded).unwrap().context_allowed);
    let mut unicode = corpus["baseline"].clone();
    unicode["extra"] = json!("é".repeat(8192));
    assert_eq!(
        evaluate_memory_use(&unicode.to_string()).unwrap_err()[0].code,
        "KIT_DOCUMENT_TOO_LARGE"
    );
}
