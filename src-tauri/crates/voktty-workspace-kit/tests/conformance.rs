use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use voktty_workspace_kit::{
    parse_agent_roster, parse_kit_config, render_template, resource, PathCase, RESOURCES,
};

fn change_document(data: &mut Value, change: &Value) {
    let path = change["path"].as_array().expect("Fixture change path");
    let mut parent = data;
    for segment in &path[..path.len() - 1] {
        parent = if let Some(index) = segment.as_u64() {
            &mut parent[index as usize]
        } else {
            &mut parent[segment.as_str().expect("Fixture property")]
        };
    }
    let last = &path[path.len() - 1];
    if let Some(key) = last.as_str() {
        let object = parent.as_object_mut().expect("Fixture object");
        if change["remove"] == true {
            object.remove(key);
        } else {
            object.insert(key.to_owned(), change["value"].clone());
        }
    } else {
        let index = last.as_u64().expect("Fixture array index") as usize;
        let items = parent.as_array_mut().expect("Fixture array");
        items.resize(items.len().max(index + 1), Value::Null);
        items[index] = if change["remove"] == true {
            Value::Null
        } else {
            change["value"].clone()
        };
    }
}

#[test]
fn runs_every_shared_validation_case() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/validation.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    let rendered = render_template(corpus["values"].as_object().unwrap())
        .expect("Rendered conformance baseline");
    for case in corpus["cases"].as_array().unwrap() {
        assert!(matches!(case["target"].as_str(), Some("kit" | "roster")));
        let target = if case["target"] == "kit" {
            ".voktty/kit.json"
        } else {
            ".voktty/team/agents.json"
        };
        let file = rendered.iter().find(|file| file.path == target).unwrap();
        let mut data: Value = serde_json::from_str(&file.text).unwrap();
        for change in case["changes"].as_array().unwrap() {
            change_document(&mut data, change);
        }
        let mut text = serde_json::to_string(&data).unwrap();
        if let Some(edit) = case.get("rawEdit") {
            let find = edit["find"].as_str().unwrap();
            assert_eq!(text.matches(find).count(), 1, "{}", case["name"]);
            text = text.replacen(find, edit["with"].as_str().unwrap(), 1);
        }
        let result = if case["target"] == "kit" {
            parse_kit_config(&text)
        } else {
            let path_case = if case["pathCase"] == "insensitive" {
                PathCase::Insensitive
            } else {
                PathCase::Sensitive
            };
            parse_agent_roster(&text, path_case)
        };
        assert_eq!(
            result.is_ok(),
            case["valid"] == true,
            "{}: {result:?}",
            case["name"]
        );
        if let Err(issues) = result {
            if let Some(expected) = case.get("issue") {
                assert!(
                    issues.iter().any(|issue| json!(issue.path) == *expected),
                    "{}: {issues:?}",
                    case["name"]
                );
            }
            if let Some(code) = case.get("customCode").and_then(Value::as_str) {
                assert!(
                    issues.iter().any(|issue| issue.code == code),
                    "{}: {issues:?}",
                    case["name"]
                );
            }
        }
    }
}

#[test]
fn embedded_inventory_matches_each_source_without_runtime_resolution() {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../templates/workspace-kit");
    let manifest: Value = serde_json::from_str(resource("manifest.json").unwrap()).unwrap();
    assert_eq!(
        RESOURCES.len(),
        manifest["files"].as_array().unwrap().len() + 2
    );
    for (source, text) in RESOURCES {
        assert_eq!(*text, std::fs::read_to_string(root.join(source)).unwrap());
    }
    for invalid in [
        "../secret",
        "/absolute",
        "remote://host/project/INIT.md",
        "conformance/validation.json",
    ] {
        assert!(resource(invalid).is_none());
    }
}

#[test]
fn unicode_limits_budgets_and_trim_are_explicit() {
    let inputs = json!({"project_name":"Fixture", "language":"en", "created_at":"2026-10-28"});
    let rendered = render_template(inputs.as_object().unwrap()).unwrap();
    let original = &rendered
        .iter()
        .find(|file| file.path.ends_with("team/agents.json"))
        .unwrap()
        .text;
    let mut roster: Value = serde_json::from_str(original).unwrap();
    roster["defaults"]["runtime"]["model"] = "\u{10400}".repeat(80).into();
    assert!(parse_agent_roster(&roster.to_string(), PathCase::Sensitive).is_ok());
    roster["defaults"]["runtime"]["model"] = "\u{10400}".repeat(129).into();
    assert!(parse_agent_roster(&roster.to_string(), PathCase::Sensitive).is_err());
    let oversized = format!("\"{}\"", "é".repeat(140000));
    assert_eq!(
        parse_kit_config(&oversized).unwrap_err()[0].code,
        "KIT_DOCUMENT_TOO_LARGE"
    );
    assert_eq!(
        parse_kit_config("{private-content").unwrap_err()[0].code,
        "KIT_DOCUMENT_INVALID_JSON"
    );
    let mut null = inputs.as_object().unwrap().clone();
    null.insert("language".into(), Value::Null);
    assert!(render_template(&null).is_err());
    null.insert("language".into(), "\u{feff}".into());
    assert!(render_template(&null).is_err());
}

#[test]
fn rendering_matches_shared_byte_hashes() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/rendering.json"
    ))
    .unwrap();
    let manifest: Value = serde_json::from_str(resource("manifest.json").unwrap()).unwrap();
    assert_eq!(manifest["version"], corpus["templateVersion"]);
    for case in corpus["cases"].as_array().unwrap() {
        let mut values: Map<String, Value> = corpus["values"].as_object().unwrap().clone();
        values.extend(case["values"].as_object().unwrap().clone());
        let result = render_template(&values);
        assert_eq!(
            result.is_ok(),
            case["valid"] == true,
            "{}: {result:?}",
            case["name"]
        );
        if let Ok(files) = result {
            let hashes: Vec<_> = files.iter().map(|file| json!({
                "path": file.path, "kind": file.kind, "sha256": hex::encode(Sha256::digest(file.text.as_bytes())),
            })).collect();
            assert_eq!(json!(hashes), case["files"], "{}", case["name"]);
        }
    }
}
