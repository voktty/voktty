use serde_json::{json, Value};
use voktty_workspace_kit::resolve_memory_scope;

fn change(input: &mut Value, path: &[Value], value: Value) {
    let mut parent = input;
    for component in &path[..path.len() - 1] {
        parent = if let Some(key) = component.as_str() {
            &mut parent[key]
        } else {
            &mut parent[component.as_u64().unwrap() as usize]
        };
    }
    let last = &path[path.len() - 1];
    if let Some(key) = last.as_str() {
        parent[key] = value;
    } else {
        parent[last.as_u64().unwrap() as usize] = value;
    }
}

#[test]
fn every_shared_scope_resolution_matches() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/memory-scope.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["cases"].as_array().unwrap() {
        let mut input = corpus["baseline"].clone();
        for entry in case["changes"].as_array().unwrap() {
            change(
                &mut input,
                entry["path"].as_array().unwrap(),
                entry["value"].clone(),
            );
        }
        let result = resolve_memory_scope(&input.to_string());
        if case["invalid"] == true || case.get("error").is_some() {
            let errors = result.unwrap_err();
            if let Some(code) = case.get("error") {
                assert_eq!(errors[0].code, code.as_str().unwrap(), "{}", case["name"]);
            }
        } else {
            let mut expected = corpus["expected"].as_object().unwrap().clone();
            expected.extend(case["expected"].as_object().unwrap().clone());
            assert_eq!(json!(result.unwrap()), json!(expected), "{}", case["name"]);
        }
    }
}

#[test]
fn scope_chain_and_document_limits_are_explicit() {
    let ancestors: Vec<_> = (0..128).map(|index| json!({
        "directoryKey":format!("{index:064x}"),
        "parentKey":if index == 127 { Value::Null } else { json!(format!("{:064x}", index + 1)) },
        "state":"absent"
    })).collect();
    let mut input = json!({"schema":1,"purpose":"discover","ancestors":ancestors,"stop":"root","elapsedMs":0,"descendants":null});
    assert!(
        resolve_memory_scope(&input.to_string())
            .unwrap()
            .ancestry_complete
    );
    input["stop"] = json!("depth");
    assert_eq!(
        resolve_memory_scope(&input.to_string()).unwrap().state,
        "incomplete"
    );
    input["ancestors"]
        .as_array_mut()
        .unwrap()
        .push(json!({"directoryKey":"invalid"}));
    assert!(resolve_memory_scope(&input.to_string()).is_err());
    assert_eq!(
        resolve_memory_scope(&" ".repeat(262145)).unwrap_err()[0].code,
        "KIT_DOCUMENT_TOO_LARGE"
    );
    assert_eq!(
        resolve_memory_scope(r#"{"extra":"\ud800"}"#).unwrap_err()[0].code,
        "KIT_DOCUMENT_INVALID_UNICODE"
    );
}
