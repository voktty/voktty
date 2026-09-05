use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::OpenFlags;
use serde_json::{json, Value};

use super::session_store::{SessionRecord, SessionSummary};

/// Normalizes project paths across Windows, macOS, and Linux.
/// Strips \\?\ prefix, normalizes slashes to /, trims trailing slashes,
/// and on Windows lowercases the drive letter (e.g. C:/foo -> c:/foo).
pub fn normalize_project_path(raw: &str) -> String {
    let mut p = raw.trim();
    if let Some(stripped) = p.strip_prefix(r"\\?\") {
        p = stripped;
    }
    let mut s = p.replace('\\', "/");
    while s.ends_with('/') && s.len() > 1 {
        s.pop();
    }
    if s.len() >= 2 && s.as_bytes()[1] == b':' {
        let first = s.chars().next().unwrap().to_lowercase().to_string();
        s = format!("{}{}", first, &s[1..]);
    }
    s
}

struct CacheEntry {
    sessions: Vec<SessionSummary>,
    fetched_at: Instant,
}

static CACHE: Mutex<Option<HashMap<String, CacheEntry>>> = Mutex::new(None);
const CACHE_TTL: Duration = Duration::from_millis(2500);

fn get_cached(cwd_norm: &str) -> Option<Vec<SessionSummary>> {
    let mut guard = CACHE.lock().ok()?;
    let map = guard.as_mut()?;
    if let Some(entry) = map.get(cwd_norm) {
        if entry.fetched_at.elapsed() < CACHE_TTL {
            return Some(entry.sessions.clone());
        }
    }
    None
}

fn set_cached(cwd_norm: String, sessions: Vec<SessionSummary>) {
    if let Ok(mut guard) = CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(
            cwd_norm,
            CacheEntry {
                sessions,
                fetched_at: Instant::now(),
            },
        );
    }
}

/// Lists all external sessions (from Codex, Antigravity, Claude) belonging to target_cwd.
pub fn list_external_sessions_for_project(target_cwd: &str) -> Vec<SessionSummary> {
    let target_norm = normalize_project_path(target_cwd);
    if target_norm.is_empty() || target_norm == "~" {
        return Vec::new();
    }

    if let Some(cached) = get_cached(&target_norm) {
        return cached;
    }

    let mut sessions = Vec::new();

    // 1. Discover from Codex CLI (~/.codex/state_*.sqlite)
    if let Err(e) = scan_codex_sessions(&target_norm, target_cwd, &mut sessions) {
        log::debug!("Error scanning Codex sessions: {}", e);
    }

    // 2. Discover from Antigravity CLI (~/.gemini/antigravity-cli/brain/)
    if let Err(e) = scan_antigravity_sessions(&target_norm, target_cwd, &mut sessions) {
        log::debug!("Error scanning Antigravity sessions: {}", e);
    }

    // 3. Discover from Claude Code (~/.claude/projects/)
    if let Err(e) = scan_claude_sessions(&target_norm, target_cwd, &mut sessions) {
        log::debug!("Error scanning Claude sessions: {}", e);
    }

    // Sort by updated_at descending
    sessions.sort_by_key(|session| std::cmp::Reverse(session.updated_at));

    set_cached(target_norm, sessions.clone());
    sessions
}

/// Finds the most recent Codex state sqlite database (state_5.sqlite, state_*.sqlite).
fn find_codex_db_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let codex_dir = home.join(".codex");
    if !codex_dir.is_dir() {
        return None;
    }

    // Prefer state_5.sqlite, otherwise check state_6 down to state_1
    for i in (1..=8).rev() {
        let candidate = codex_dir.join(format!("state_{}.sqlite", i));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn scan_codex_sessions(
    target_norm: &str,
    original_cwd: &str,
    out: &mut Vec<SessionSummary>,
) -> Result<(), String> {
    let db_path = match find_codex_db_path() {
        Some(p) => p,
        None => return Ok(()),
    };

    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, rollout_path, created_at, updated_at, cwd, title, git_branch
             FROM threads
             WHERE archived = 0
             ORDER BY updated_at DESC
             LIMIT 400",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for item in rows.flatten() {
        let (id, _rollout_path, created_at, updated_at, thread_cwd, title, branch) = item;
        let thread_norm = normalize_project_path(&thread_cwd);
        if thread_norm == target_norm {
            let created = if created_at < 1_000_000_000_000 {
                created_at * 1000
            } else {
                created_at
            };
            let updated = if updated_at < 1_000_000_000_000 {
                updated_at * 1000
            } else {
                updated_at
            };

            let clean_title = if title.trim().is_empty() {
                "Codex Session".to_string()
            } else {
                title.trim().to_string()
            };

            out.push(SessionSummary {
                id: format!("ext_codex_{}", id),
                cwd: original_cwd.to_string(),
                harness: "codex".to_string(),
                model: "o3-mini".to_string(),
                runtime_mode: "supervised".to_string(),
                title: clean_title,
                provider_session_id: Some(id),
                branch: branch.filter(|b| !b.is_empty()),
                repo: None,
                additions: 0,
                deletions: 0,
                created_at: created,
                updated_at: updated,
                archived: false,
                pinned: false,
            });
        }
    }

    Ok(())
}

