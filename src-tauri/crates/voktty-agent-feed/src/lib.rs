//! Read-only feed of the messages Claude Code sessions send each other.
//!
//! Claude Code records a cross-session message twice: as a `SendMessage`
//! tool call in the sender's transcript and as a `<cross-session-message>`
//! user turn in the receiver's transcript. Live sessions are listed in
//! `<claude home>/sessions/<pid>.json`. This crate reads only those JSON
//! files and the `.jsonl` transcripts of the project, never the messaging
//! keys (`*.key`) or sockets, and returns raw records. Pairing, naming and
//! the timeline are built by the client.
//!
//! The same code runs in the desktop host for local projects and in the
//! remote helper for SSH projects, so the cursor is owned by the caller and
//! the reader keeps no state between polls.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Most transcript files followed by one poll.
pub const MAX_FILES: usize = 48;
/// Most bytes read from one transcript in one poll.
pub const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;
/// Most bytes read across all transcripts in one poll.
pub const MAX_POLL_BYTES: u64 = 24 * 1024 * 1024;
/// Most records returned by one poll.
pub const MAX_RECORDS: usize = 1_000;
/// Longest message text returned, in characters.
pub const MAX_TEXT_CHARS: usize = 8_000;
/// Most live session files inspected.
pub const MAX_SESSION_FILES: usize = 256;
/// Largest live session file accepted.
const MAX_SESSION_FILE_BYTES: u64 = 64 * 1024;
const MAX_CURSOR_FILES: usize = 128;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedCursor {
    /// Byte offset already consumed, keyed by `<project dir>/<session>.jsonl`.
    #[serde(default)]
    pub files: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedRequest {
    /// Project folder the team works in, as the session's cwd would be.
    pub root: String,
    /// Ignore transcripts not modified since this time (Unix ms).
    pub since_ms: i64,
    #[serde(default)]
    pub cursor: Option<FeedCursor>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSession {
    pub pid: u32,
    pub session_id: String,
    pub name: Option<String>,
    pub cwd: Option<String>,
    pub status: Option<String>,
    pub tmux: Option<String>,
    pub version: Option<String>,
    pub updated_at: Option<i64>,
    /// `Some(false)` when the process is known to be gone.
    pub alive: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSpan {
    pub session_id: String,
    pub first_ts: Option<String>,
    pub last_ts: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordKind {
    /// `SendMessage` to another session.
    Send,
    /// `<cross-session-message>` received from another session.
    Recv,
    /// Text the agent wrote for the human (progress notes, conclusions).
    Note,
    /// A prompt the human typed to the agent.
    Human,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedRecord {
    pub id: String,
    pub kind: RecordKind,
    pub ts: String,
    /// Session whose transcript holds the record.
    pub session_id: String,
    /// Recipient as written by the sender, or the sender's name on receipt.
    /// Empty for notes and human prompts.
    pub peer: String,
    /// Process id when the peer is addressed by its messaging socket.
    pub peer_pid: Option<u32>,
    pub summary: Option<String>,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedResponse {
    /// False when the Claude Code home folder does not exist.
    pub available: bool,
    pub sessions: Vec<LiveSession>,
    pub transcripts: Vec<TranscriptSpan>,
    pub records: Vec<FeedRecord>,
    pub cursor: FeedCursor,
    /// More data is waiting; poll again with the returned cursor.
    pub truncated: bool,
    /// Rows that mention cross-session messaging but could not be read.
    pub unrecognized: u32,
}

/// Claude Code's home folder: `CLAUDE_CONFIG_DIR`, else `<home>/.claude`.
pub fn claude_home(config_dir: Option<&str>, home: &Path) -> PathBuf {
    match config_dir.map(str::trim).filter(|dir| !dir.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => home.join(".claude"),
    }
}

/// The folder name Claude Code gives a project: every character outside
/// `[A-Za-z0-9]` becomes `-`.
pub fn project_dir_name(path: &str) -> String {
    let trimmed = path.trim_end_matches(['/', '\\']);
    let source = if trimmed.is_empty() { path } else { trimmed };
    source
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

fn related_dir(dir: &str, root_dir: &str) -> bool {
    !root_dir.is_empty()
        && (dir == root_dir
            || dir
                .strip_prefix(root_dir)
                .is_some_and(|rest| rest.starts_with('-')))
}

fn safe_component(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\'])
        && name.len() <= 255
}

fn is_plain_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_file())
}

fn is_plain_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_dir())
}

fn modified_ms(path: &Path) -> Option<i64> {
    let modified = fs::symlink_metadata(path).ok()?.modified().ok()?;
    let ms = modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis();
    i64::try_from(ms).ok()
}

fn str_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

fn process_alive(pid: u32) -> Option<bool> {
    if cfg!(target_os = "linux") {
        Some(Path::new("/proc").join(pid.to_string()).exists())
    } else {
        None
    }
}

/// Live sessions from `<claude home>/sessions/<pid>.json`. Only files named
/// by a numeric pid with a `.json` extension are read.
pub fn read_live_sessions(claude_home: &Path) -> Vec<LiveSession> {
    let dir = claude_home.join("sessions");
    if !is_plain_dir(&dir) {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut sessions = Vec::new();
    for entry in entries.flatten().take(MAX_SESSION_FILES * 4) {
        if sessions.len() >= MAX_SESSION_FILES {
            break;
        }
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        let Some(stem) = name.strip_suffix(".json") else {
            continue;
        };
        if stem.is_empty() || !stem.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let Ok(pid) = stem.parse::<u32>() else {
            continue;
        };
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !meta.file_type().is_file() || meta.len() > MAX_SESSION_FILE_BYTES {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let Some(session_id) = str_field(&value, "sessionId") else {
            continue;
        };
        sessions.push(LiveSession {
            pid,
            session_id,
            name: str_field(&value, "name"),
            cwd: str_field(&value, "cwd"),
            status: str_field(&value, "status"),
            tmux: str_field(&value, "tmux"),
            version: str_field(&value, "version"),
            updated_at: value.get("updatedAt").and_then(Value::as_i64),
            alive: process_alive(pid),
        });
    }
    sessions.sort_by_key(|s| s.pid);
    sessions
}

fn truncate_text(text: &str) -> (String, bool) {
    if text.chars().count() <= MAX_TEXT_CHARS {
        return (text.to_string(), false);
    }
    (text.chars().take(MAX_TEXT_CHARS).collect(), true)
}

/// `uds:/run/user/0/cc-socks/2607137.sock` -> `2607137`.
pub fn socket_pid(address: &str) -> Option<u32> {
    let file = address.rsplit(['/', '\\']).next()?;
    file.strip_suffix(".sock")?.parse().ok()
}

/// `orquestador [09434a]` -> `orquestador`.
fn clean_recipient(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(open) = trimmed.rfind(" [") {
        let tail = &trimmed[open + 2..];
        if let Some(id) = tail.strip_suffix(']') {
            if !id.is_empty() && id.bytes().all(|b| b.is_ascii_hexdigit()) {
                return trimmed[..open].trim().to_string();
            }
        }
    }
    trimmed.to_string()
}

fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!("{name}=\"");
    let mut search = 0;
    while let Some(found) = tag[search..].find(&needle) {
        let start = search + found;
        let boundary = start == 0 || tag.as_bytes()[start - 1].is_ascii_whitespace();
        let value_start = start + needle.len();
        if boundary {
            let end = tag[value_start..].find('"')?;
            return Some(&tag[value_start..value_start + end]);
        }
        search = value_start;
    }
    None
}

struct Inbound {
    from_name: String,
    from_pid: Option<u32>,
    text: String,
}

/// Every `<cross-session-message ...>text</cross-session-message>` in a turn.
fn parse_inbound(text: &str) -> (Vec<Inbound>, u32) {
    const OPEN: &str = "<cross-session-message";
    const CLOSE: &str = "</cross-session-message>";
    let mut found = Vec::new();
    let mut bad = 0;
    let mut rest = text;
    while let Some(start) = rest.find(OPEN) {
        let after = &rest[start + OPEN.len()..];
        let Some(tag_end) = after.find('>') else {
            bad += 1;
            break;
        };
        let tag = &after[..tag_end];
        let body_and_more = &after[tag_end + 1..];
        let (body, next) = match body_and_more.find(CLOSE) {
            Some(close) => (
                &body_and_more[..close],
                &body_and_more[close + CLOSE.len()..],
            ),
            None => (body_and_more, ""),
        };
        match attribute(tag, "from-name") {
            Some(name) if !name.trim().is_empty() => found.push(Inbound {
                from_name: name.trim().to_string(),
                from_pid: attribute(tag, "from").and_then(socket_pid),
                text: body.trim().to_string(),
            }),
            _ => bad += 1,
        }
        rest = next;
    }
    (found, bad)
}

fn content_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn value_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.clone()),
        Value::Null => None,
        other => Some(content_text(other)).filter(|s| !s.is_empty()),
    }
}

/// Slash commands and their echoed output, not words for the agent.
fn is_command_wrapper(text: &str) -> bool {
    ["<command-", "<local-command", "<system-reminder", "<bash-"]
        .iter()
        .any(|prefix| text.starts_with(prefix))
}

fn timestamp_of(line: &str) -> Option<String> {
    const KEY: &str = "\"timestamp\":\"";
    let start = line.find(KEY)? + KEY.len();
    let end = line[start..].find('"')?;
    Some(line[start..start + end].to_string())
}

/// Records found in one transcript line.
fn parse_line(line: &str, session_id: &str, offset: u64) -> (Vec<FeedRecord>, u32) {
    let mentions_send = line.contains("\"SendMessage\"");
    let mentions_recv = line.contains("cross-session-message");
    let mentions_text = line.contains("\"type\":\"text\"");
    let mentions_human = line.contains("\"kind\":\"human\"");
    if !mentions_send && !mentions_recv && !mentions_text && !mentions_human {
        return (Vec::new(), 0);
    }
    let Ok(row) = serde_json::from_str::<Value>(line) else {
        return (Vec::new(), 1);
    };
    let ts = str_field(&row, "timestamp").unwrap_or_default();
    let row_id = str_field(&row, "uuid").unwrap_or_else(|| format!("{session_id}:{offset}"));
    let Some(content) = row.get("message").and_then(|m| m.get("content")) else {
        return (Vec::new(), 0);
    };
    if row.get("isSidechain").and_then(Value::as_bool) == Some(true) {
        return (Vec::new(), 0);
    }
    let origin = row
        .get("origin")
        .and_then(|o| o.get("kind"))
        .and_then(Value::as_str);
    let mut records = Vec::new();
    let mut bad = 0;
    match row.get("type").and_then(Value::as_str) {
        Some("assistant") => {
            for (index, block) in content.as_array().into_iter().flatten().enumerate() {
                if block.get("type").and_then(Value::as_str) == Some("text") {
                    let body = block
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    if body.is_empty() {
                        continue;
                    }
                    let (text, truncated) = truncate_text(body);
                    records.push(FeedRecord {
                        id: format!("{row_id}:note:{index}"),
                        kind: RecordKind::Note,
                        ts: ts.clone(),
                        session_id: session_id.to_string(),
                        peer: String::new(),
                        peer_pid: None,
                        summary: None,
                        text,
                        truncated,
                    });
                    continue;
                }
                if block.get("type").and_then(Value::as_str) != Some("tool_use")
                    || block.get("name").and_then(Value::as_str) != Some("SendMessage")
                {
                    continue;
                }
                let input = block.get("input").unwrap_or(&Value::Null);
                let recipient = value_text(input.get("to"))
                    .or_else(|| value_text(input.get("recipient")))
                    .unwrap_or_default();
                let body = value_text(input.get("message"))
                    .or_else(|| value_text(input.get("content")))
                    .unwrap_or_default();
                if recipient.trim().is_empty() {
                    bad += 1;
                    continue;
                }
                let (text, truncated) = truncate_text(body.trim());
                records.push(FeedRecord {
                    id: str_field(block, "id").unwrap_or_else(|| format!("{row_id}:{index}")),
                    kind: RecordKind::Send,
                    ts: ts.clone(),
                    session_id: session_id.to_string(),
                    peer_pid: socket_pid(&recipient),
                    peer: clean_recipient(&recipient),
                    summary: value_text(input.get("summary"))
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty()),
                    text,
                    truncated,
                });
            }
        }
        Some("user") if origin == Some("human") => {
            let body = content_text(content);
            let body = body.trim();
            if !body.is_empty() && !is_command_wrapper(body) {
                let (text, truncated) = truncate_text(body);
                records.push(FeedRecord {
                    id: format!("{row_id}:human"),
                    kind: RecordKind::Human,
                    ts: ts.clone(),
                    session_id: session_id.to_string(),
                    peer: String::new(),
                    peer_pid: None,
                    summary: None,
                    text,
                    truncated,
                });
            }
        }
        Some("user") if mentions_recv => {
            let (inbound, malformed) = parse_inbound(&content_text(content));
            bad += malformed;
            for (index, message) in inbound.into_iter().enumerate() {
                let (text, truncated) = truncate_text(&message.text);
                records.push(FeedRecord {
                    id: format!("{row_id}:recv:{index}"),
                    kind: RecordKind::Recv,
                    ts: ts.clone(),
                    session_id: session_id.to_string(),
                    peer: message.from_name,
                    peer_pid: message.from_pid,
                    summary: None,
                    text,
                    truncated,
                });
            }
        }
        _ => {}
    }
    (records, bad)
}

