//! Lexical secret-path policy shared with the frontend. These checks perform no
//! filesystem IO and never replace authorization or canonical-path validation.

use regex::Regex;
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Rules {
    schema: u8,
    secret_basename_patterns: Vec<String>,
    protected_directories: Vec<String>,
    write_deny_prefixes: Vec<String>,
}
struct Policy {
    patterns: Vec<Regex>,
    protected: Vec<String>,
    write_denied: Vec<String>,
}

fn policy() -> &'static Policy {
    static POLICY: OnceLock<Policy> = OnceLock::new();
    POLICY.get_or_init(|| {
        let rules: Rules = serde_json::from_str(include_str!(
            "../../../../src/lib/pathSafetyRules.json"
        )).expect("embedded path safety rules");
        assert_eq!(rules.schema, 1);
        Policy {
            patterns: rules.secret_basename_patterns.iter().map(|pattern| {
                // The shared ASCII patterns use JavaScript dot and whitespace
                // semantics rather than Rust's larger Unicode whitespace set.
                let pattern = pattern.replace(".*", "[^\\n\\r\\u{2028}\\u{2029}]*")
                    .replace(".+", "[^\\n\\r\\u{2028}\\u{2029}]+")
                    .replace("\\s", "[\\x09-\\x0d \\u{00a0}\\u{1680}\\u{2000}-\\u{200a}\\u{2028}\\u{2029}\\u{202f}\\u{205f}\\u{3000}\\u{feff}]");
                Regex::new(&pattern).expect("embedded secret pattern")
            }).collect(),
            protected: rules.protected_directories,
            write_denied: rules.write_deny_prefixes,
        }
    })
}

fn js_whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
        | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

fn comparison(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let normalized = normalized.strip_prefix("//?/").unwrap_or(&normalized);
    let bytes = normalized.as_bytes();
    let normalized = if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        &normalized[2..]
    } else {
        normalized
    };
    let result = normalized
        .split('/')
        .map(|segment| segment.split(':').next().unwrap_or_default())
        .map(|segment| segment.trim_end_matches(|c| c == '.' || js_whitespace(c)))
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/")
        .to_lowercase();
    if normalized.starts_with('/') {
        format!("/{result}")
    } else {
        result
    }
}

pub fn readable(path: &str) -> bool {
    if path.is_empty() || path.chars().any(|c| c <= '\u{001f}') {
        return false;
    }
    let base = path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if policy()
        .patterns
        .iter()
        .any(|pattern| pattern.is_match(&base))
    {
        return false;
    }
    let comparable = format!("{}/", comparison(path));
    !policy()
        .protected
        .iter()
        .any(|dir| comparable.contains(&format!("{dir}/")))
}

pub fn writable(path: &str) -> bool {
    if !readable(path) {
        return false;
    }
    let comparable = comparison(path);
    let comparable = if comparable.starts_with('/') {
        comparable
    } else {
        format!("/{comparable}")
    };
    !policy().write_denied.iter().any(|prefix| {
        comparable.starts_with(prefix) || format!("{comparable}/").starts_with(prefix)
    })
}