fn scan_antigravity_sessions(
    target_norm: &str,
    original_cwd: &str,
    out: &mut Vec<SessionSummary>,
) -> Result<(), String> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Ok(()),
    };

    let candidates = [
        home.join(".gemini").join("antigravity-cli").join("brain"),
        home.join(".gemini").join("brain"),
        home.join(".antigravity-cli").join("brain"),
    ];

    for brain_dir in candidates {
        if !brain_dir.is_dir() {
            continue;
        }

        let entries = match std::fs::read_dir(&brain_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let transcript_path = path
                .join(".system_generated")
                .join("logs")
                .join("transcript.jsonl");

            if !transcript_path.is_file() {
                continue;
            }

            let mut file = match File::open(&transcript_path) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let mut header_buf = vec![0u8; 8192];
            let bytes_read = match file.read(&mut header_buf) {
                Ok(n) => n,
                Err(_) => continue,
            };
            header_buf.truncate(bytes_read);
            let header_str = String::from_utf8_lossy(&header_buf);

            let norm_header = normalize_project_path(&header_str);
            if !norm_header.contains(target_norm) {
                continue;
            }

            let session_uuid = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            if session_uuid.is_empty() {
                continue;
            }

            let title = if let Some(start) = header_str.find("<USER_REQUEST>") {
                let rest = &header_str[start + "<USER_REQUEST>".len()..];
                let text = if let Some(end) = rest.find("</USER_REQUEST>") {
                    &rest[..end]
                } else {
                    rest.lines().next().unwrap_or(rest)
                };
                let clean = text.trim();
                if clean.len() > 90 {
                    format!("{}...", &clean[..87])
                } else if !clean.is_empty() {
                    clean.to_string()
                } else {
                    "Antigravity Session".to_string()
                }
            } else {
                "Antigravity Session".to_string()
            };

            let mtime = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or_else(now_millis);

            out.push(SessionSummary {
                id: format!("ext_gemini_{}", session_uuid),
                cwd: original_cwd.to_string(),
                harness: "gemini".to_string(),
                model: "gemini-3.8-flash".to_string(),
                runtime_mode: "supervised".to_string(),
                title,
                provider_session_id: Some(session_uuid),
                branch: None,
                repo: None,
                additions: 0,
                deletions: 0,
                created_at: mtime,
                updated_at: mtime,
                archived: false,
                pinned: false,
            });
        }
    }

    Ok(())
}