struct FileRead {
    records: Vec<FeedRecord>,
    end: u64,
    first_ts: Option<String>,
    last_ts: Option<String>,
    unrecognized: u32,
    more: bool,
}

/// Reads complete lines from `start` up to the byte or record limits.
fn read_transcript(
    path: &Path,
    session_id: &str,
    start: u64,
    budget: usize,
    limit: u64,
) -> std::io::Result<FileRead> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let mut start = if start > len { 0 } else { start };
    // On a first read of a large transcript, keep only its tail.
    let skip_partial = start == 0 && len > limit;
    if skip_partial {
        start = len - limit;
    }
    file.seek(SeekFrom::Start(start))?;
    let mut buffer = Vec::new();
    file.take(limit).read_to_end(&mut buffer)?;
    let mut cursor = 0usize;
    if skip_partial {
        match buffer.iter().position(|&b| b == b'\n') {
            Some(newline) => cursor = newline + 1,
            None => cursor = buffer.len(),
        }
    }
    let mut read = FileRead {
        records: Vec::new(),
        end: start + cursor as u64,
        first_ts: None,
        last_ts: None,
        unrecognized: 0,
        more: false,
    };
    while cursor < buffer.len() {
        let Some(newline) = buffer[cursor..].iter().position(|&b| b == b'\n') else {
            break;
        };
        let line_end = cursor + newline;
        let line = String::from_utf8_lossy(&buffer[cursor..line_end]);
        let offset = start + cursor as u64;
        if let Some(ts) = timestamp_of(&line) {
            if read.first_ts.is_none() {
                read.first_ts = Some(ts.clone());
            }
            read.last_ts = Some(ts);
        }
        let (records, bad) = parse_line(&line, session_id, offset);
        if read.records.len() + records.len() > budget && !read.records.is_empty() {
            read.more = true;
            break;
        }
        read.records.extend(records);
        read.unrecognized += bad;
        cursor = line_end + 1;
        read.end = start + cursor as u64;
    }
    if start + (buffer.len() as u64) < len {
        read.more = true;
    }
    Ok(read)
}

