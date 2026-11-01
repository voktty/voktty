use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryArchiveMove {
    pub source: String,
    pub target: String,
    pub sha256: String,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryArchiveFileReport {
    pub moves: Vec<MemoryArchiveMove>,
    pub missing_moved_files: Vec<String>,
    pub ambiguous_files: Vec<String>,
    pub ineligible_removed_files: Vec<String>,
    pub changed_handoffs: Vec<String>,
    pub missing_archives: Vec<String>,
    pub changed_archives: Vec<String>,
    pub unattributed_archives: Vec<String>,
}

fn same_bytes(left: &MemoryPreservationFile, right: &MemoryPreservationFile) -> bool {
    left.bytes == right.bytes && left.sha256 == right.sha256
}

fn whole_file_target(source: &str, target: &str) -> bool {
    let parts: Vec<_> = target.split('/').collect();
    parts.len() == 3 && parts[2] == source.rsplit('/').next().unwrap_or("")
}

/// Exact whole-file movement evidence only. Age, LOG and item-fragment checks remain separate.
pub fn compare_memory_archive_files(
    before: &MemoryPreservationSnapshot,
    after: &MemoryPreservationSnapshot,
) -> MemoryArchiveFileReport {
    let previous: BTreeMap<_, _> = before.files.iter().map(|f| (f.path.as_str(), f)).collect();
    let current: BTreeMap<_, _> = after.files.iter().map(|f| (f.path.as_str(), f)).collect();
    let new_archives: Vec<_> = after
        .files
        .iter()
        .filter(|f| f.kind == "archive" && !previous.contains_key(f.path.as_str()))
        .collect();
    let mut report = MemoryArchiveFileReport {
        moves: Vec::new(),
        missing_moved_files: Vec::new(),
        ambiguous_files: Vec::new(),
        ineligible_removed_files: Vec::new(),
        changed_handoffs: Vec::new(),
        missing_archives: Vec::new(),
        changed_archives: Vec::new(),
        unattributed_archives: Vec::new(),
    };
    let mut candidates = Vec::new();
    let mut owners = BTreeMap::<&str, usize>::new();
    for file in &before.files {
        if let Some(now) = current.get(file.path.as_str()) {
            if !same_bytes(file, now) {
                match file.kind {
                    "archive" => report.changed_archives.push(file.path.clone()),
                    "history" => report.changed_handoffs.push(file.path.clone()),
                    _ => {}
                }
            }
            continue;
        }
        if file.kind == "archive" {
            report.missing_archives.push(file.path.clone());
            continue;
        }
        let eligible = file.kind == "history"
            || (file.plan_state.as_deref() == Some("closed")
                && file.items.iter().all(|item| item.state != "open"));
        if !eligible {
            report.ineligible_removed_files.push(file.path.clone());
            continue;
        }
        let targets: Vec<_> = new_archives
            .iter()
            .copied()
            .filter(|target| {
                whole_file_target(&file.path, &target.path) && same_bytes(file, target)
            })
            .collect();
        for target in &targets {
            *owners.entry(&target.path).or_default() += 1;
        }
        candidates.push((file, targets));
    }
    let mut attributed = BTreeSet::new();
    for (source, targets) in candidates {
        if targets.is_empty() {
            report.missing_moved_files.push(source.path.clone());
        } else if targets.len() != 1 || owners[targets[0].path.as_str()] != 1 {
            report.ambiguous_files.push(source.path.clone());
        } else {
            let target = targets[0];
            attributed.insert(target.path.as_str());
            report.moves.push(MemoryArchiveMove {
                source: source.path.clone(),
                target: target.path.clone(),
                sha256: source.sha256.clone(),
                bytes: source.bytes,
            });
        }
    }
    report.unattributed_archives = new_archives
        .iter()
        .filter(|file| !attributed.contains(file.path.as_str()))
        .map(|file| file.path.clone())
        .collect();
    report
}
