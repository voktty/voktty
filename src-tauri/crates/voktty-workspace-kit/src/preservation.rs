use crate::{inspect_memory_text, Issue, KitResult, PathFact};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[path = "plan_index.rs"]
mod plan_index;
pub use plan_index::{check_memory_plan_index, MemoryPlanIndexReport};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPreservationFile {
    pub path: String,
    pub kind: &'static str,
    pub sha256: String,
    pub bytes: usize,
    pub items: Vec<crate::ItemOccurrence>,
    pub plan_state: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MemoryPreservationSnapshot {
    schema: u8,
    files: Vec<MemoryPreservationFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPreservationComparison {
    pub missing_live_items: Vec<String>,
    pub missing_items: Vec<String>,
    pub missing_live_plans: Vec<String>,
}

fn invalid(code: &'static str) -> Vec<Issue> {
    vec![Issue::new(code, vec![])]
}

fn kind(path: &str) -> Option<&'static str> {
    if path.len() > 4096
        || path
            .chars()
            .any(|c| c.is_control() || matches!(c, '\\' | ':' | '%' | '?' | '#'))
    {
        return None;
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() > 64
        || parts
            .iter()
            .any(|part| part.is_empty() || matches!(*part, "." | ".."))
        || !path.ends_with(".md")
    {
        return None;
    }
    if matches!(
        path,
        "PROJECT.md"
            | "CONTEXT.md"
            | "plans/INDEX.md"
            | "plans/TRACKING.md"
            | "continuity/CHANGELOG.md"
    ) {
        return Some("live");
    }
    if path == "archive/LOG.md" {
        return Some("record");
    }
    if parts.len() == 2
        && matches!(parts[0], "plans" | "domains")
        && !matches!(parts[1], "README.md" | "_TEMPLATE.md")
    {
        return Some("live");
    }
    if parts.len() == 3
        && parts[0] == "continuity"
        && parts[1] == "handoffs"
        && parts[2] != "README.md"
    {
        return Some("history");
    }
    if parts.len() >= 3 && parts[0] == "archive" {
        let month = parts[1].as_bytes();
        if month.len() == 7
            && month[4] == b'-'
            && month[..4].iter().all(u8::is_ascii_digit)
            && month[5..].iter().all(u8::is_ascii_digit)
            && parts[1][..4] >= *"1970"
            && ("01"..="12").contains(&&parts[1][5..])
        {
            return Some("archive");
        }
    }
    None
}

/// The native reader must establish completeness and provide actual bounded bytes.
/// This value is a comparison baseline, never filesystem authority or a receipt.
pub fn snapshot_memory_preservation(
    documents: &BTreeMap<String, PathFact>,
    inventory_complete: bool,
) -> KitResult<MemoryPreservationSnapshot> {
    if !inventory_complete {
        return Err(invalid("KIT_PRESERVATION_INCOMPLETE"));
    }
    if documents.len() > 128 {
        return Err(invalid("KIT_PRESERVATION_FILE_LIMIT"));
    }
    for required in [
        "PROJECT.md",
        "CONTEXT.md",
        "plans/INDEX.md",
        "plans/TRACKING.md",
        "continuity/CHANGELOG.md",
        "archive/LOG.md",
    ] {
        if !documents.contains_key(required) {
            return Err(invalid("KIT_PRESERVATION_INCOMPLETE"));
        }
    }
    let mut files = Vec::new();
    let mut total = 0usize;
    let mut occurrences = 0usize;
    for (path, fact) in documents {
        let kind = kind(path).ok_or_else(|| invalid("KIT_PRESERVATION_PATH_INVALID"))?;
        let PathFact::File { text } = fact else {
            return Err(invalid("KIT_PRESERVATION_INCOMPLETE"));
        };
        total = total
            .checked_add(text.len())
            .filter(|n| *n <= 4 * 1024 * 1024)
            .ok_or_else(|| invalid("KIT_PRESERVATION_BYTE_LIMIT"))?;
        let plan = kind == "live"
            && path.starts_with("plans/")
            && !matches!(path.as_str(), "plans/INDEX.md" | "plans/TRACKING.md");
        let inspected = if plan {
            crate::memory::inspect_memory_plan_text(text)?
        } else {
            inspect_memory_text(text, "Up next")?
        };
        if !inspected.complete {
            return Err(invalid("KIT_PRESERVATION_TEXT_INCOMPLETE"));
        }
        occurrences += inspected.ids.len();
        if occurrences > 8192 || inspected.ids.iter().any(|item| item.id.len() > 64) {
            return Err(invalid("KIT_PRESERVATION_ITEM_LIMIT"));
        }
        files.push(MemoryPreservationFile {
            path: path.clone(),
            kind,
            sha256: hex::encode(Sha256::digest(text.as_bytes())),
            bytes: text.len(),
            items: inspected.ids,
            plan_state: plan.then_some(inspected.plan_state),
        });
    }
    Ok(MemoryPreservationSnapshot { schema: 1, files })
}

/// Checks syntactic item/plan preservation only, not index links, archive bytes or LOG.
pub fn compare_memory_preservation(
    before: &MemoryPreservationSnapshot,
    after: &MemoryPreservationSnapshot,
) -> MemoryPreservationComparison {
    let live: BTreeSet<_> = after
        .files
        .iter()
        .filter(|file| file.kind == "live")
        .flat_map(|file| file.items.iter().map(|item| item.id.as_str()))
        .collect();
    let all: BTreeSet<_> = after
        .files
        .iter()
        .filter(|file| matches!(file.kind, "live" | "archive"))
        .flat_map(|file| file.items.iter().map(|item| item.id.as_str()))
        .collect();
    let mut missing_live_items = BTreeSet::new();
    let mut missing_items = BTreeSet::new();
    let mut missing_live_plans = BTreeSet::new();
    for file in &before.files {
        if matches!(file.kind, "live" | "archive") {
            for item in &file.items {
                if file.kind == "live" && item.state == "open" && !live.contains(item.id.as_str()) {
                    missing_live_items.insert(item.id.clone());
                }
                if !all.contains(item.id.as_str()) {
                    missing_items.insert(item.id.clone());
                }
            }
        }
        if file
            .plan_state
            .as_deref()
            .is_some_and(|state| state != "closed")
            && !after
                .files
                .iter()
                .any(|current| current.path == file.path && current.kind == "live")
        {
            missing_live_plans.insert(file.path.clone());
        }
    }
    MemoryPreservationComparison {
        missing_live_items: missing_live_items.into_iter().collect(),
        missing_items: missing_items.into_iter().collect(),
        missing_live_plans: missing_live_plans.into_iter().collect(),
    }
}
