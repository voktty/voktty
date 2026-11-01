use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_workspace_kit::{
    check_memory_preservation, memory_protected_paths, snapshot_memory_protected, PathFact,
};

fn facts(overrides: &Value) -> BTreeMap<String, PathFact> {
    let mut sources: BTreeMap<_, _> = [
        "PROJECT.md",
        "CONTEXT.md",
        "plans/INDEX.md",
        "plans/TRACKING.md",
        "continuity/CHANGELOG.md",
        "archive/LOG.md",
    ]
    .into_iter()
    .map(|p| {
        (
            p.into(),
            PathFact::File {
                text: String::new(),
            },
        )
    })
    .collect();
    for (path, text) in overrides.as_object().unwrap() {
        if text.is_null() {
            sources.remove(path);
        } else {
            sources.insert(
                path.clone(),
                PathFact::File {
                    text: text.as_str().unwrap().into(),
                },
            );
        }
    }
    sources
}
fn protected_facts(overrides: &Value) -> BTreeMap<String, PathFact> {
    let mut sources: BTreeMap<_, _> = memory_protected_paths()
        .into_iter()
        .map(|p| (p, PathFact::Absent))
        .collect();
    sources
        .extend(serde_json::from_value::<BTreeMap<String, PathFact>>(overrides.clone()).unwrap());
    sources
}

#[test]
fn shared_composition_preserves_every_expected_blocker_and_raw_report() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../templates/workspace-kit/conformance/check.json"
    ))
    .unwrap();
    for case in corpus["cases"].as_array().unwrap() {
        let old =
            snapshot_memory_protected(&protected_facts(&case["protectedBefore"]), true).unwrap();
        let new =
            snapshot_memory_protected(&protected_facts(&case["protectedAfter"]), true).unwrap();
        let result = check_memory_preservation(
            &facts(&case["before"]),
            &facts(&case["after"]),
            &old,
            &new,
            case["nowMs"].as_u64().unwrap(),
            case["afterDays"].as_u64().unwrap(),
        );
        if let Some(error) = case["error"].as_str() {
            assert_eq!(result.unwrap_err()[0].code, error, "{}", case["name"]);
            continue;
        }
        let report = json!(result.unwrap());
        let mut codes: Vec<_> = report["issues"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["code"].as_str().unwrap())
            .collect();
        codes.sort();
        assert_eq!(json!(codes), case["expectedCodes"], "{}", case["name"]);
        assert_eq!(
            report["qualifiedAppends"], case["expectedAppends"],
            "{}",
            case["name"]
        );
        for (path, expected) in case["raw"].as_object().unwrap() {
            let actual = path.split('.').fold(&report, |value, key| &value[key]);
            assert_eq!(actual, expected, "{} {path}", case["name"]);
        }
        for (code, expected) in case["subjects"].as_object().unwrap() {
            let issue = report["issues"]
                .as_array()
                .unwrap()
                .iter()
                .find(|i| i["code"] == *code)
                .unwrap();
            assert_eq!(&issue["subjects"], expected, "{} {code}", case["name"]);
        }
    }
}

#[test]
fn composition_bounds_combined_channel_resources() {
    let protected = snapshot_memory_protected(&protected_facts(&json!({})), true).unwrap();
    let mut before = facts(&json!({}));
    for n in 0..100 {
        before.insert(
            format!("domains/{n}.md"),
            PathFact::File {
                text: String::new(),
            },
        );
    }
    assert_eq!(
        check_memory_preservation(&before, &facts(&json!({})), &protected, &protected, 0, 30)
            .unwrap_err()[0]
            .code,
        "KIT_CHECK_LIMIT"
    );
}
