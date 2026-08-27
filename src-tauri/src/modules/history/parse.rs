// Pure parsing + ranking for shell history. No I/O here so the formats stay
// unit-tested. zsh metafies bytes >= 0x80 in its histfile (Meta 0x83 followed
// by byte ^ 0x20); callers demetafy raw bytes before handing us a string.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HistEntry {
    pub cmd: String,
    pub count: u32,
    pub last: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

const META: u8 = 0x83;

pub fn normalize_shell_type(st: &str) -> &str {
    let lower = st.trim().to_ascii_lowercase();
    if lower.contains("pwsh") || lower.contains("powershell") {
        "powershell"
    } else if lower.contains("cmd") {
        "cmd"
    } else if lower.contains("bash")
        || lower.contains("zsh")
        || lower.contains("sh")
        || lower.contains("fish")
        || lower.contains("ssh")
        || lower.contains("linux")
        || lower.contains("wsl")
        || lower.contains("docker")
    {
        "unix"
    } else {
        "generic"
    }
}

pub fn demetafy(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == META && i + 1 < bytes.len() {
            out.push(bytes[i + 1] ^ 0x20);
            i += 2;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    out
}

// zsh writes a multi-line command as physical lines joined by a trailing
// backslash; an even count of trailing backslashes is a literal, not a join.
fn join_continuations(content: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut cur = String::new();
    for line in content.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let trailing = line.bytes().rev().take_while(|&b| b == b'\\').count();
        if trailing % 2 == 1 {
            cur.push_str(&line[..line.len() - 1]);
            cur.push('\n');
        } else {
            cur.push_str(line);
            lines.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    lines
}

fn push_cmd(
    out: &mut Vec<(String, i64, Option<String>)>,
    cmd: &str,
    ts: i64,
    shell_type: Option<&str>,
) {
    let c = cmd.trim();
    if !c.is_empty() {
        out.push((c.to_string(), ts, shell_type.map(|s| s.to_string())));
    }
}

pub fn parse_zsh(content: &str) -> Vec<(String, i64, Option<String>)> {
    let mut out = Vec::new();
    for line in join_continuations(content) {
        let line = line.trim_end_matches('\n');
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix(": ") {
            if let Some(semi) = rest.find(';') {
                let ts = rest[..semi]
                    .split(':')
                    .next()
                    .and_then(|s| s.trim().parse::<i64>().ok())
                    .unwrap_or(0);
                push_cmd(&mut out, &rest[semi + 1..], ts, Some("zsh"));
                continue;
            }
        }
        push_cmd(&mut out, line, 0, Some("zsh"));
    }
    out
}

pub fn parse_bash(content: &str) -> Vec<(String, i64, Option<String>)> {
    let mut out = Vec::new();
    let mut ts = 0i64;
    for line in content.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            continue;
        }
        if let Some(num) = line.strip_prefix('#') {
            if let Ok(t) = num.trim().parse::<i64>() {
                ts = t;
                continue;
            }
        }
        push_cmd(&mut out, line, ts, Some("bash"));
        ts = 0;
    }
    out
}

fn unescape_fish(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('\\') => out.push('\\'),
                Some(other) => out.push(other),
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub fn parse_fish(content: &str) -> Vec<(String, i64, Option<String>)> {
    let mut out = Vec::new();
    let mut pending: Option<String> = None;
    for line in content.split('\n') {
        if let Some(cmd) = line.strip_prefix("- cmd: ") {
            if let Some(p) = pending.take() {
                push_cmd(&mut out, &p, 0, Some("fish"));
            }
            pending = Some(unescape_fish(cmd));
        } else if let Some(when) = line.trim().strip_prefix("when: ") {
            if let Some(cmd) = pending.take() {
                let ts = when.trim().parse::<i64>().unwrap_or(0);
                push_cmd(&mut out, &cmd, ts, Some("fish"));
            }
        }
    }
    if let Some(p) = pending.take() {
        push_cmd(&mut out, &p, 0, Some("fish"));
    }
    out
}

pub fn parse_powershell(content: &str) -> Vec<(String, i64, Option<String>)> {
    let mut out = Vec::new();
    let mut idx = 1i64;
    for line in content.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line).trim();
        if !line.is_empty() {
            out.push((line.to_string(), idx, Some("powershell".to_string())));
            idx += 1;
        }
    }
    out
}

