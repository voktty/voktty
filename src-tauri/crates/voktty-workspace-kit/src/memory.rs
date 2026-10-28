use crate::document::js_trim;
use crate::{parse_kit_config, Issue, KitResult, PathFact};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize)]
pub struct ItemOccurrence {
    pub id: String,
    pub state: &'static str,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct MilestoneOccurrence {
    pub id: String,
    pub state: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryText {
    pub bytes: usize,
    pub chars: usize,
    pub ids: Vec<ItemOccurrence>,
    pub plan_state: String,
    pub milestones: Vec<MilestoneOccurrence>,
    pub up_next: Option<usize>,
    pub warnings: Vec<&'static str>,
    pub complete: bool,
}

struct Patterns {
    fence: Regex,
    closing: Regex,
    heading: Regex,
    item: Regex,
    milestone: Regex,
    milestone_state: Regex,
    state: Regex,
    bullet: Regex,
    heading_tail: Regex,
}

fn patterns() -> &'static Patterns {
    static PATTERNS: OnceLock<Patterns> = OnceLock::new();
    PATTERNS.get_or_init(|| Patterns {
        fence: Regex::new(r"^ {0,3}(`{3,}|~{3,})(.*)$").unwrap(),
        closing: Regex::new(r"^ {0,3}(`{3,}|~{3,})[ \t]*$").unwrap(),
        heading: Regex::new(r"^ {0,3}(#{1,6})[ \t]+(.+)$").unwrap(),
        item: Regex::new(r"\[([TDQ]-[1-9][0-9]*)( done)?\]").unwrap(),
        milestone: Regex::new(r"^M([1-9][0-9]*):").unwrap(),
        milestone_state: Regex::new(
            r"^(pending|in progress|done)(?: [0-9]{4}-[0-9]{2}-[0-9]{2})?$",
        )
        .unwrap(),
        state: Regex::new(
            r"^[^:]+:[ \t]*(?:\*\*)?(open|written|waiting|parked|closed)(?:\*\*)?(?:[ \t]|$)",
        )
        .unwrap(),
        bullet: Regex::new(r"^( {0,3})(?:[-+*]|[0-9]+[.)])[ \t]+").unwrap(),
        heading_tail: Regex::new(r"[ \t]+#+[ \t]*$").unwrap(),
    })
}

fn visible_line(line: &str, comment: &mut bool) -> String {
    let mut visible = String::new();
    let mut index = 0;
    while index < line.len() {
        if *comment {
            let Some(end) = line[index..].find("-->") else {
                break;
            };
            *comment = false;
            index += end + 3;
            visible.push(' ');
        } else if line[index..].starts_with("<!--") {
            *comment = true;
            index += 4;
            visible.push(' ');
        } else if line.as_bytes()[index] == b'`'
            && (index == 0 || line.as_bytes()[index - 1] != b'\\')
        {
            let mut end = index + 1;
            while line.as_bytes().get(end) == Some(&b'`') {
                end += 1;
            }
            let marker = &line[index..end];
            let mut search = end;
            let mut closing = None;
            while let Some(offset) = line[search..].find(marker) {
                let candidate = search + offset;
                if line.as_bytes().get(candidate.wrapping_sub(1)) != Some(&b'`')
                    && line.as_bytes().get(candidate + marker.len()) != Some(&b'`')
                {
                    closing = Some(candidate);
                    break;
                }
                search = candidate + marker.len();
            }
            if let Some(closing) = closing {
                visible.push(' ');
                index = closing + marker.len();
            } else {
                visible.push_str(marker);
                index = end;
            }
        } else {
            let c = line[index..].chars().next().unwrap();
            visible.push(c);
            index += c.len_utf8();
        }
    }
    visible
}

