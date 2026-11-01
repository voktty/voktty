use super::*;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPlanIndexReport {
    pub linked_plans: Vec<String>,
    pub missing_plans: Vec<String>,
    pub unavailable_plan_links: Vec<String>,
    pub unverified_lines: Vec<usize>,
    pub complete: bool,
}

/// Validates the qualified inline-link channel only; not a compaction verdict.
pub fn check_memory_plan_index(
    snapshot: &MemoryPreservationSnapshot,
    text: &str,
) -> KitResult<MemoryPlanIndexReport> {
    if text.len() > 256 * 1024 {
        return Err(invalid("KIT_MEMORY_TEXT_TOO_LARGE"));
    }
    let index = snapshot
        .files
        .iter()
        .find(|file| file.path == "plans/INDEX.md")
        .ok_or_else(|| invalid("KIT_PRESERVATION_INCOMPLETE"))?;
    if hex::encode(Sha256::digest(text.as_bytes())) != index.sha256 {
        return Err(invalid("KIT_PLAN_INDEX_CHANGED"));
    }
    let plans: BTreeSet<_> = snapshot
        .files
        .iter()
        .filter(|file| file.plan_state.is_some())
        .map(|file| file.path.as_str())
        .collect();
    let qualified = super::memory_links::qualified_memory_links(
        text,
        "plans/INDEX.md",
        "KIT_PLAN_INDEX_LIMIT",
    )?;
    let mut linked = BTreeSet::new();
    let mut unavailable = BTreeSet::new();
    for path in qualified.paths {
        if path.starts_with("plans/")
            && path.ends_with(".md")
            && !matches!(
                path.as_str(),
                "plans/INDEX.md" | "plans/TRACKING.md" | "plans/README.md" | "plans/_TEMPLATE.md"
            )
        {
            if plans.contains(path.as_str()) {
                linked.insert(path);
            } else {
                unavailable.insert(path);
            }
        }
    }
    let missing_plans = snapshot
        .files
        .iter()
        .filter(|file| {
            file.plan_state
                .as_deref()
                .is_some_and(|state| state != "closed")
                && !linked.contains(&file.path)
        })
        .map(|file| file.path.clone())
        .collect();
    Ok(MemoryPlanIndexReport {
        linked_plans: linked.into_iter().collect(),
        missing_plans,
        unavailable_plan_links: unavailable.into_iter().collect(),
        unverified_lines: qualified.unverified_lines,
        complete: qualified.complete,
    })
}
