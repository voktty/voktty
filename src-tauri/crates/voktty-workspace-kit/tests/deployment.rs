use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{
    plan_deployment, render_template, DeploymentAction, PathFact, RenderedFile, RootLinks,
};

#[test]
fn helper_runtime_cannot_be_published_or_recorded_as_a_base() {
    for name in [
        "servers",
        "shell-integration",
        "proc",
        "Servers",
        "Shell-Integration",
        "Proc",
        "extensions",
        "Extensions",
        "history.json",
        "History.json",
        "trusted-roots.json",
        "Trusted-Roots.json",
    ] {
        let path = format!(".voktty/{name}/data.md");
        let files = [RenderedFile {
            path: path.clone(),
            kind: voktty_workspace_kit::FileKind::Base,
            text: "overwrite".into(),
        }];
        let facts = BTreeMap::from([(path.clone(), PathFact::Absent)]);
        assert_eq!(
            plan_deployment(&files, &facts, RootLinks::default()).unwrap_err()[0].code,
            "KIT_DEPLOYMENT_PATH_INVALID"
        );
        let lock =
            json!({"schema":1,"bases":[{"path":path,"version":"1.0.0","sha256":"a".repeat(64)}]});
        assert_eq!(
            voktty_workspace_kit::parse_kit_lock(&lock.to_string()).unwrap_err()[0].code,
            "KIT_LOCK_PATH_INVALID"
        );
    }
}

#[test]
fn every_shared_deployment_case_matches_complete_output() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/deployment.json"
    ))
    .unwrap();
    assert_eq!(corpus["schema"], 1);
    for case in corpus["cases"].as_array().unwrap() {
        let files: Vec<_> = case
            .get("files")
            .unwrap_or(&corpus["files"])
            .as_array()
            .unwrap()
            .iter()
            .map(|file| RenderedFile {
                path: file["path"].as_str().unwrap().into(),
                kind: serde_json::from_value(file["kind"].clone()).unwrap(),
                text: file["text"].as_str().unwrap().into(),
            })
            .collect();
        let facts: BTreeMap<String, PathFact> =
            serde_json::from_value(case["facts"].clone()).unwrap();
        let links = serde_json::from_value(case["rootLinks"].clone()).unwrap();
        let result = plan_deployment(&files, &facts, links);
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
fn rendered_template_preview_is_idempotent_and_preserves_private_facts() {
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
    facts.insert(
        ".voktty/tasks.json".into(),
        PathFact::File {
            text: "Private tasks".into(),
        },
    );
    let first = plan_deployment(&files, &facts, RootLinks::default()).unwrap();
    assert!(first.can_publish);
    assert_eq!(first.entries.len(), files.len() - 2);
    assert_eq!(first.entries.last().unwrap().path, ".voktty/kit.json");
    let ignore = &first
        .entries
        .iter()
        .find(|entry| entry.path == ".voktty/.gitignore")
        .unwrap()
        .proposed;
    assert!(ignore.starts_with("# Preserve privacy of existing and unknown .voktty data.\n*\n"));
    for reserved in [
        "sessions/",
        "state/",
        "mailbox/",
        "locks/",
        "tasks/",
        "tasks.json",
        "tools.json",
    ] {
        assert!(!ignore.contains(&format!("!/{reserved}\n")));
    }
    for entry in first.entries {
        facts.insert(
            entry.path,
            PathFact::File {
                text: entry.proposed,
            },
        );
    }
    let second = plan_deployment(&files, &facts, RootLinks::default()).unwrap();
    assert!(second.can_publish);
    assert!(second
        .entries
        .iter()
        .all(|entry| entry.action == DeploymentAction::Skip));
    assert!(
        matches!(&facts[".voktty/tasks.json"], PathFact::File { text } if text == "Private tasks")
    );
}
