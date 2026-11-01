use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryArchiveTimeReport {
    pub qualified_moves: Vec<String>,
    pub unknown_dates: Vec<String>,
    pub future_dates: Vec<String>,
    pub too_recent: Vec<String>,
    pub wrong_months: Vec<String>,
}

/// Temporal evidence for observed whole-file moves, never archive authorization.
pub fn check_memory_archive_time(
    before: &MemoryPreservationSnapshot,
    after: &MemoryPreservationSnapshot,
    now_ms: u64,
    after_days: u64,
) -> KitResult<MemoryArchiveTimeReport> {
    if now_ms > 8640000000000000 || !(1..=36500).contains(&after_days) {
        return Err(invalid("KIT_ARCHIVE_TIME_INVALID"));
    }
    let mut report = MemoryArchiveTimeReport {
        qualified_moves: Vec::new(),
        unknown_dates: Vec::new(),
        future_dates: Vec::new(),
        too_recent: Vec::new(),
        wrong_months: Vec::new(),
    };
    for movement in compare_memory_archive_files(before, after).moves {
        let name = movement.source.rsplit('/').next().unwrap_or("");
        let created = movement
            .source
            .starts_with("continuity/handoffs/")
            .then(|| crate::handoff_created_at_ms(name))
            .flatten();
        let Some(created) = created else {
            report.unknown_dates.push(movement.source);
            continue;
        };
        let wrong_month = movement.target.split('/').nth(1) != name.get(..7);
        let future = created > now_ms;
        let recent = !future && now_ms - created <= after_days * 86400000;
        if wrong_month {
            report.wrong_months.push(movement.source.clone());
        }
        if future {
            report.future_dates.push(movement.source.clone());
        }
        if recent {
            report.too_recent.push(movement.source.clone());
        }
        if !wrong_month && !future && !recent {
            report.qualified_moves.push(movement.source);
        }
    }
    Ok(report)
}
