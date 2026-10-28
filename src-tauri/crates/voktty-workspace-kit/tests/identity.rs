use serde_json::{json, Value};
use voktty_workspace_kit::{evaluate_memory_use, memory_project_key, resolve_memory_scope};

#[test]
fn resolved_identity_cannot_transfer_a_session_grant_across_hosts() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/memory-identity.json"
    ))
    .unwrap();
    let local = memory_project_key(&corpus["baseline"].to_string()).unwrap();
    let mut input = corpus["baseline"].clone();
    input["kind"] = json!("ssh");
    let remote = memory_project_key(&input.to_string()).unwrap();
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/memory-use.json"
    ))
    .unwrap();
    let mut facts = corpus["baseline"].clone();
    facts["trust"]["projectKey"] = json!(local);
    facts["session"]["projectKey"] = json!(local);
    for (key, state, allowed) in [
        (&local, "valid", true),
        (&remote, "valid", false),
        (&local, "partial", false),
    ] {
        let scope = resolve_memory_scope(
            &json!({
                "schema":1,"purpose":"discover","stop":"root","elapsedMs":0,"descendants":null,
                "ancestors":[{"directoryKey":key,"parentKey":null,"state":state}]
            })
            .to_string(),
        )
        .unwrap();
        facts["projectKey"] = json!(scope.root_key.as_ref().unwrap_or(&local));
        facts["kitState"] = json!(scope.state);
        assert_eq!(
            evaluate_memory_use(&facts.to_string())
                .unwrap()
                .context_allowed,
            allowed
        );
    }
}

#[test]
fn every_shared_project_identity_matches() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/memory-identity.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["cases"].as_array().unwrap() {
        let mut input = corpus["baseline"].as_object().unwrap().clone();
        input.extend(case["changes"].as_object().unwrap().clone());
        let result = memory_project_key(&json!(input).to_string());
        if case["invalid"] == true {
            assert!(result.is_err(), "{}", case["name"]);
        } else {
            assert_eq!(
                result.unwrap(),
                case["expected"].as_str().unwrap(),
                "{}",
                case["name"]
            );
        }
    }
}

#[test]
fn identity_fields_and_documents_use_utf8_budgets() {
    assert_eq!(
        memory_project_key(&" ".repeat(16385)).unwrap_err()[0].code,
        "KIT_DOCUMENT_TOO_LARGE"
    );
    assert_eq!(
        memory_project_key(r#"{"extra":"\ud800"}"#).unwrap_err()[0].code,
        "KIT_DOCUMENT_INVALID_UNICODE"
    );
    let input = |count| {
        json!({"schema":1,"kind":"local","machineId":"fixture","filesystemId":"é".repeat(count),"canonicalRoot":"/work"}).to_string()
    };
    assert_eq!(
        memory_project_key(&input(2049)).unwrap_err()[0].code,
        "KIT_IDENTITY_FIELD_TOO_LARGE"
    );
    assert_eq!(memory_project_key(&input(2048)).unwrap().len(), 64);
}
