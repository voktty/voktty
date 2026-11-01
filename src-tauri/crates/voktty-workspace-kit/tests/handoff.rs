use serde_json::Value;
use voktty_workspace_kit::handoff_created_at_ms;

#[test]
fn shared_utc_handoff_dates_preserve_portability_and_reject_guesses() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/handoff-time.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["cases"].as_array().unwrap() {
        assert_eq!(
            handoff_created_at_ms(case["name"].as_str().unwrap()),
            case["expected"].as_u64(),
            "{}",
            case["name"]
        );
    }
}
