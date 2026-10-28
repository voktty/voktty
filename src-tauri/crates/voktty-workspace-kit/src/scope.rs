use crate::document::parse_document;
use crate::validation::{validate_structure, Contract};
use crate::{Issue, KitResult};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryScope {
    pub schema: u8,
    pub state: String,
    pub root_key: Option<String>,
    pub ancestor_kits: Vec<String>,
    pub descendant_kits: Vec<String>,
    pub blocked_keys: Vec<String>,
    pub ancestry_complete: bool,
    pub descendants_complete: Option<bool>,
    pub initialization: &'static str,
}

fn state(node: &Value) -> &str {
    node["state"].as_str().unwrap_or_default()
}
fn key(node: &Value) -> String {
    node["directoryKey"].as_str().unwrap_or_default().to_owned()
}

pub fn resolve_memory_scope(text: &str) -> KitResult<MemoryScope> {
    let facts = parse_document(text)?;
    validate_structure(&facts, Contract::MemoryScope)?;
    let nodes = facts["ancestors"].as_array().expect("validated ancestors");
    let mut seen = BTreeSet::new();
    for (index, node) in nodes.iter().enumerate() {
        if !seen.insert(key(node))
            || node["parentKey"] == node["directoryKey"]
            || (index > 0 && nodes[index - 1]["parentKey"] != node["directoryKey"])
            || (index == nodes.len() - 1 && facts["stop"] == "root" && !node["parentKey"].is_null())
        {
            return Err(vec![Issue::new(
                "KIT_SCOPE_CHAIN_INVALID",
                vec!["ancestors".into(), index.into()],
            )]);
        }
    }
    let last = &nodes[nodes.len() - 1];
    if last["parentKey"]
        .as_str()
        .is_some_and(|parent| seen.contains(parent))
    {
        return Err(vec![Issue::new(
            "KIT_SCOPE_CHAIN_INVALID",
            vec!["ancestors".into(), (nodes.len() - 1).into()],
        )]);
    }
    let scan = facts.get("descendants").filter(|scan| !scan.is_null());
    if scan.is_some() && facts["purpose"] == "discover" {
        return Err(vec![Issue::new(
            "KIT_SCOPE_SCAN_UNEXPECTED",
            vec!["descendants".into()],
        )]);
    }
    if scan.is_some_and(|scan| scan["rootKey"] != nodes[0]["directoryKey"]) {
        return Err(vec![Issue::new(
            "KIT_SCOPE_TARGET_MISMATCH",
            vec!["descendants".into(), "rootKey".into()],
        )]);
    }
    let empty = Vec::new();
    let findings = scan
        .and_then(|scan| scan["findings"].as_array())
        .unwrap_or(&empty);
    let mut finding_keys = BTreeSet::new();
    for (index, finding) in findings.iter().enumerate() {
        if seen.contains(&key(finding)) || !finding_keys.insert(key(finding)) {
            return Err(vec![Issue::new(
                "KIT_SCOPE_FINDING_INVALID",
                vec!["descendants".into(), "findings".into(), index.into()],
            )]);
        }
    }
    if scan.is_some_and(|scan| scan["entries"].as_f64().unwrap_or_default() < findings.len() as f64)
    {
        return Err(vec![Issue::new(
            "KIT_SCOPE_FINDING_INVALID",
            vec!["descendants".into(), "entries".into()],
        )]);
    }
    let ancestor_kits: Vec<_> = nodes
        .iter()
        .filter(|node| state(node) == "valid")
        .map(key)
        .collect();
    let descendant_kits: Vec<_> = findings
        .iter()
        .filter(|node| state(node) == "valid")
        .map(key)
        .collect();
    let bad: Vec<_> = nodes
        .iter()
        .filter(|node| !matches!(state(node), "absent" | "reserved" | "valid"))
        .collect();
    let blocked_keys = bad
        .iter()
        .map(|node| key(node))
        .chain(
            findings
                .iter()
                .filter(|node| state(node) != "valid")
                .map(key),
        )
        .collect();
    let ancestry_complete = facts["stop"] == "root"
        && facts["elapsedMs"].as_f64().unwrap_or_default() <= 5000.0
        && !nodes
            .iter()
            .any(|node| matches!(state(node), "denied" | "unavailable"));
    let descendants_complete = scan.map(|scan| {
        scan["stop"] == "complete"
            && scan["elapsedMs"].as_f64().unwrap_or_default() <= 10000.0
            && !findings
                .iter()
                .any(|node| matches!(state(node), "denied" | "unavailable" | "unverified_link"))
    });
    let mut result_state = if ancestor_kits.len() > 1 {
        "ambiguous"
    } else if let Some(node) = bad.first() {
        if state(node) == "unavailable" {
            "incomplete"
        } else {
            state(node)
        }
    } else if !ancestry_complete {
        "incomplete"
    } else if !ancestor_kits.is_empty() {
        "ready"
    } else if nodes.iter().any(|node| state(node) == "reserved") {
        "reserved"
    } else {
        "absent"
    };
    if !ancestor_kits.is_empty() && scan.is_some() {
        if !descendant_kits.is_empty() {
            result_state = "ambiguous";
        } else if result_state == "ready" {
            if findings
                .iter()
                .any(|node| matches!(state(node), "invalid" | "partial"))
            {
                result_state = "partial";
            } else if descendants_complete != Some(true) {
                result_state = "incomplete";
            }
        }
    }
    let initialization = if facts["purpose"] != "initialize" {
        "not_requested"
    } else if !matches!(result_state, "absent" | "reserved") {
        "blocked"
    } else if scan.is_none() {
        "not_checked"
    } else if descendants_complete != Some(true) || !findings.is_empty() {
        "blocked"
    } else {
        "clear"
    };
    Ok(MemoryScope {
        schema: 1,
        state: result_state.into(),
        root_key: ancestor_kits.first().cloned(),
        ancestor_kits,
        descendant_kits,
        blocked_keys,
        ancestry_complete,
        descendants_complete,
        initialization,
    })
}