fn transcript_key(dir: &str, session_id: &str) -> String {
    format!("{dir}/{session_id}.jsonl")
}

fn split_key(key: &str) -> Option<(&str, &str)> {
    let (dir, file) = key.split_once('/')?;
    let session = file.strip_suffix(".jsonl")?;
    (safe_component(dir) && safe_component(session)).then_some((dir, session))
}

/// One read of the project's agent messages. Pure apart from filesystem
/// reads under `claude_home`; returns the next cursor.
pub fn poll(claude_home: &Path, request: &FeedRequest) -> FeedResponse {
    let mut response = FeedResponse {
        available: is_plain_dir(claude_home),
        ..FeedResponse::default()
    };
    if !response.available {
        return response;
    }
    let root_dir = project_dir_name(&request.root);
    let projects = claude_home.join("projects");
    let previous = request.cursor.clone().unwrap_or_default();
    let all_sessions = read_live_sessions(claude_home);

    // Files to follow: the cursor's, the project's folders, then live
    // sessions that talk to the project's agents.
    let mut files: BTreeSet<String> = previous
        .files
        .keys()
        .filter(|key| split_key(key).is_some())
        .cloned()
        .collect();
    if is_plain_dir(&projects) {
        if let Ok(dirs) = fs::read_dir(&projects) {
            for dir in dirs.flatten() {
                let Some(dir_name) = dir.file_name().to_str().map(str::to_string) else {
                    continue;
                };
                if !related_dir(&dir_name, &root_dir) || !is_plain_dir(&dir.path()) {
                    continue;
                }
                let Ok(entries) = fs::read_dir(dir.path()) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
                        continue;
                    };
                    let Some(session) = file_name.strip_suffix(".jsonl") else {
                        continue;
                    };
                    let path = entry.path();
                    if !safe_component(session) || !is_plain_file(&path) {
                        continue;
                    }
                    if modified_ms(&path).is_some_and(|ms| ms >= request.since_ms) {
                        files.insert(transcript_key(&dir_name, session));
                    }
                }
            }
        }
    }

    let mut related_sessions: BTreeSet<String> = files
        .iter()
        .filter_map(|key| split_key(key).map(|(_, s)| s.to_string()))
        .collect();
    let mut peer_names: BTreeSet<String> = BTreeSet::new();
    let mut peer_pids: BTreeSet<u32> = BTreeSet::new();
    let mut next = FeedCursor::default();
    let mut spans = Vec::new();

    let mut bytes_left = MAX_POLL_BYTES;
    let read_file = |key: &str,
                     response: &mut FeedResponse,
                     next: &mut FeedCursor,
                     spans: &mut Vec<TranscriptSpan>,
                     peer_names: &mut BTreeSet<String>,
                     peer_pids: &mut BTreeSet<u32>,
                     bytes_left: &mut u64| {
        let Some((dir, session)) = split_key(key) else {
            return;
        };
        let path = projects.join(dir).join(format!("{session}.jsonl"));
        if !is_plain_file(&path) {
            return;
        }
        let start = previous.files.get(key).copied().unwrap_or(0);
        let budget = MAX_RECORDS.saturating_sub(response.records.len());
        if budget == 0 || *bytes_left == 0 {
            next.files.insert(key.to_string(), start);
            response.truncated = true;
            return;
        }
        let limit = (*bytes_left).min(MAX_READ_BYTES);
        let Ok(read) = read_transcript(&path, session, start, budget, limit) else {
            return;
        };
        *bytes_left = bytes_left.saturating_sub(read.end.saturating_sub(start).max(1));
        let since = request.since_ms;
        for record in read.records {
            if !record.peer.is_empty() {
                peer_names.insert(record.peer.clone());
            }
            if let Some(pid) = record.peer_pid {
                peer_pids.insert(pid);
            }
            if start == 0 && since > 0 && record_ms(&record.ts).is_some_and(|ms| ms < since) {
                continue;
            }
            response.records.push(record);
        }
        response.unrecognized += read.unrecognized;
        response.truncated |= read.more;
        next.files.insert(key.to_string(), read.end);
        spans.push(TranscriptSpan {
            session_id: session.to_string(),
            first_ts: if start == 0 { read.first_ts } else { None },
            last_ts: read.last_ts,
        });
    };

    for key in files.iter().take(MAX_FILES) {
        read_file(
            key,
            &mut response,
            &mut next,
            &mut spans,
            &mut peer_names,
            &mut peer_pids,
            &mut bytes_left,
        );
    }

    // Live sessions outside the project folders that exchange messages
    // with it (an orchestrator started in a parent folder, for example).
    let mut followed = files.len().min(MAX_FILES);
    for session in &all_sessions {
        if related_sessions.contains(&session.session_id) {
            continue;
        }
        let named = session
            .name
            .as_ref()
            .is_some_and(|n| peer_names.contains(n));
        if !named && !peer_pids.contains(&session.pid) {
            continue;
        }
        let Some(cwd) = session.cwd.as_deref() else {
            continue;
        };
        if followed >= MAX_FILES || !safe_component(&session.session_id) {
            break;
        }
        let key = transcript_key(&project_dir_name(cwd), &session.session_id);
        if split_key(&key).is_none() {
            continue;
        }
        related_sessions.insert(session.session_id.clone());
        followed += 1;
        read_file(
            &key,
            &mut response,
            &mut next,
            &mut spans,
            &mut peer_names,
            &mut peer_pids,
            &mut bytes_left,
        );
    }

    if next.files.len() > MAX_CURSOR_FILES {
        let keep: BTreeMap<String, u64> = next
            .files
            .iter()
            .rev()
            .take(MAX_CURSOR_FILES)
            .map(|(k, v)| (k.clone(), *v))
            .collect();
        next.files = keep;
    }

    response.sessions = all_sessions
        .into_iter()
        .filter(|s| {
            related_sessions.contains(&s.session_id)
                || s.name.as_ref().is_some_and(|n| peer_names.contains(n))
                || peer_pids.contains(&s.pid)
                || s.cwd
                    .as_deref()
                    .is_some_and(|cwd| related_dir(&project_dir_name(cwd), &root_dir))
        })
        .collect();
    response
        .records
        .sort_by(|a, b| a.ts.cmp(&b.ts).then(a.id.cmp(&b.id)));
    response.transcripts = spans;
    response.cursor = next;
    response
}

/// Milliseconds of an RFC 3339 UTC timestamp such as `2026-11-11T12:53:41.123Z`.
pub fn record_ms(ts: &str) -> Option<i64> {
    let bytes = ts.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let num = |range: std::ops::Range<usize>| -> Option<i64> { ts.get(range)?.parse().ok() };
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, minute, second) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let millis = if bytes.get(19) == Some(&b'.') {
        let digits: String = ts[20..].chars().take_while(char::is_ascii_digit).collect();
        let padded = format!("{digits:0<3}");
        padded.get(0..3)?.parse().ok()?
    } else {
        0
    };
    // Days from civil, Howard Hinnant's algorithm.
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + millis)
}

#[cfg(test)]
mod tests;
