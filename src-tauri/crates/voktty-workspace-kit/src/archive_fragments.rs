use super::*;
use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Serialize)]
pub struct MemoryArchiveFragment {
    pub source: String,
    pub line: usize,
    pub target: String,
    pub bytes: usize,
    pub sha256: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryArchiveFragmentReport {
    pub fragments: Vec<MemoryArchiveFragment>,
    pub missing_fragments: BTreeSet<String>,
    pub unknown_dates: BTreeSet<String>,
    pub future_dates: BTreeSet<String>,
    pub too_recent: BTreeSet<String>,
    pub open_fragments: BTreeSet<String>,
    pub ambiguous_fragments: BTreeSet<String>,
    pub unverified_sources: BTreeSet<String>,
    pub rewritten_archives: BTreeSet<String>,
    pub unattributed_archives: BTreeSet<String>,
}

struct Unit {
    source: String,
    line: usize,
    end_line: usize,
    body: String,
    header: String,
    date: Option<String>,
}
impl Unit {
    fn key(&self) -> String {
        format!("{}#L{}", self.source, self.line)
    }
}
struct Boundary {
    line: usize,
    offset: usize,
    level: usize,
    candidate: bool,
    header: String,
    date: Option<String>,
}
struct Patterns {
    heading: Regex,
    bullet: Regex,
    item: Regex,
    done: Regex,
    prefix: Regex,
    day: Regex,
    closed: Regex,
}
fn patterns() -> &'static Patterns {
    static PATTERNS: OnceLock<Patterns> = OnceLock::new();
    PATTERNS.get_or_init(|| Patterns {
        heading: Regex::new(r"^(#{1,6})[ \t]+").unwrap(),
        bullet: Regex::new(r"^(?:[-+*]|[0-9]{1,9}[.)])[ \t]+").unwrap(),
        item: Regex::new(r"\[([TDQ]-[1-9][0-9]*)( done)?\]").unwrap(),
        done: Regex::new(r"\[[TDQ]-[1-9][0-9]* done\]").unwrap(),
        prefix: Regex::new(r"^(?:#{1,6}|[-+*]|[0-9]{1,9}[.)])[ \t]+").unwrap(),
        day: Regex::new(r"^## ([0-9]{4}-[0-9]{2}-[0-9]{2})$").unwrap(),
        closed: Regex::new(r" · closed ([0-9]{4}-[0-9]{2}-[0-9]{2})$").unwrap(),
    })
}

fn units(source: &str, text: &str) -> KitResult<(Vec<Unit>, bool)> {
    let p = patterns();
    let mut visible = crate::memory::visible_memory_lines(text);
    let mut boundaries = Vec::new();
    let mut offset = 0;
    let mut plain = true;
    let mut raw_count = 0;
    for (index, (raw, line)) in text.split('\n').zip(visible.by_ref()).enumerate() {
        raw_count = index + 1;
        let original = raw.strip_suffix('\r').unwrap_or(raw);
        let heading = p.heading.captures(&line);
        let stripped = p.item.replace_all(&line, "");
        let stripped = p.prefix.replace(&stripped, "");
        if stripped.contains(['<', '>', '`', '*', '_', '[', ']', '(', ')', '\\', '~'])
            || line.starts_with('>')
        {
            plain = false;
        }
        if heading.is_some() || p.bullet.is_match(&line) {
            if boundaries.len() == 1024 {
                return Err(invalid("KIT_ARCHIVE_FRAGMENT_LIMIT"));
            }
            let day = (source == "continuity/CHANGELOG.md")
                .then(|| p.day.captures(&line))
                .flatten();
            let closed = p.closed.captures(&line);
            let date = (original == line)
                .then(|| {
                    day.as_ref()
                        .or_else(|| {
                            closed
                                .as_ref()
                                .filter(|_| line.matches(" · closed ").count() == 1)
                        })
                        .map(|m| m[1].to_owned())
                })
                .flatten();
            boundaries.push(Boundary {
                line: index + 1,
                offset,
                level: heading.map_or(0, |m| m[1].len()),
                candidate: day.is_some() || p.done.is_match(&line),
                header: raw.into(),
                date,
            });
        }
        offset += raw.len() + 1;
    }
    for _ in visible.by_ref() {}
    let mut result: Vec<Unit> = Vec::new();
    let mut occupied_until = 0;
    for (index, start) in boundaries.iter().enumerate() {
        if !start.candidate || start.offset < occupied_until {
            continue;
        }
        let end = boundaries[index + 1..]
            .iter()
            .find(|next| start.level == 0 || next.level > 0 && next.level <= start.level);
        occupied_until = end.map_or(text.len(), |next| next.offset);
        result.push(Unit {
            source: source.into(),
            line: start.line,
            end_line: end.map_or(raw_count, |next| next.line - 1),
            body: text[start.offset..occupied_until].into(),
            header: start.header.clone(),
            date: start.date.clone(),
        });
    }
    if source == "continuity/CHANGELOG.md"
        && boundaries.iter().any(|b| {
            b.level >= 2
                && !result
                    .iter()
                    .any(|u| b.line >= u.line && b.line <= u.end_line)
        })
    {
        plain = false;
    }
    Ok((result, plain && visible.warnings().is_empty()))
}