pub fn inspect_memory_text(text: &str, up_next_heading: &str) -> KitResult<MemoryText> {
    if text.len() > 256 * 1024 {
        return Err(vec![Issue::new("KIT_MEMORY_TEXT_TOO_LARGE", vec![])]);
    }
    if text.contains('\0')
        || js_trim(up_next_heading).is_empty()
        || up_next_heading.len() > 128
        || up_next_heading.contains(['\r', '\n', '\0'])
    {
        return Err(vec![Issue::new("KIT_MEMORY_TEXT_INVALID", vec![])]);
    }
    let p = patterns();
    let mut result = MemoryText {
        bytes: text.len(),
        chars: text.chars().count(),
        ids: Vec::new(),
        plan_state: "unknown".into(),
        milestones: Vec::new(),
        up_next: None,
        warnings: Vec::new(),
        complete: true,
    };
    let mut comment = false;
    let mut fence: Option<(u8, usize)> = None;
    let mut header = true;
    let mut sections = 0;
    let mut in_next = false;
    let mut states = BTreeSet::new();
    let mut bullets = Vec::new();
    for (index, raw) in text.split('\n').enumerate() {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some((marker, length)) = fence {
            if let Some(closing) = p.closing.captures(line) {
                if closing[1].as_bytes()[0] == marker && closing[1].len() >= length {
                    fence = None;
                }
            }
            continue;
        }
        if !comment {
            if let Some(opening) = p.fence.captures(line) {
                if !(opening[1].starts_with('`') && opening[2].contains('`')) {
                    fence = Some((opening[1].as_bytes()[0], opening[1].len()));
                    continue;
                }
            }
        }
        let visible = visible_line(line, &mut comment);
        for item in p.item.captures_iter(&visible) {
            result.ids.push(ItemOccurrence {
                id: item[1].into(),
                state: if item.get(2).is_some() {
                    "done"
                } else {
                    "open"
                },
                line: index + 1,
            });
        }
        if let Some(heading) = p.heading.captures(&visible) {
            if heading[1].len() >= 2 {
                header = false;
                if heading[1].len() == 2 {
                    let title = p.heading_tail.replace(&heading[2], "");
                    in_next = js_trim(&title) == js_trim(up_next_heading);
                    if in_next {
                        sections += 1;
                    }
                }
                if heading[1].len() == 3 {
                    if let Some(milestone) = p.milestone.captures(&heading[2]) {
                        if let Some(state) = heading[2]
                            .split('·')
                            .nth(1)
                            .and_then(|part| p.milestone_state.captures(js_trim(part)))
                        {
                            result.milestones.push(MilestoneOccurrence {
                                id: format!("M{}", &milestone[1]),
                                state: state[1].into(),
                                line: index + 1,
                            });
                        }
                    }
                }
            }
        }
        if header && !visible.starts_with([' ', '#', '>', '\t']) && !p.bullet.is_match(&visible) {
            for part in visible.split('·') {
                if let Some(state) = p.state.captures(js_trim(part)) {
                    states.insert(state[1].to_owned());
                }
            }
        }
        if in_next {
            if let Some(bullet) = p.bullet.captures(&visible) {
                bullets.push(bullet[1].len());
            }
        }
    }
    if fence.is_some() {
        result.warnings.push("unclosed-fence");
    }
    if comment {
        result.warnings.push("unclosed-comment");
    }
    if sections > 1 {
        result.warnings.push("duplicate-up-next");
    }
    if states.len() > 1 {
        result.warnings.push("conflicting-plan-state");
    }
    if states.len() == 1 {
        result.plan_state = states.into_iter().next().unwrap();
    }
    let indentation = bullets.iter().min().copied().unwrap_or(4);
    if sections == 1 {
        result.up_next = Some(
            bullets
                .iter()
                .filter(|indent| **indent == indentation)
                .count(),
        );
    }
    result.complete = result.warnings.is_empty();
    Ok(result)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffFile {
    pub name: String,
    pub created_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HandoffInventory {
    pub complete: bool,
    pub files: Vec<HandoffFile>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryMeasurement {
    pub path: String,
    pub metric: &'static str,
    pub value: Option<u64>,
    pub limit: u64,
    pub status: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryMeasurements {
    pub measurements: Vec<MemoryMeasurement>,
    pub complete: bool,
    pub exceeded: bool,
}

fn add(
    measurements: &mut Vec<MemoryMeasurement>,
    path: &str,
    metric: &'static str,
    value: Option<u64>,
    limit: u64,
) {
    measurements.push(MemoryMeasurement {
        path: path.into(),
        metric,
        value,
        limit,
        status: match value {
            None => "unknown",
            Some(value) if value > limit => "exceeded",
            _ => "ok",
        },
    });
}

pub fn measure_memory(
    config_text: &str,
    documents: &BTreeMap<String, PathFact>,
    handoffs: &HandoffInventory,
    now_ms: u64,
    up_next_heading: &str,
) -> KitResult<MemoryMeasurements> {
    let config = parse_kit_config(config_text)?;
    if now_ms > 8640000000000000 {
        return Err(vec![Issue::new("KIT_MEMORY_TIME_INVALID", vec![])]);
    }
    let mut measurements = Vec::new();
    for path in [
        "CONTEXT.md",
        "PROJECT.md",
        "plans/INDEX.md",
        "plans/TRACKING.md",
        "continuity/CHANGELOG.md",
    ] {
        let Some(limit) = config["limits"].get(path) else {
            continue;
        };
        let text = match documents.get(path) {
            Some(PathFact::File { text }) => Some(inspect_memory_text(text, up_next_heading)?),
            _ => None,
        };
        add(
            &mut measurements,
            path,
            "chars",
            text.as_ref().map(|text| text.chars as u64),
            limit["maxChars"].as_f64().unwrap() as u64,
        );
        if let Some(up_next) = limit.get("maxUpNext") {
            add(
                &mut measurements,
                path,
                "up-next",
                text.as_ref()
                    .filter(|text| text.complete)
                    .and_then(|text| text.up_next)
                    .map(|count| count as u64),
                up_next.as_f64().unwrap() as u64,
            );
        }
    }
    if let Some(limit) = config["limits"].get("continuity/handoffs/") {
        if handoffs.files.len() > 20000 {
            return Err(vec![Issue::new("KIT_MEMORY_INVENTORY_TOO_LARGE", vec![])]);
        }
        let mut names = BTreeSet::new();
        let mut count = 0;
        let mut oldest = Some(0);
        for file in &handoffs.files {
            if file.name.is_empty()
                || file.name.len() > 256
                || file.name.contains(['/', '\\', '\0'])
                || !names.insert(&file.name)
            {
                return Err(vec![Issue::new("KIT_MEMORY_INVENTORY_INVALID", vec![])]);
            }
            if !file.name.to_ascii_lowercase().ends_with(".md")
                || file.name.eq_ignore_ascii_case("README.md")
            {
                continue;
            }
            count += 1;
            match file.created_at_ms {
                Some(created) if created <= now_ms => {
                    oldest = oldest.map(|age: u64| age.max(now_ms - created));
                }
                _ => oldest = None,
            }
        }
        add(
            &mut measurements,
            "continuity/handoffs/",
            "files",
            handoffs.complete.then_some(count),
            limit["maxFiles"].as_f64().unwrap() as u64,
        );
        add(
            &mut measurements,
            "continuity/handoffs/",
            "age-ms",
            if handoffs.complete { oldest } else { None },
            limit["maxAgeDays"].as_f64().unwrap() as u64 * 86400000,
        );
    }
    Ok(MemoryMeasurements {
        complete: measurements.iter().all(|entry| entry.value.is_some()),
        exceeded: measurements.iter().any(|entry| entry.status == "exceeded"),
        measurements,
    })
}