pub fn build_index(entries: Vec<(String, i64, Option<String>)>) -> Vec<HistEntry> {
    use std::collections::HashMap;
    let mut map: HashMap<String, HistEntry> = HashMap::new();
    for (cmd, ts, shell_type) in entries {
        let e = map.entry(cmd.clone()).or_insert_with(|| HistEntry {
            cmd,
            count: 0,
            last: 0,
            shell_type: shell_type.clone(),
            category: None,
        });
        e.count += 1;
        if ts > e.last {
            e.last = ts;
        }
        if e.shell_type.is_none() && shell_type.is_some() {
            e.shell_type = shell_type;
        }
    }
    let mut v: Vec<HistEntry> = map.into_values().collect();
    sort_recent(&mut v);
    v
}

pub fn sort_recent(v: &mut [HistEntry]) {
    v.sort_by(|a, b| b.last.cmp(&a.last).then(b.count.cmp(&a.count)));
}

// fish-style autosuggestion: the most recent full command that extends `line`.
pub fn suggest(index: &[HistEntry], line: &str, shell_type: Option<&str>) -> Option<String> {
    if line.is_empty() {
        return None;
    }
    let norm_req = shell_type.map(normalize_shell_type);

    if let Some(target_type) = norm_req {
        let matched = index
            .iter()
            .filter(|e| {
                e.cmd.len() > line.len()
                    && e.cmd.starts_with(line)
                    && (e.shell_type.as_deref().map(normalize_shell_type) == Some(target_type)
                        || e.shell_type.is_none())
            })
            .max_by(|a, b| a.last.cmp(&b.last).then(a.count.cmp(&b.count)));
        if let Some(found) = matched {
            return Some(found.cmd.clone());
        }
    }

    index
        .iter()
        .filter(|e| e.cmd.len() > line.len() && e.cmd.starts_with(line))
        .max_by(|a, b| a.last.cmp(&b.last).then(a.count.cmp(&b.count)))
        .map(|e| e.cmd.clone())
}

// Command-name list for the current token: history first-words (by frequency)
// first, then PATH executables (alphabetical), deduped.
pub fn complete_commands(
    index: &[HistEntry],
    path_cmds: &[String],
    prefix: &str,
    limit: usize,
) -> Vec<String> {
    use std::collections::{HashMap, HashSet};
    let mut freq: HashMap<&str, u32> = HashMap::new();
    for e in index {
        let w = e.cmd.split_whitespace().next().unwrap_or("");
        if !w.is_empty() && w.starts_with(prefix) {
            *freq.entry(w).or_insert(0) += e.count;
        }
    }
    let mut hist_words: Vec<(&str, u32)> = freq.into_iter().collect();
    hist_words.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));

    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for (w, _) in hist_words {
        if seen.insert(w.to_string()) {
            out.push(w.to_string());
            if out.len() >= limit {
                return out;
            }
        }
    }
    let mut paths: Vec<&String> = path_cmds.iter().filter(|c| c.starts_with(prefix)).collect();
    paths.sort();
    for c in paths {
        if seen.insert(c.clone()) {
            out.push(c.clone());
            if out.len() >= limit {
                break;
            }
        }
    }
    out
}

// Recency-ranked, deduped commands for the Ctrl-R style popover.
#[allow(dead_code)]
pub fn list(index: &[HistEntry], query: &str, limit: usize) -> Vec<String> {
    let q = query.trim().to_lowercase();
    let mut out = Vec::new();
    for e in index {
        if q.is_empty() || e.cmd.to_lowercase().contains(&q) {
            out.push(e.cmd.clone());
            if out.len() >= limit {
                break;
            }
        }
    }
    out
}

