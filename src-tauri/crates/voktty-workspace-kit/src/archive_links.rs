use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryArchiveLinkReport {
    pub linked_moves: Vec<String>,
    pub missing_moves: Vec<String>,
    pub linked_fragments: Vec<String>,
    pub missing_fragments: Vec<String>,
    pub unverified_documents: Vec<String>,
    pub missing_documents: Vec<String>,
    pub fragments: MemoryArchiveFragmentReport,
}

fn has_link(
    owner: &str,
    target: &str,
    sources: &BTreeMap<String, PathFact>,
    owners: &mut BTreeMap<String, BTreeSet<String>>,
    missing: &mut BTreeSet<String>,
    unverified: &mut BTreeSet<String>,
) -> KitResult<bool> {
    if !owners.contains_key(owner) {
        let mut paths = BTreeSet::new();
        match sources.get(owner) {
            Some(PathFact::File { text }) => {
                let links =
                    memory_links::qualified_memory_links(text, owner, "KIT_MEMORY_LINK_LIMIT")?;
                if links.complete {
                    paths.extend(links.paths);
                } else {
                    unverified.insert(owner.into());
                }
            }
            _ => {
                missing.insert(owner.into());
            }
        }
        owners.insert(owner.into(), paths);
    }
    Ok(owners[owner].contains(target))
}

/// Checks navigation using bound inventories, without authorizing compaction.
pub fn check_memory_archive_links(
    before: &MemoryPreservationSnapshot,
    after: &MemoryPreservationSnapshot,
    previous_sources: &BTreeMap<String, PathFact>,
    current_sources: &BTreeMap<String, PathFact>,
    now_ms: u64,
    after_days: u64,
) -> KitResult<MemoryArchiveLinkReport> {
    let fragments = check_memory_archive_fragments(
        before,
        after,
        previous_sources,
        current_sources,
        now_ms,
        after_days,
    )?;
    let bound_before = snapshot_memory_preservation(previous_sources, true)?;
    let bound_after = snapshot_memory_preservation(current_sources, true)?;
    let moves = compare_memory_archive_files(&bound_before, &bound_after).moves;
    let mut owners = BTreeMap::new();
    let mut missing = BTreeSet::new();
    let mut unverified = BTreeSet::new();
    let mut linked_moves = Vec::new();
    let mut missing_moves = Vec::new();
    for movement in moves {
        let owner = if movement.source.starts_with("plans/") {
            "plans/INDEX.md"
        } else {
            "plans/TRACKING.md"
        };
        if has_link(
            owner,
            &movement.target,
            current_sources,
            &mut owners,
            &mut missing,
            &mut unverified,
        )? {
            linked_moves.push(movement.source);
        } else {
            missing_moves.push(movement.source);
        }
    }
    let mut linked_fragments = Vec::new();
    let mut missing_fragments = Vec::new();
    for fragment in &fragments.fragments {
        let key = format!("{}#L{}", fragment.source, fragment.line);
        if has_link(
            &fragment.source,
            &fragment.target,
            current_sources,
            &mut owners,
            &mut missing,
            &mut unverified,
        )? {
            linked_fragments.push(key);
        } else {
            missing_fragments.push(key);
        }
    }
    linked_fragments.sort();
    missing_fragments.sort();
    Ok(MemoryArchiveLinkReport {
        linked_moves,
        missing_moves,
        linked_fragments,
        missing_fragments,
        unverified_documents: unverified.into_iter().collect(),
        missing_documents: missing.into_iter().collect(),
        fragments,
    })
}
