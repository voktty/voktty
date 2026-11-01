use super::*;
use regex::Regex;
use std::sync::OnceLock;

fn unqualified_container(mut line: &str) -> bool {
    static LIST: OnceLock<Regex> = OnceLock::new();
    let list = LIST.get_or_init(|| Regex::new(r"^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])([ \t]+)").unwrap());
    for _ in 0..16 {
        if line.starts_with("    ")
            || line
                .bytes()
                .take_while(|b| matches!(*b, b' ' | b'\t'))
                .any(|b| b == b'\t')
            || line.trim_start_matches(' ').starts_with('>')
        {
            return true;
        }
        let Some(marker) = list.captures(line) else {
            return false;
        };
        if marker[1].len() > 4 || marker[1].contains('\t') {
            return true;
        }
        line = &line[marker.get(0).unwrap().end()..];
    }
    true
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPlanIndexReport {
    pub linked_plans: Vec<String>,
    pub missing_plans: Vec<String>,
    pub unavailable_plan_links: Vec<String>,
    pub unverified_lines: Vec<usize>,
    pub complete: bool,
}

fn escaped(bytes: &[u8], index: usize) -> bool {
    bytes[..index]
        .iter()
        .rev()
        .take_while(|byte| **byte == b'\\')
        .count()
        % 2
        == 1
}

fn destination(body: &str) -> Option<&str> {
    let body = body.trim_matches([' ', '\t']);
    let (target, tail) = if let Some(angle) = body.strip_prefix('<') {
        let end = angle.find('>')?;
        (&angle[..end], &angle[end + 1..])
    } else {
        let end = body.find([' ', '\t']).unwrap_or(body.len());
        (&body[..end], &body[end..])
    };
    let tail = tail.trim_matches([' ', '\t']);
    if !tail.is_empty()
        && !(tail.len() >= 2
            && ((tail.starts_with('"')
                && tail.ends_with('"')
                && !tail[1..tail.len() - 1].contains('"'))
                || (tail.starts_with('\'')
                    && tail.ends_with('\'')
                    && !tail[1..tail.len() - 1].contains('\''))))
    {
        return None;
    }
    (!target.is_empty()).then_some(target)
}

fn target(raw: &str) -> Result<Option<String>, ()> {
    if raw.len() > 4096 || raw.contains(['<', '>']) || raw.chars().any(char::is_control) {
        return Err(());
    }
    let lower = raw.to_ascii_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") || raw.starts_with('#') {
        return Ok(None);
    }
    let raw = raw.split('#').next().ok_or(())?;
    if raw.starts_with('/') || raw.contains(['\\', ':', '?', '&']) {
        return Err(());
    }
    let mut parts = vec!["plans".to_owned()];
    for segment in raw.split('/') {
        if segment.is_empty() {
            return Err(());
        }
        let mut decoded = Vec::new();
        let bytes = segment.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' {
                let hex =
                    std::str::from_utf8(bytes.get(i + 1..i + 3).ok_or(())?).map_err(|_| ())?;
                let byte = u8::from_str_radix(hex, 16).map_err(|_| ())?;
                if matches!(byte, b'/' | b'\\') {
                    return Err(());
                }
                decoded.push(byte);
                i += 3;
            } else {
                decoded.push(bytes[i]);
                i += 1;
            }
        }
        let decoded = String::from_utf8(decoded).map_err(|_| ())?;
        if decoded
            .chars()
            .any(|c| c.is_control() || matches!(c, '\\' | ':' | '%' | '?' | '#' | '&'))
        {
            return Err(());
        }
        match decoded.as_str() {
            "." if segment == "." => {}
            ".." if segment == ".." => {
                parts.pop().ok_or(())?;
            }
            "." | ".." => return Err(()),
            _ => parts.push(decoded),
        }
        if parts.len() > 64 {
            return Err(());
        }
    }
    let path = parts.join("/");
    if path.len() > 4096 {
        return Err(());
    }
    Ok(Some(path))
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
    let mut linked = BTreeSet::new();
    let mut unavailable = BTreeSet::new();
    let mut unverified = BTreeSet::new();
    let mut count = 0usize;
    let mut pending = None;
    let mut lines = crate::memory::visible_memory_lines(text);
    for (number, line) in lines.by_ref().enumerate() {
        let bytes = line.as_bytes();
        let mut i = 0;
        if unqualified_container(&line) && !line.trim_matches([' ', '\t']).is_empty() {
            unverified.insert(number + 1);
            if unverified.len() > 1024 {
                return Err(invalid("KIT_PLAN_INDEX_LIMIT"));
            }
            continue;
        }
        if let Some(previous) = pending.take() {
            if line.trim_start_matches([' ', '\t']).starts_with('(') {
                unverified.insert(previous);
                unverified.insert(number + 1);
            }
        }
        while i < bytes.len() {
            if (bytes[i] == b'<'
                || bytes[i..].starts_with(b"```")
                || bytes[i..].starts_with(b"~~~"))
                && !escaped(bytes, i)
            {
                unverified.insert(number + 1);
                break;
            }
            if bytes[i] != b'[' || escaped(bytes, i) {
                i += 1;
                continue;
            }
            let Some(offset) = line[i + 1..].find(']') else {
                unverified.insert(number + 1);
                break;
            };
            let close = i + 1 + offset;
            let qualified_label =
                !escaped(bytes, close) && !line[i + 1..close].contains(['[', '<']);
            if !qualified_label || matches!(bytes.get(close + 1), Some(b'[' | b':')) {
                unverified.insert(number + 1);
            }
            if bytes.get(close + 1) != Some(&b'(') {
                if line[close + 1..].trim_matches([' ', '\t']).is_empty() {
                    pending = Some(number + 1);
                }
                i = close + 1;
                continue;
            }
            count += 1;
            if count > 1024 {
                return Err(invalid("KIT_PLAN_INDEX_LIMIT"));
            }
            let mut end = close + 2;
            let mut depth = 1usize;
            let mut angle = false;
            while end < bytes.len() {
                if end - close - 2 > 4096 {
                    break;
                }
                if matches!(bytes[end], b'<' | b'>' | b'(' | b')') && !escaped(bytes, end) {
                    if bytes[end] == b'<' {
                        angle = true;
                    }
                    if bytes[end] == b'>' {
                        angle = false;
                    }
                    if !angle {
                        if bytes[end] == b'(' {
                            depth += 1;
                        }
                        if bytes[end] == b')' {
                            depth -= 1;
                            if depth == 0 {
                                break;
                            }
                        }
                    }
                }
                if depth > 16 {
                    break;
                }
                end += 1;
            }
            if depth != 0 {
                unverified.insert(number + 1);
                break;
            }
            let image = i > 0 && bytes[i - 1] == b'!' && !escaped(bytes, i - 1);
            if !image && qualified_label {
                let body = &line[close + 2..end];
                let resolved = (body.len() <= 4096)
                    .then(|| destination(body))
                    .flatten()
                    .ok_or(())
                    .and_then(target);
                match resolved {
                    Ok(Some(path))
                        if path.starts_with("plans/")
                            && path.ends_with(".md")
                            && !matches!(
                                path.as_str(),
                                "plans/INDEX.md"
                                    | "plans/TRACKING.md"
                                    | "plans/README.md"
                                    | "plans/_TEMPLATE.md"
                            ) =>
                    {
                        if plans.contains(path.as_str()) {
                            linked.insert(path);
                        } else {
                            unavailable.insert(path);
                        }
                    }
                    Ok(_) => {}
                    Err(()) => {
                        unverified.insert(number + 1);
                    }
                }
            }
            i = end + 1;
        }
        if unverified.len() > 1024 {
            return Err(invalid("KIT_PLAN_INDEX_LIMIT"));
        }
    }
    let complete = lines.warnings().is_empty() && unverified.is_empty();
    if !complete {
        linked.clear();
        unavailable.clear();
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
        unverified_lines: unverified.into_iter().collect(),
        complete,
    })
}