// Detailed list of history entries for the Command History Modal with scoring and shell filtering.
pub fn list_entries(
    index: &[HistEntry],
    query: &str,
    shell_type: Option<&str>,
    limit: usize,
) -> Vec<HistEntry> {
    let q = query.trim().to_lowercase();
    let norm_st = shell_type
        .filter(|s| !s.is_empty() && *s != "all")
        .map(normalize_shell_type);
    let mut matching: Vec<(&HistEntry, i64)> = Vec::new();

    for e in index {
        let cmd_lower = e.cmd.to_lowercase();
        if !q.is_empty() && !cmd_lower.contains(&q) {
            continue;
        }

        if let Some(target_type) = norm_st {
            let entry_type = e.shell_type.as_deref().map(normalize_shell_type);
            if let Some(et) = entry_type {
                if et != target_type && et != "generic" {
                    continue;
                }
            }
        }

        let mut score = (e.last / 3600) + (e.count as i64 * 10);
        if cmd_lower.starts_with(&q) {
            score += 10_000;
        }
        if e.cmd == query {
            score += 50_000;
        }

        matching.push((e, score));
    }

    matching.sort_by(|a, b| b.1.cmp(&a.1).then(b.0.last.cmp(&a.0.last)));
    matching
        .into_iter()
        .take(limit)
        .map(|(e, _)| e.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zsh_extended_and_plain() {
        let c = ": 1700000000:0;git status\nls -la\n: 1700000005:2;echo hi;there\n";
        let got = parse_zsh(c);
        assert_eq!(
            got,
            vec![
                ("git status".into(), 1700000000, Some("zsh".into())),
                ("ls -la".into(), 0, Some("zsh".into())),
                ("echo hi;there".into(), 1700000005, Some("zsh".into())),
            ]
        );
    }

    #[test]
    fn zsh_multiline_continuation() {
        let c = ": 1:0;for i in 1 2; do\\\necho $i\\\ndone\n";
        let got = parse_zsh(c);
        assert_eq!(got.len(), 1);
        assert!(got[0].0.contains("for i in 1 2"));
        assert!(got[0].0.contains("echo $i"));
    }

    #[test]
    fn bash_with_and_without_timestamps() {
        let c = "#1700000000\ngit push\nls\n";
        let got = parse_bash(c);
        assert_eq!(
            got,
            vec![
                ("git push".into(), 1700000000, Some("bash".into())),
                ("ls".into(), 0, Some("bash".into()))
            ]
        );
    }

    #[test]
    fn fish_format() {
        let c =
            "- cmd: git commit -m \\\"x\\\"\n  when: 1700000000\n- cmd: ls\n  when: 1700000001\n";
        let got = parse_fish(c);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].1, 1700000000);
        assert_eq!(got[1].0, "ls");
    }

    #[test]
    fn powershell_format() {
        let c = "git status\nGet-Process\npnpm dev\n";
        let got = parse_powershell(c);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].0, "git status");
        assert_eq!(got[1].0, "Get-Process");
        assert_eq!(got[2].0, "pnpm dev");
    }

    #[test]
    fn demetafy_restores_high_bytes() {
        let input = [b'a', META, b'A', b'b'];
        assert_eq!(demetafy(&input), vec![b'a', b'A' ^ 0x20, b'b']);
    }

    #[test]
    fn build_index_dedups_and_counts() {
        let idx = build_index(vec![
            ("ls".into(), 10, None),
            ("git st".into(), 20, None),
            ("ls".into(), 30, None),
        ]);
        let ls = idx.iter().find(|e| e.cmd == "ls").unwrap();
        assert_eq!(ls.count, 2);
        assert_eq!(ls.last, 30);
        assert_eq!(idx[0].cmd, "ls");
    }

    #[test]
    fn suggest_picks_most_recent_match() {
        let idx = build_index(vec![
            ("git status".into(), 10, None),
            ("git stash".into(), 99, None),
            ("git push".into(), 50, None),
        ]);
        assert_eq!(suggest(&idx, "git st", None), Some("git stash".into()));
        assert_eq!(suggest(&idx, "git status", None), None);
        assert_eq!(suggest(&idx, "", None), None);
    }

    #[test]
    fn list_filters_by_query_recent_first() {
        let idx = build_index(vec![
            ("git status".into(), 10, None),
            ("npm install".into(), 30, None),
            ("git push".into(), 20, None),
        ]);
        assert_eq!(list(&idx, "", 10)[0], "npm install");
        assert_eq!(
            list(&idx, "GIT", 10),
            vec!["git push".to_string(), "git status".to_string()]
        );
    }

    #[test]
    fn list_entries_supports_shell_type_filter() {
        let idx = vec![
            HistEntry {
                cmd: "Get-Process".into(),
                count: 5,
                last: 100,
                shell_type: Some("powershell".into()),
                category: None,
            },
            HistEntry {
                cmd: "ls -la".into(),
                count: 5,
                last: 200,
                shell_type: Some("bash".into()),
                category: None,
            },
        ];
        let ps = list_entries(&idx, "", Some("powershell"), 10);
        assert_eq!(ps.len(), 1);
        assert_eq!(ps[0].cmd, "Get-Process");

        let unix = list_entries(&idx, "", Some("linux"), 10);
        assert_eq!(unix.len(), 1);
        assert_eq!(unix[0].cmd, "ls -la");
    }
}