fn scan_claude_sessions(
    target_norm: &str,
    original_cwd: &str,
    out: &mut Vec<SessionSummary>,
) -> Result<(), String> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Ok(()),
    };

    let claude_dir = home.join(".claude");
    if !claude_dir.is_dir() {
        return Ok(());
    }

    let projects_dir = claude_dir.join("projects");
    if projects_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                let dir_name = path.file_name().unwrap_or_default().to_string_lossy();
                let norm_slug = normalize_project_path(&dir_name);
                if norm_slug.contains(target_norm) || target_norm.contains(&norm_slug) {
                    if let Ok(files) = std::fs::read_dir(&path) {
                        for file in files.flatten() {
                            let fpath = file.path();
                            if fpath.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                                let stem = fpath
                                    .file_stem()
                                    .map(|s| s.to_string_lossy().to_string())
                                    .unwrap_or_default();
                                let mtime = file
                                    .metadata()
                                    .and_then(|m| m.modified())
                                    .ok()
                                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                                    .map(|d| d.as_millis() as i64)
                                    .unwrap_or_else(now_millis);

                                out.push(SessionSummary {
                                    id: format!("ext_claude_{}", stem),
                                    cwd: original_cwd.to_string(),
                                    harness: "claude".to_string(),
                                    model: "claude-3-7-sonnet".to_string(),
                                    runtime_mode: "supervised".to_string(),
                                    title: "Claude Code Session".to_string(),
                                    provider_session_id: Some(stem),
                                    branch: None,
                                    repo: None,
                                    additions: 0,
                                    deletions: 0,
                                    created_at: mtime,
                                    updated_at: mtime,
                                    archived: false,
                                    pinned: false,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

/// Retrieves and formats an external session into a full SessionRecord on demand.
pub fn get_external_session_record(session_id: &str) -> Option<SessionRecord> {
    if let Some(raw_id) = session_id.strip_prefix("ext_codex_") {
        return load_codex_session_record(session_id, raw_id);
    }
    if let Some(raw_id) = session_id.strip_prefix("ext_gemini_") {
        return load_antigravity_session_record(session_id, raw_id);
    }
    if let Some(raw_id) = session_id.strip_prefix("ext_claude_") {
        return load_claude_session_record(session_id, raw_id);
    }
    None
}

fn load_codex_session_record(session_id: &str, raw_id: &str) -> Option<SessionRecord> {
    let db_path = find_codex_db_path()?;
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;

    let (rollout_path, cwd, title, created_at, updated_at, branch) = conn
        .query_row(
            "SELECT rollout_path, cwd, title, created_at, updated_at, git_branch
             FROM threads
             WHERE id = ?1",
            rusqlite::params![raw_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .ok()?;

    let mut blocks = Vec::new();
    let file = File::open(&rollout_path).ok()?;
    let reader = BufReader::new(file);

    let mut block_idx = 0;
    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let val: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if let Some(payload) = val.get("payload") {
            let role = payload
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("assistant");

            let text = if let Some(content) = payload.get("content") {
                if let Some(s) = content.as_str() {
                    s.to_string()
                } else if let Some(arr) = content.as_array() {
                    let mut parts = Vec::new();
                    for item in arr {
                        if let Some(t) = item.get("text").and_then(Value::as_str) {
                            parts.push(t);
                        }
                    }
                    parts.join("\n")
                } else {
                    String::new()
                }
            } else {
                String::new()
            };

            if !text.trim().is_empty() {
                let block_role = if role == "user" { "user" } else { "assistant" };
                blocks.push(json!({
                    "id": format!("blk_{}", block_idx),
                    "role": block_role,
                    "text": text,
                    "startedAt": updated_at * 1000,
                }));
                block_idx += 1;
            }
        }
    }

    let created = if created_at < 1_000_000_000_000 {
        created_at * 1000
    } else {
        created_at
    };
    let updated = if updated_at < 1_000_000_000_000 {
        updated_at * 1000
    } else {
        updated_at
    };

    Some(SessionRecord {
        id: session_id.to_string(),
        cwd,
        harness: "codex".to_string(),
        model: "o3-mini".to_string(),
        model_settings: json!({}),
        runtime_mode: "supervised".to_string(),
        title,
        provider_session_id: Some(raw_id.to_string()),
        blocks: Value::Array(blocks),
        context_used: None,
        context_window: None,
        branch,
        worktree_cwd: None,
        created_at: created,
        updated_at: updated,
    })
}

fn load_antigravity_session_record(session_id: &str, raw_id: &str) -> Option<SessionRecord> {
    let home = dirs::home_dir()?;
    let candidates = [
        home.join(".gemini").join("antigravity-cli").join("brain"),
        home.join(".gemini").join("brain"),
        home.join(".antigravity-cli").join("brain"),
    ];

    let mut transcript_path = None;
    for brain_dir in candidates {
        let p = brain_dir
            .join(raw_id)
            .join(".system_generated")
            .join("logs")
            .join("transcript.jsonl");
        if p.is_file() {
            transcript_path = Some(p);
            break;
        }
    }

    let file_path = transcript_path?;
    let file = File::open(&file_path).ok()?;
    let reader = BufReader::new(file);

    let mut blocks = Vec::new();
    let mut block_idx = 0;
    let mut cwd = String::new();
    let mut title = "Antigravity Session".to_string();

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let val: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let step_type = val.get("type").and_then(Value::as_str).unwrap_or("");
        let source = val.get("source").and_then(Value::as_str).unwrap_or("");
        let content_str = val.get("content").and_then(Value::as_str).unwrap_or("");

        if cwd.is_empty() {
            if let Some(idx) = content_str.find(" [URI] -> ") {
                let after = &content_str[idx + 10..];
                if let Some(line) = after.lines().next() {
                    let parts: Vec<&str> = line.split(" -> ").collect();
                    if let Some(first) = parts.first() {
                        cwd = first.trim().to_string();
                    }
                }
            }
        }

        if step_type == "USER_INPUT" || source == "USER_EXPLICIT" {
            let clean = if let Some(start) = content_str.find("<USER_REQUEST>") {
                if let Some(end) = content_str.find("</USER_REQUEST>") {
                    content_str[start + "<USER_REQUEST>".len()..end].trim()
                } else {
                    content_str.trim()
                }
            } else {
                content_str.trim()
            };

            if title == "Antigravity Session" && !clean.is_empty() {
                title = clean.chars().take(80).collect();
            }

            blocks.push(json!({
                "id": format!("blk_{}", block_idx),
                "role": "user",
                "text": clean,
                "startedAt": now_millis(),
            }));
            block_idx += 1;
        } else if step_type == "PLANNER_RESPONSE" {
            let thinking = val.get("thinking").and_then(Value::as_str);
            let display_text = if !content_str.trim().is_empty() {
                content_str
            } else {
                thinking.unwrap_or_default()
            };

            if !display_text.trim().is_empty() {
                blocks.push(json!({
                    "id": format!("blk_{}", block_idx),
                    "role": "assistant",
                    "text": display_text,
                    "startedAt": now_millis(),
                }));
                block_idx += 1;
            }
        }
    }

    let mtime = std::fs::metadata(&file_path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(now_millis);

    Some(SessionRecord {
        id: session_id.to_string(),
        cwd: if cwd.is_empty() { ".".to_string() } else { cwd },
        harness: "gemini".to_string(),
        model: "gemini-3.7-flash".to_string(),
        model_settings: json!({}),
        runtime_mode: "supervised".to_string(),
        title,
        provider_session_id: Some(raw_id.to_string()),
        blocks: Value::Array(blocks),
        context_used: None,
        context_window: None,
        branch: None,
        worktree_cwd: None,
        created_at: mtime,
        updated_at: mtime,
    })
}

fn load_claude_session_record(session_id: &str, raw_id: &str) -> Option<SessionRecord> {
    let now = now_millis();
    Some(SessionRecord {
        id: session_id.to_string(),
        cwd: ".".to_string(),
        harness: "claude".to_string(),
        model: "claude-3-7-sonnet".to_string(),
        model_settings: json!({}),
        runtime_mode: "supervised".to_string(),
        title: "Claude Code Session".to_string(),
        provider_session_id: Some(raw_id.to_string()),
        blocks: Value::Array(vec![]),
        context_used: None,
        context_window: None,
        branch: None,
        worktree_cwd: None,
        created_at: now,
        updated_at: now,
    })
}

/// Lists all distinct project directory paths discovered from external CLI agents.
pub fn list_external_projects() -> Vec<String> {
    let mut set = HashSet::new();

    if let Some(db_path) = find_codex_db_path() {
        if let Ok(conn) = rusqlite::Connection::open_with_flags(
            &db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            if let Ok(mut stmt) = conn.prepare(
                "SELECT DISTINCT cwd
                 FROM threads
                 WHERE archived = 0
                 ORDER BY updated_at DESC
                 LIMIT 40",
            ) {
                if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                    for r in rows.flatten() {
                        let norm = normalize_project_path(&r);
                        #[cfg(windows)]
                        {
                            let is_drive = norm.len() >= 2 && norm.as_bytes()[1] == b':';
                            let is_unc = norm.starts_with("//");
                            if !is_drive && !is_unc {
                                continue;
                            }
                        }
                        if !norm.is_empty() && norm != "~" {
                            set.insert(norm);
                        }
                    }
                }
            }
        }
    }

    set.into_iter().collect()
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
