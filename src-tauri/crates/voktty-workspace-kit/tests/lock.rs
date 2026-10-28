use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use voktty_workspace_kit::{
    parse_kit_lock, prepare_deployment, render_template, FileKind, PathFact, RenderedFile,
    RootLinks,
};

#[test]
fn every_shared_lock_parser_case_matches() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/lock.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["parsing"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let result = parse_kit_lock(text);
        assert_eq!(
            result.is_ok(),
            case["valid"] == true,
            "{}: {result:?}",
            case["name"]
        );
        match result {
            Ok(lock) => {
                let mut expected: Value = serde_json::from_str(text).unwrap();
                expected["schema"] = 1.into();
                assert_eq!(json!(lock), expected);
            }
            Err(issues) => {
                if let Some(path) = case.get("issue") {
                    assert!(
                        issues.iter().any(|issue| json!(issue.path) == *path),
                        "{}: {issues:?}",
                        case["name"]
                    );
                }
                if let Some(code) = case.get("customCode") {
                    assert!(
                        issues
                            .iter()
                            .any(|issue| issue.code == code.as_str().unwrap()),
                        "{}: {issues:?}",
                        case["name"]
                    );
                }
            }
        }
    }
}

#[test]
fn every_shared_effective_lock_hash_matches() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/lock.json"
    ))
    .unwrap();
    let previews: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/deployment.json"
    ))
    .unwrap();
    let files: Vec<_> = previews["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| RenderedFile {
            path: file["path"].as_str().unwrap().into(),
            kind: serde_json::from_value(file["kind"].clone()).unwrap(),
            text: file["text"].as_str().unwrap().into(),
        })
        .collect();
    for case in corpus["preparation"].as_array().unwrap() {
        let preview = previews["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|preview| preview["name"] == case["previewCase"])
            .unwrap();
        let mut facts: BTreeMap<String, PathFact> =
            serde_json::from_value(preview["facts"].clone()).unwrap();
        facts.insert(
            ".voktty/kit.lock.json".into(),
            serde_json::from_value(case["lockFact"].clone()).unwrap(),
        );
        let links = serde_json::from_value(preview["rootLinks"].clone()).unwrap();
        let result =
            prepare_deployment(corpus["version"].as_str().unwrap(), &files, &facts, links).unwrap();
        assert_eq!(json!(result.lock), case["expectedLock"], "{}", case["name"]);
        assert_eq!(
            result.plan.can_publish,
            case["expectedCanPublish"] == true,
            "{}",
            case["name"]
        );
        let entry = result
            .plan
            .entries
            .iter()
            .find(|entry| entry.path == ".voktty/kit.lock.json");
        assert_eq!(json!(entry), case["expectedLockEntry"], "{}", case["name"]);
        let entries: Vec<_> = result
            .plan
            .entries
            .iter()
            .filter(|entry| entry.path != ".voktty/kit.lock.json")
            .collect();
        assert_eq!(
            json!(entries),
            preview["expected"]["entries"],
            "{}",
            case["name"]
        );
    }
}

#[test]
fn real_template_records_only_effective_bases_and_is_stable() {
    let values = json!({"project_name":"Fixture", "language":"en", "created_at":"2026-10-28"});
    let files = render_template(values.as_object().unwrap()).unwrap();
    let mut facts: BTreeMap<_, _> = files
        .iter()
        .map(|file| (file.path.clone(), PathFact::Absent))
        .collect();
    facts.insert(
        ".voktty/.gitignore".into(),
        PathFact::File { text: "*\n".into() },
    );
    facts.insert(".voktty/kit.lock.json".into(), PathFact::Absent);
    let first = prepare_deployment("1.1.0", &files, &facts, RootLinks::default()).unwrap();
    let lock = first.lock.unwrap();
    assert_eq!(
        lock.bases.len(),
        files
            .iter()
            .filter(|file| file.kind == FileKind::Base)
            .count()
    );
    for base in &lock.bases {
        let entry = first
            .plan
            .entries
            .iter()
            .find(|entry| entry.path == base.path)
            .unwrap();
        assert_eq!(
            base.sha256,
            hex::encode(Sha256::digest(entry.proposed.as_bytes()))
        );
    }
    for entry in first.plan.entries {
        facts.insert(
            entry.path,
            PathFact::File {
                text: entry.proposed,
            },
        );
    }
    let second = prepare_deployment("1.1.0", &files, &facts, RootLinks::default()).unwrap();
    assert_eq!(second.lock.unwrap(), lock);
}