fn matches(expected: &MemoryPreservationSnapshot, actual: &MemoryPreservationSnapshot) -> bool {
    expected.files.len() == actual.files.len()
        && expected.files.iter().zip(&actual.files).all(|(old, now)| {
            old.path == now.path && old.sha256 == now.sha256 && old.bytes == now.bytes
        })
}
fn text<'a>(facts: &'a BTreeMap<String, PathFact>, path: &str) -> &'a str {
    match facts.get(path) {
        Some(PathFact::File { text }) => text,
        _ => "",
    }
}

/// Credits intact appended blocks only after binding both complete source inventories.
pub fn check_memory_archive_fragments(
    before: &MemoryPreservationSnapshot,
    after: &MemoryPreservationSnapshot,
    previous_sources: &BTreeMap<String, PathFact>,
    current_sources: &BTreeMap<String, PathFact>,
    now_ms: u64,
    after_days: u64,
) -> KitResult<MemoryArchiveFragmentReport> {
    if now_ms > 8640000000000000 || !(1..=36500).contains(&after_days) {
        return Err(invalid("KIT_ARCHIVE_TIME_INVALID"));
    }
    let bound_before = snapshot_memory_preservation(previous_sources, true)?;
    let bound_after = snapshot_memory_preservation(current_sources, true)?;
    if !matches(before, &bound_before) || !matches(after, &bound_after) {
        return Err(invalid("KIT_ARCHIVE_FRAGMENT_SOURCE_CHANGED"));
    }
    let whole = compare_memory_archive_files(&bound_before, &bound_after).moves;
    let mut report = MemoryArchiveFragmentReport::default();
    let mut candidates: BTreeMap<String, BTreeMap<String, Vec<Unit>>> = BTreeMap::new();
    let mut budget = 64 * 1024 * 1024usize;
    let mut count = 0;
    for file in &bound_before.files {
        if file.kind != "live" || whole.iter().any(|m| m.source == file.path) {
            continue;
        }
        let old = text(previous_sources, &file.path);
        let now = text(current_sources, &file.path);
        if old == now {
            continue;
        }
        let (units, plain) = units(&file.path, old)?;
        if !plain
            || file.items.iter().any(|item| {
                item.state == "done"
                    && !units
                        .iter()
                        .any(|u| item.line >= u.line && item.line <= u.end_line)
            })
        {
            if file.items.iter().any(|item| item.state == "done")
                || file.path == "continuity/CHANGELOG.md"
            {
                report.unverified_sources.insert(file.path.clone());
            }
            continue;
        }
        if file.path == "continuity/CHANGELOG.md" && units.is_empty() {
            report.unverified_sources.insert(file.path.clone());
        }
        let mut seen_headers = BTreeSet::new();
        for unit in &units {
            count += 1;
            budget = budget
                .checked_sub(now.len())
                .ok_or_else(|| invalid("KIT_ARCHIVE_FRAGMENT_LIMIT"))?;
            if count > 256 {
                return Err(invalid("KIT_ARCHIVE_FRAGMENT_LIMIT"));
            }
            if !seen_headers.insert(&unit.header) {
                report.unverified_sources.insert(file.path.clone());
            }
        }
        if report.unverified_sources.contains(&file.path) {
            continue;
        }
        for unit in units {
            if now.contains(&unit.body) {
                continue;
            }
            let key = unit.key();
            if file.items.iter().any(|item| {
                item.state == "open" && item.line >= unit.line && item.line <= unit.end_line
            }) {
                report.open_fragments.insert(key);
                continue;
            }
            let day = unit
                .date
                .as_ref()
                .and_then(|date| crate::handoff_created_at_ms(&format!("{date}-0000-fragment.md")));
            let Some(day) = day else {
                report.unknown_dates.insert(key);
                continue;
            };
            if day > now_ms {
                report.future_dates.insert(key);
                continue;
            }
            if now_ms.saturating_sub(day + 86400000 - 1) <= after_days * 86400000 {
                report.too_recent.insert(key);
                continue;
            }
            let target = format!(
                "archive/{}/{}",
                &unit.date.as_ref().unwrap()[..7],
                file.path.rsplit('/').next().unwrap()
            );
            report.missing_fragments.insert(key);
            candidates
                .entry(target)
                .or_default()
                .entry(unit.header.clone())
                .or_default()
                .push(unit);
        }
    }
    for entries in candidates.values() {
        for group in entries.values() {
            if group.len() > 1 {
                for unit in group {
                    report.ambiguous_fragments.insert(unit.key());
                }
            }
        }
    }
    for file in &bound_after.files {
        if file.kind != "archive" || whole.iter().any(|m| m.target == file.path) {
            continue;
        }
        let existed = bound_before.files.iter().any(|old| old.path == file.path);
        let old = text(previous_sources, &file.path);
        let now = text(current_sources, &file.path);
        if existed && old == now {
            continue;
        }
        let Some(mut suffix) = now.strip_prefix(old) else {
            report.rewritten_archives.insert(file.path.clone());
            continue;
        };
        if !old.is_empty() && !old.ends_with('\n') && !suffix.is_empty() {
            let Some(rest) = suffix
                .strip_prefix("\r\n")
                .or_else(|| suffix.strip_prefix('\n'))
            else {
                report.rewritten_archives.insert(file.path.clone());
                continue;
            };
            suffix = rest;
        }
        let mut selected = Vec::new();
        let mut used = BTreeSet::new();
        let mut qualified = !suffix.is_empty();
        while !suffix.is_empty() {
            let header = suffix.split('\n').next().unwrap();
            let group = candidates
                .get(&file.path)
                .and_then(|entries| entries.get(header));
            let unit = group.filter(|g| g.len() == 1).map(|g| &g[0]);
            let Some(unit) = unit else {
                qualified = false;
                break;
            };
            if used.contains(&unit.key()) || !suffix.starts_with(&unit.body) {
                qualified = false;
                break;
            }
            used.insert(unit.key());
            selected.push(unit);
            suffix = &suffix[unit.body.len()..];
            if !suffix.is_empty() && !unit.body.ends_with('\n') {
                let Some(rest) = suffix
                    .strip_prefix("\r\n")
                    .or_else(|| suffix.strip_prefix('\n'))
                else {
                    qualified = false;
                    break;
                };
                suffix = rest;
                if suffix.is_empty() {
                    qualified = false;
                }
            }
        }
        if !qualified {
            report.unattributed_archives.insert(file.path.clone());
        } else {
            for unit in selected {
                report.missing_fragments.remove(&unit.key());
                report.fragments.push(MemoryArchiveFragment {
                    source: unit.source.clone(),
                    line: unit.line,
                    target: file.path.clone(),
                    bytes: unit.body.len(),
                    sha256: hex::encode(Sha256::digest(unit.body.as_bytes())),
                });
            }
        }
    }
    report
        .fragments
        .sort_by(|a, b| a.source.cmp(&b.source).then(a.line.cmp(&b.line)));
    Ok(report)
}
