use super::*;
use crate::{compare_memory_protected, MemoryProtectedComparison, MemoryProtectedSnapshot};

#[derive(Debug, Serialize)]
pub struct MemoryCheckIssue {
    pub code: &'static str,
    pub subjects: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCheckReport {
    schema: u8,
    pub now_ms: u64,
    pub after_days: u64,
    pub preservation: MemoryPreservationComparison,
    pub protected: MemoryProtectedComparison,
    pub index: MemoryPlanIndexReport,
    pub files: MemoryArchiveFileReport,
    pub time: MemoryArchiveTimeReport,
    pub log: MemoryArchiveFragmentLogReport,
    pub links: MemoryArchiveLinkReport,
    pub qualified_appends: Vec<String>,
    pub issues: Vec<MemoryCheckIssue>,
}

fn add(issues: &mut Vec<MemoryCheckIssue>, code: &'static str, subjects: Vec<String>) {
    if !subjects.is_empty() {
        issues.push(MemoryCheckIssue { code, subjects });
    }
}
fn lines(path: &str, lines: &[usize]) -> Vec<String> {
    lines.iter().map(|line| format!("{path}#L{line}")).collect()
}
fn bounded(
    snapshot: &MemoryPreservationSnapshot,
    protected: &MemoryProtectedSnapshot,
) -> KitResult<()> {
    let (files, bytes) = protected.size();
    if snapshot.files.len() + files > 128
        || snapshot.files.iter().map(|f| f.bytes).sum::<usize>() + bytes > 4 * 1024 * 1024
    {
        return Err(invalid("KIT_CHECK_LIMIT"));
    }
    Ok(())
}

/// Composes source-bound evidence only. Native ownership and writer coordination remain required.
pub fn check_memory_preservation(
    previous: &BTreeMap<String, PathFact>,
    current: &BTreeMap<String, PathFact>,
    previous_protected: &MemoryProtectedSnapshot,
    current_protected: &MemoryProtectedSnapshot,
    now_ms: u64,
    after_days: u64,
) -> KitResult<MemoryCheckReport> {
    let before = snapshot_memory_preservation(previous, true)?;
    let after = snapshot_memory_preservation(current, true)?;
    bounded(&before, previous_protected)?;
    bounded(&after, current_protected)?;
    let preservation = compare_memory_preservation(&before, &after);
    let protected = compare_memory_protected(previous_protected, current_protected);
    let PathFact::File { text: index_text } = &current["plans/INDEX.md"] else {
        return Err(invalid("KIT_PRESERVATION_INCOMPLETE"));
    };
    let index = check_memory_plan_index(&after, index_text)?;
    let files = compare_memory_archive_files(&before, &after);
    let time =
        check_memory_archive_time_with_sources(&before, &after, previous, now_ms, after_days)?;
    let log = check_memory_archive_log_with_sources(
        &before, &after, previous, current, now_ms, after_days,
    )?;
    let links = check_memory_archive_links(&before, &after, previous, current, now_ms, after_days)?;
    let qualified_appends: BTreeSet<_> = log
        .fragments
        .fragments
        .iter()
        .map(|f| f.target.clone())
        .collect();
    let mut issues = Vec::new();
    for (code, subjects) in [
        (
            "PRESERVATION_MISSING_LIVE_ITEMS",
            &preservation.missing_live_items,
        ),
        ("PRESERVATION_MISSING_ITEMS", &preservation.missing_items),
        (
            "PRESERVATION_MISSING_LIVE_PLANS",
            &preservation.missing_live_plans,
        ),
        ("PROTECTED_CHANGED_FILES", &protected.changed_files),
        ("PROTECTED_ADDED_FILES", &protected.added_files),
        ("PROTECTED_REMOVED_FILES", &protected.removed_files),
        ("INDEX_MISSING_PLANS", &index.missing_plans),
        (
            "INDEX_UNAVAILABLE_PLAN_LINKS",
            &index.unavailable_plan_links,
        ),
        ("ARCHIVE_MISSING_MOVED_FILES", &files.missing_moved_files),
        ("ARCHIVE_AMBIGUOUS_FILES", &files.ambiguous_files),
        (
            "ARCHIVE_INELIGIBLE_REMOVALS",
            &files.ineligible_removed_files,
        ),
        ("ARCHIVE_CHANGED_HANDOFFS", &files.changed_handoffs),
        ("ARCHIVE_MISSING_ARCHIVES", &files.missing_archives),
        ("ARCHIVE_UNKNOWN_DATES", &time.unknown_dates),
        ("ARCHIVE_FUTURE_DATES", &time.future_dates),
        ("ARCHIVE_TOO_RECENT", &time.too_recent),
        ("ARCHIVE_WRONG_MONTHS", &time.wrong_months),
        ("LOG_MISSING_MOVES", &log.log.missing_moves),
        ("LOG_MISSING_SIZES", &log.log.missing_sizes),
        ("LOG_MISSING_FRAGMENTS", &log.missing_fragments),
        ("LINKS_MISSING_MOVES", &links.missing_moves),
        ("LINKS_MISSING_FRAGMENTS", &links.missing_fragments),
        ("LINKS_UNVERIFIED_DOCUMENTS", &links.unverified_documents),
        ("LINKS_MISSING_DOCUMENTS", &links.missing_documents),
    ] {
        add(&mut issues, code, subjects.clone());
    }
    if !index.complete {
        add(
            &mut issues,
            "INDEX_INCOMPLETE",
            vec!["plans/INDEX.md".into()],
        );
    }
    add(
        &mut issues,
        "INDEX_UNVERIFIED_LINES",
        lines("plans/INDEX.md", &index.unverified_lines),
    );
    if !log.log.complete {
        add(&mut issues, "LOG_INCOMPLETE", vec!["archive/LOG.md".into()]);
    }
    for (code, values) in [
        ("LOG_INVALID_LINES", &log.log.invalid_lines),
        ("LOG_UNMATCHED_LINES", &log.log.unmatched_lines),
        ("LOG_DUPLICATE_LINES", &log.log.duplicate_lines),
    ] {
        add(&mut issues, code, lines("archive/LOG.md", values));
    }
    let fragments = &log.fragments;
    for (code, subjects) in [
        ("FRAGMENT_MISSING", &fragments.missing_fragments),
        ("FRAGMENT_UNKNOWN_DATES", &fragments.unknown_dates),
        ("FRAGMENT_FUTURE_DATES", &fragments.future_dates),
        ("FRAGMENT_TOO_RECENT", &fragments.too_recent),
        ("FRAGMENT_OPEN", &fragments.open_fragments),
        ("FRAGMENT_AMBIGUOUS", &fragments.ambiguous_fragments),
        ("FRAGMENT_UNVERIFIED_SOURCES", &fragments.unverified_sources),
        ("FRAGMENT_REWRITTEN_ARCHIVES", &fragments.rewritten_archives),
        (
            "FRAGMENT_UNATTRIBUTED_ARCHIVES",
            &fragments.unattributed_archives,
        ),
    ] {
        add(&mut issues, code, subjects.iter().cloned().collect());
    }
    add(
        &mut issues,
        "ARCHIVE_CHANGED_ARCHIVES",
        files
            .changed_archives
            .iter()
            .filter(|p| !qualified_appends.contains(*p))
            .cloned()
            .collect(),
    );
    add(
        &mut issues,
        "ARCHIVE_UNATTRIBUTED_ARCHIVES",
        files
            .unattributed_archives
            .iter()
            .filter(|p| !qualified_appends.contains(*p))
            .cloned()
            .collect(),
    );
    Ok(MemoryCheckReport {
        schema: 1,
        now_ms,
        after_days,
        preservation,
        protected,
        index,
        files,
        time,
        log,
        links,
        qualified_appends: qualified_appends.into_iter().collect(),
        issues,
    })
}