#[test]
fn bounds_input_before_hashing_and_preserves_unicode_bytes() {
    assert_eq!(
        parse_kit_lock(&" ".repeat(65537)).unwrap_err()[0].code,
        "KIT_DOCUMENT_TOO_LARGE"
    );
    assert_eq!(
        prepare_deployment("1.1.0\n", &[], &BTreeMap::new(), RootLinks::default()).unwrap_err()[0]
            .code,
        "KIT_LOCK_INPUT_INVALID"
    );
    let mut files = vec![RenderedFile {
        path: ".voktty/CARD.md".into(),
        kind: FileKind::Base,
        text: "é 😀\r\n".into(),
    }];
    let facts = BTreeMap::from([
        (files[0].path.clone(), PathFact::Absent),
        (".voktty/kit.lock.json".into(), PathFact::Absent),
    ]);
    let result = prepare_deployment("1.1.0", &files, &facts, RootLinks::default()).unwrap();
    assert_eq!(
        result.lock.unwrap().bases[0].sha256,
        hex::encode(Sha256::digest("é 😀\r\n".as_bytes()))
    );
    files[0].text = "x".repeat(262145);
    assert_eq!(
        prepare_deployment("1.1.0", &files, &facts, RootLinks::default()).unwrap_err()[0].code,
        "KIT_LOCK_INPUT_INVALID"
    );
}

#[test]
fn requires_record_observation_and_bounds_aggregate_inputs() {
    assert_eq!(
        prepare_deployment("1.1.0", &[], &BTreeMap::new(), RootLinks::default()).unwrap_err()[0]
            .code,
        "KIT_DEPLOYMENT_OBSERVATION_MISSING"
    );
    let facts = BTreeMap::from([(
        ".voktty/kit.lock.json".into(),
        PathFact::File {
            text: " ".repeat(65537),
        },
    )]);
    assert_eq!(
        prepare_deployment("1.1.0", &[], &facts, RootLinks::default()).unwrap_err()[0].code,
        "KIT_LOCK_INPUT_INVALID"
    );
    let self_record = vec![RenderedFile {
        path: ".voktty/kit.lock.json".into(),
        kind: FileKind::Base,
        text: "a".into(),
    }];
    assert_eq!(
        prepare_deployment("1.1.0", &self_record, &facts, RootLinks::default()).unwrap_err()[0]
            .code,
        "KIT_LOCK_INPUT_INVALID"
    );
    let files: Vec<_> = (0..5)
        .map(|index| RenderedFile {
            path: format!(".voktty/a{index}"),
            kind: FileKind::Base,
            text: "a".repeat(256 * 1024),
        })
        .collect();
    assert_eq!(
        prepare_deployment("1.1.0", &files, &BTreeMap::new(), RootLinks::default()).unwrap_err()[0]
            .code,
        "KIT_LOCK_INPUT_INVALID"
    );
    let observed = files
        .iter()
        .map(|file| {
            (
                file.path.clone(),
                PathFact::File {
                    text: file.text.clone(),
                },
            )
        })
        .collect();
    let small: Vec<_> = files
        .iter()
        .map(|file| RenderedFile {
            text: "a".into(),
            ..file.clone()
        })
        .collect();
    assert_eq!(
        prepare_deployment("1.1.0", &small, &observed, RootLinks::default()).unwrap_err()[0].code,
        "KIT_LOCK_INPUT_INVALID"
    );
}

#[test]
fn unselected_root_observations_do_not_affect_preparation() {
    let files = vec![RenderedFile {
        path: "AGENTS.md".into(),
        kind: FileKind::Link,
        text: "Kit link\n".into(),
    }];
    let facts = BTreeMap::from([
        (
            "AGENTS.md".into(),
            PathFact::File {
                text: "a".repeat(300000),
            },
        ),
        (".voktty/kit.lock.json".into(), PathFact::Absent),
    ]);
    assert!(
        prepare_deployment("1.1.0", &files, &facts, RootLinks::default())
            .unwrap()
            .plan
            .can_publish
    );
    assert_eq!(
        prepare_deployment(
            "1.1.0",
            &files,
            &facts,
            RootLinks {
                agents: true,
                claude: false
            }
        )
        .unwrap_err()[0]
            .code,
        "KIT_LOCK_INPUT_INVALID"
    );
}
