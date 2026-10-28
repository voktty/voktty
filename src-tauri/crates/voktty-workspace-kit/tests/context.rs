use serde_json::{json, Value};
use voktty_workspace_kit::{build_memory_context, instruction_fingerprint, memory_project_key};

fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/memory-context.json"
    ))
    .unwrap()
}
fn change(input: &mut Value, entry: &Value) {
    let path = entry["path"].as_array().unwrap();
    let mut parent = input;
    for key in &path[..path.len() - 1] {
        parent = if let Some(key) = key.as_str() {
            &mut parent[key]
        } else {
            &mut parent[key.as_u64().unwrap() as usize]
        };
    }
    let key = &path[path.len() - 1];
    if entry["remove"] == true {
        if let Some(key) = key.as_str() {
            parent.as_object_mut().unwrap().remove(key);
        } else {
            parent
                .as_array_mut()
                .unwrap()
                .remove(key.as_u64().unwrap() as usize);
        }
    } else {
        let value = if entry.get("repeat").is_some() {
            json!(format!(
                "{}{}",
                entry["prefix"].as_str().unwrap_or_default(),
                entry["repeat"]["text"]
                    .as_str()
                    .unwrap()
                    .repeat(entry["repeat"]["count"].as_u64().unwrap() as usize)
            ))
        } else {
            entry["value"].clone()
        };
        if let Some(key) = key.as_str() {
            parent[key] = value;
        } else {
            parent[key.as_u64().unwrap() as usize] = value;
        }
    }
}

#[test]
fn every_shared_instruction_fingerprint_matches() {
    let corpus = corpus();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["fingerprintCases"].as_array().unwrap() {
        let mut input = corpus["baseline"]["instructions"].clone();
        for entry in case["changes"].as_array().unwrap() {
            change(&mut input, entry);
        }
        let result = instruction_fingerprint(&input.to_string());
        if case["invalid"] == true || case.get("error").is_some() {
            let errors = result.unwrap_err();
            if let Some(code) = case.get("error") {
                assert_eq!(errors[0].code, code.as_str().unwrap(), "{}", case["name"]);
            }
        } else {
            let result = result.unwrap();
            assert_eq!(
                result.digest,
                case["digest"].as_str().unwrap(),
                "{}",
                case["name"]
            );
            if case["changes"].as_array().unwrap().is_empty() {
                assert_eq!(json!(result), corpus["fingerprint"]);
            }
        }
    }
}

#[test]
fn every_shared_context_packet_matches() {
    let corpus = corpus();
    for case in corpus["packetCases"].as_array().unwrap() {
        let mut input = corpus["baseline"].clone();
        for entry in case["changes"].as_array().unwrap() {
            change(&mut input, entry);
        }
        if let Some(digest) = case.get("acceptedDigest") {
            input["use"]["instructionDigest"] = digest.clone();
            input["use"]["trust"]["instructionDigest"] = digest.clone();
        }
        let result = build_memory_context(&input.to_string());
        if case["invalid"] == true || case.get("error").is_some() {
            let errors = result.unwrap_err();
            if let Some(code) = case.get("error") {
                assert_eq!(errors[0].code, code.as_str().unwrap(), "{}", case["name"]);
            }
        } else {
            let result = result.unwrap();
            assert_eq!(json!(result.decision), case["decision"], "{}", case["name"]);
            if case.get("packet").is_none() {
                assert!(result.packet.is_none());
                continue;
            }
            let packet = result.packet.unwrap();
            let mut value = json!(packet);
            let text = value.as_object_mut().unwrap().remove("text").unwrap();
            assert_eq!(value, case["packet"], "{}", case["name"]);
            assert_eq!(packet.bytes, packet.text.len());
            assert!(packet.bytes <= 24576);
            if let Some(expected) = case.get("text") {
                assert_eq!(&text, expected);
            }
            let body: Value =
                serde_json::from_str(&packet.text[packet.text.find("\n{").unwrap() + 1..]).unwrap();
            assert_eq!(
                json!(body["sections"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|section| section["mode"].clone())
                    .collect::<Vec<_>>()),
                case["modes"]
            );
        }
    }
}

#[test]
fn packet_accounts_for_extreme_metadata_at_the_exact_ceiling() {
    let mut input = corpus()["baseline"].clone();
    input["identity"]["canonicalRoot"] = json!(format!("/{}", "\"".repeat(4095)));
    let key = memory_project_key(&input["identity"].to_string()).unwrap();
    input["use"]["projectKey"] = json!(key);
    input["use"]["trust"]["projectKey"] = json!(key);
    input["use"]["session"]["projectKey"] = json!(key);
    input["config"]["project"] = json!("\"".repeat(512));
    input["config"]["values"]["project_name"] = input["config"]["project"].clone();
    input["instructions"]["files"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|entry| entry["path"] == ".voktty/INIT.md")
        .unwrap()["fact"] = json!({"kind":"file","text":"i".repeat(12000)});
    input["project"]["text"] = json!("p".repeat(10000));
    input["context"]["text"] = json!("c".repeat(10000));
    let accepted = instruction_fingerprint(&input["instructions"].to_string()).unwrap();
    input["use"]["instructionDigest"] = json!(accepted.digest);
    input["use"]["trust"]["instructionDigest"] = json!(accepted.digest);
    let packet = build_memory_context(&input.to_string())
        .unwrap()
        .packet
        .unwrap();
    assert_eq!(packet.bytes, 24576);
    assert_eq!(packet.text.len(), 24576);
}

#[test]
fn context_document_limits_scalar_validation_and_node_guard_are_distinct() {
    assert_eq!(
        instruction_fingerprint(&" ".repeat(2 * 1024 * 1024 + 1)).unwrap_err()[0].code,
        "KIT_DOCUMENT_TOO_LARGE"
    );
    assert_eq!(
        build_memory_context(&" ".repeat(4 * 1024 * 1024 + 1)).unwrap_err()[0].code,
        "KIT_DOCUMENT_TOO_LARGE"
    );
    assert_eq!(
        instruction_fingerprint(r#"{"extra":"\ud800"}"#).unwrap_err()[0].code,
        "KIT_DOCUMENT_INVALID_UNICODE"
    );
    assert_eq!(
        instruction_fingerprint(&json!({"extra":vec![0;16384]}).to_string()).unwrap_err()[0].code,
        "KIT_DOCUMENT_NODE_LIMIT"
    );
}
