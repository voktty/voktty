use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryArchiveLogReport {
    pub logged_moves: Vec<String>,
    pub missing_moves: Vec<String>,
    pub missing_sizes: Vec<String>,
    pub invalid_lines: Vec<usize>,
    pub unmatched_lines: Vec<usize>,
    pub duplicate_lines: Vec<usize>,
    pub complete: bool,
}

fn log_matches(snapshot: &MemoryPreservationSnapshot, text: &str) -> bool {
    snapshot.files.iter().any(|file| {
        file.path == "archive/LOG.md"
            && file.bytes == text.len()
            && file.sha256 == hex::encode(Sha256::digest(text.as_bytes()))
    })
}

fn size(raw: &str) -> Option<Option<usize>> {
    if raw == "-" {
        return Some(None);
    }
    if raw.is_empty()
        || (raw.len() > 1 && raw.starts_with('0'))
        || !raw.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    raw.parse::<usize>()
        .ok()
        .filter(|n| *n <= 256 * 1024)
        .map(Some)
}

fn metadata(date: &str, agent: &str) -> bool {
    date.len() == 10
        && crate::handoff_created_at_ms(&format!("{date}-0000-log.md")).is_some()
        && !agent.is_empty()
        && agent.len() <= 64
        && agent.as_bytes()[0].is_ascii_alphanumeric()
        && agent
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// Checks the appended raw TSV channel, not Markdown rendering or compaction approval.
pub fn check_memory_archive_log(
    before: &MemoryPreservationSnapshot,
    after: &MemoryPreservationSnapshot,
    before_log: &str,
    after_log: &str,
) -> KitResult<MemoryArchiveLogReport> {
    if before_log.len() > 256 * 1024 || after_log.len() > 256 * 1024 {
        return Err(invalid("KIT_ARCHIVE_LOG_LIMIT"));
    }
    if !log_matches(before, before_log) || !log_matches(after, after_log) {
        return Err(invalid("KIT_ARCHIVE_LOG_CHANGED"));
    }
    let Some(suffix) = after_log.strip_prefix(before_log) else {
        return Err(invalid("KIT_ARCHIVE_LOG_NOT_APPEND_ONLY"));
    };
    if !before_log.is_empty()
        && !before_log.ends_with('\n')
        && !suffix.is_empty()
        && !suffix.starts_with('\n')
        && !suffix.starts_with("\r\n")
    {
        return Err(invalid("KIT_ARCHIVE_LOG_NOT_APPEND_ONLY"));
    }
    let archive = compare_memory_archive_files(before, after);
    let changed = before.files.iter().any(|old| {
        old.kind != "record"
            && !after.files.iter().any(|now| {
                now.path == old.path && now.sha256 == old.sha256 && now.bytes == old.bytes
            })
    }) || after
        .files
        .iter()
        .any(|now| now.kind != "record" && !before.files.iter().any(|old| old.path == now.path));
    let moves: BTreeMap<_, _> = archive
        .moves
        .iter()
        .map(|m| (m.source.as_str(), m))
        .collect();
    let mut sizes = BTreeMap::<&str, (Option<usize>, Option<usize>)>::new();
    for file in &before.files {
        if file.kind == "live" {
            sizes.entry(&file.path).or_default().0 = Some(file.bytes);
        }
    }
    for file in &after.files {
        if file.kind == "live" {
            sizes.entry(&file.path).or_default().1 = Some(file.bytes);
        }
    }
    let mut report = MemoryArchiveLogReport {
        logged_moves: vec![],
        missing_moves: vec![],
        missing_sizes: vec![],
        invalid_lines: vec![],
        unmatched_lines: vec![],
        duplicate_lines: vec![],
        complete: true,
    };
    let mut seen_moves = BTreeSet::new();
    let mut seen_sizes = BTreeSet::new();
    let mut offset = 0;
    let mut records = 0;
    for (index, raw) in after_log.split('\n').enumerate() {
        let appended = offset >= before_log.len();
        offset += raw.len() + 1;
        if !appended || !raw.contains("VOKTTY-") {
            continue;
        }
        records += 1;
        if records > 1024 {
            return Err(invalid("KIT_ARCHIVE_LOG_LIMIT"));
        }
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if line.len() > 16 * 1024 || line.contains('\r') {
            report.invalid_lines.push(index + 1);
            continue;
        }
        let fields: Vec<_> = line.split('\t').collect();
        if fields.len() < 3 || !metadata(fields[1], fields[2]) {
            report.invalid_lines.push(index + 1);
            continue;
        }
        match fields[0] {
            "VOKTTY-MOVE-1" if fields.len() == 7 => {
                let bytes = size(fields[5]).flatten();
                if fields[3].len() > 4096
                    || fields[4].len() > 4096
                    || bytes.is_none()
                    || fields[6].len() != 64
                    || !fields[6]
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                {
                    report.invalid_lines.push(index + 1);
                } else if !seen_moves.insert(fields[3]) {
                    report.duplicate_lines.push(index + 1);
                } else if !moves.get(fields[3]).is_some_and(|m| {
                    m.target == fields[4] && Some(m.bytes) == bytes && m.sha256 == fields[6]
                }) {
                    report.unmatched_lines.push(index + 1);
                }
            }
            "VOKTTY-SIZE-1" if fields.len() == 6 => {
                let pair = match (size(fields[4]), size(fields[5])) {
                    (Some(previous), Some(current)) if fields[3].len() <= 4096 => {
                        (previous, current)
                    }
                    _ => {
                        report.invalid_lines.push(index + 1);
                        continue;
                    }
                };
                if !seen_sizes.insert(fields[3]) {
                    report.duplicate_lines.push(index + 1);
                } else if sizes.get(fields[3]) != Some(&pair) {
                    report.unmatched_lines.push(index + 1);
                }
            }
            _ => report.invalid_lines.push(index + 1),
        }
    }
    report.complete = report.invalid_lines.is_empty()
        && report.unmatched_lines.is_empty()
        && report.duplicate_lines.is_empty();
    if !report.complete {
        seen_moves.clear();
        seen_sizes.clear();
    }
    report.logged_moves = moves
        .keys()
        .filter(|path| seen_moves.contains(**path))
        .map(|s| (*s).into())
        .collect();
    report.missing_moves = moves
        .keys()
        .filter(|path| !seen_moves.contains(**path))
        .map(|s| (*s).into())
        .collect();
    if changed || records > 0 {
        report.missing_sizes = sizes
            .keys()
            .filter(|path| !seen_sizes.contains(**path))
            .map(|s| (*s).into())
            .collect();
    }
    Ok(report)
}
