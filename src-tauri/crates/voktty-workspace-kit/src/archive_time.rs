use super::*;
use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryArchiveTimeReport {
    pub qualified_moves: Vec<String>,
    pub unknown_dates: Vec<String>,
    pub future_dates: Vec<String>,
    pub too_recent: Vec<String>,
    pub wrong_months: Vec<String>,
}

struct ArchiveDate {
    first_ms: u64,
    last_ms: u64,
    month: String,
}

fn validate_time(now_ms: u64, after_days: u64) -> KitResult<()> {
    if now_ms > 8640000000000000 || !(1..=36500).contains(&after_days) {
        return Err(invalid("KIT_ARCHIVE_TIME_INVALID"));
    }
    Ok(())
}

/// Temporal evidence for observed whole-file moves, never archive authorization.
pub fn check_memory_archive_time(
    before: &MemoryPreservationSnapshot,
    after: &MemoryPreservationSnapshot,
    now_ms: u64,
    after_days: u64,
) -> KitResult<MemoryArchiveTimeReport> {
    validate_time(now_ms, after_days)?;
    Ok(archive_time_report(
        compare_memory_archive_files(before, after).moves,
        now_ms,
        after_days,
        &BTreeMap::new(),
    ))
}

fn archive_time_report(
    moves: Vec<MemoryArchiveMove>,
    now_ms: u64,
    after_days: u64,
    plan_dates: &BTreeMap<String, ArchiveDate>,
) -> MemoryArchiveTimeReport {
    let mut report = MemoryArchiveTimeReport {
        qualified_moves: Vec::new(),
        unknown_dates: Vec::new(),
        future_dates: Vec::new(),
        too_recent: Vec::new(),
        wrong_months: Vec::new(),
    };
    for movement in moves {
        let name = movement.source.rsplit('/').next().unwrap_or("");
        let created = movement
            .source
            .starts_with("continuity/handoffs/")
            .then(|| crate::handoff_created_at_ms(name))
            .flatten();
        let handoff = created.map(|created| ArchiveDate {
            first_ms: created,
            last_ms: created,
            month: name[..7].into(),
        });
        let Some(date) = handoff
            .as_ref()
            .or_else(|| plan_dates.get(&movement.source))
        else {
            report.unknown_dates.push(movement.source);
            continue;
        };
        let wrong_month = movement.target.split('/').nth(1) != Some(date.month.as_str());
        let future = date.first_ms > now_ms;
        let recent = !future && now_ms.saturating_sub(date.last_ms) <= after_days * 86400000;
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
    report
}

fn plan_closed_date(text: &str) -> Option<ArchiveDate> {
    static CLOSED: OnceLock<Regex> = OnceLock::new();
    static STATE: OnceLock<Regex> = OnceLock::new();
    static HEADING: OnceLock<Regex> = OnceLock::new();
    static UNSUPPORTED: OnceLock<Regex> = OnceLock::new();
    let closed = CLOSED.get_or_init(|| Regex::new(r"^(?:Date:[ \t]+([0-9]{4}-[0-9]{2}-[0-9]{2})[ \t]+·[ \t]+)?State:[ \t]+(?:closed|\*\*closed\*\*)[ \t]+([0-9]{4}-[0-9]{2}-[0-9]{2})[ \t]*$").unwrap());
    let state = STATE.get_or_init(|| Regex::new(r"State[ \t]*:").unwrap());
    let heading = HEADING.get_or_init(|| Regex::new(r"^ {0,3}#{2,6}[ \t]+").unwrap());
    let unsupported = UNSUPPORTED.get_or_init(|| {
        Regex::new(r"^(?:[ \t>]|[-+*][ \t]|[0-9]+[.)][ \t]|[-=]+[ \t]*$)").unwrap()
    });
    let mut visible = crate::memory::visible_memory_lines(text);
    let mut header = true;
    let mut unknown = false;
    let mut fields = 0;
    let mut date = None;
    for (raw, line) in text.split('\n').zip(visible.by_ref()) {
        if heading.is_match(&line) {
            header = false;
        }
        if !header || crate::document::js_trim(&line).is_empty() {
            continue;
        }
        if line.starts_with("# ") || line.starts_with("#\t") {
            let original = raw.strip_suffix('\r').unwrap_or(raw);
            if original != line
                || line[1..].contains(['<', '>', '`', '*', '_', '[', ']', '(', ')', '\\', '~', '#'])
            {
                unknown = true;
            }
            continue;
        }
        if unsupported.is_match(&line) {
            unknown = true;
        }
        if !state.is_match(&line) {
            if line.contains(['<', '>', '`', '*', '_', '[', ']', '(', ')', '\\', '~', '#']) {
                unknown = true;
            }
            continue;
        }
        fields += 1;
        let original = raw.strip_suffix('\r').unwrap_or(raw);
        let Some(matched) = closed.captures(&line) else {
            unknown = true;
            continue;
        };
        let first = crate::handoff_created_at_ms(&format!("{}-0000-plan.md", &matched[2]));
        let Some(first_ms) = first else {
            unknown = true;
            continue;
        };
        if original != line
            || matched.get(1).is_some_and(|prefix| {
                crate::handoff_created_at_ms(&format!("{}-0000-plan.md", prefix.as_str())).is_none()
            })
        {
            unknown = true;
            continue;
        }
        date = Some(ArchiveDate {
            first_ms,
            last_ms: first_ms + 86400000 - 1,
            month: matched[2][..7].into(),
        });
    }
    // zip can stop on the raw iterator before the visibility iterator observes EOF.
    for _ in visible.by_ref() {}
    if unknown || fields != 1 || !visible.warnings().is_empty() {
        None
    } else {
        date
    }
}

/// Qualifies plan closure dates only after binding original source bytes.
pub fn check_memory_archive_time_with_sources(
    before: &MemoryPreservationSnapshot,
    after: &MemoryPreservationSnapshot,
    previous_sources: &BTreeMap<String, PathFact>,
    now_ms: u64,
    after_days: u64,
) -> KitResult<MemoryArchiveTimeReport> {
    validate_time(now_ms, after_days)?;
    if previous_sources.len() > 128 {
        return Err(invalid("KIT_ARCHIVE_TIME_SOURCE_LIMIT"));
    }
    let moves = compare_memory_archive_files(before, after).moves;
    let mut dates = BTreeMap::new();
    let mut total = 0usize;
    let mut captured = Vec::new();
    for movement in &moves {
        if !movement.source.starts_with("plans/") {
            continue;
        }
        let Some(PathFact::File { text }) = previous_sources.get(&movement.source) else {
            continue;
        };
        if text.len() > 256 * 1024 {
            return Err(invalid("KIT_ARCHIVE_TIME_SOURCE_LIMIT"));
        }
        total += text.len();
        if total > 4 * 1024 * 1024 {
            return Err(invalid("KIT_ARCHIVE_TIME_SOURCE_LIMIT"));
        }
        captured.push((movement, text));
    }
    for (movement, text) in captured {
        if text.len() != movement.bytes
            || hex::encode(Sha256::digest(text.as_bytes())) != movement.sha256
        {
            return Err(invalid("KIT_ARCHIVE_TIME_SOURCE_CHANGED"));
        }
        if let Some(date) = plan_closed_date(text) {
            dates.insert(movement.source.clone(), date);
        }
    }
    Ok(archive_time_report(moves, now_ms, after_days, &dates))
}
