use crate::{Issue, KitResult};
use serde_json::Value;

fn escaped_unit(bytes: &[u8], offset: usize) -> Option<u16> {
    if bytes.get(offset..offset + 2)? != b"\\u" {
        return None;
    }
    let hex = std::str::from_utf8(bytes.get(offset + 2..offset + 6)?).ok()?;
    u16::from_str_radix(hex, 16).ok()
}

fn invalid_surrogates(text: &str) -> Vec<usize> {
    let bytes = text.as_bytes();
    let mut offsets = Vec::new();
    let mut quoted = false;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'"' {
            quoted = !quoted;
            index += 1;
        } else if quoted && bytes[index] == b'\\' {
            match escaped_unit(bytes, index) {
                Some(unit) if (0xd800..=0xdbff).contains(&unit) => {
                    if escaped_unit(bytes, index + 6)
                        .is_some_and(|low| (0xdc00..=0xdfff).contains(&low))
                    {
                        index += 12;
                    } else {
                        offsets.push(index);
                        index += 6;
                    }
                }
                Some(unit) if (0xdc00..=0xdfff).contains(&unit) => {
                    offsets.push(index);
                    index += 6;
                }
                Some(_) => index += 6,
                None => index += 2,
            }
        } else {
            index += 1;
        }
    }
    offsets
}

pub(crate) fn parse_document(text: &str) -> KitResult<Value> {
    parse_document_with_limit(text, 256 * 1024)
}

pub(crate) fn parse_document_with_limit(text: &str, max_bytes: usize) -> KitResult<Value> {
    if max_bytes == 0 || max_bytes > 4 * 1024 * 1024 || text.len() > max_bytes {
        return Err(vec![Issue::new("KIT_DOCUMENT_TOO_LARGE", vec![])]);
    }
    let invalid = invalid_surrogates(text);
    if !invalid.is_empty() {
        // Classification only: repaired text is never returned as project data.
        let mut repaired = text.to_owned();
        for offset in invalid {
            repaired.replace_range(offset..offset + 6, "\\ufffd");
        }
        let code = if serde_json::from_str::<Value>(&repaired).is_ok() {
            "KIT_DOCUMENT_INVALID_UNICODE"
        } else {
            "KIT_DOCUMENT_INVALID_JSON"
        };
        return Err(vec![Issue::new(code, vec![])]);
    }
    let value: Value = serde_json::from_str(text)
        .map_err(|_| vec![Issue::new("KIT_DOCUMENT_INVALID_JSON", vec![])])?;
    let mut pending = vec![&value];
    let mut nodes = 0;
    while let Some(current) = pending.pop() {
        nodes += 1;
        if nodes > 16384 {
            return Err(vec![Issue::new("KIT_DOCUMENT_NODE_LIMIT", vec![])]);
        }
        match current {
            Value::Array(items) => pending.extend(items),
            Value::Object(properties) => pending.extend(properties.values()),
            _ => {}
        }
    }
    Ok(value)
}

fn js_whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

pub(crate) fn js_trim(text: &str) -> &str {
    text.trim_matches(js_whitespace)
}

pub(crate) fn js_trim_end(text: &str) -> &str {
    text.trim_end_matches(js_whitespace)
}

pub(crate) fn has_control(text: &str) -> bool {
    text.chars().any(|c| c <= '\u{001f}' || c == '\u{007f}')
}
