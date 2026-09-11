pub mod adapters;
pub mod db;
pub mod indexer;
pub mod models;
pub mod sanitizer;

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::State;

use models::{HistoryMessage, HistoryMessagePage, HistorySession, HistoryStats, SessionFilter};
use wake_core::adapters::{adapter_for, create_adapters, AgentAdapter};
use wake_core::db::{open_or_rebuild, Store};
use wake_core::models::{AgentId, SessionFileRef, SessionFilter as WakeSessionFilter, SessionMeta};
use wake_core::scanner::{run_scan, NullEvents};

pub struct AgentHistoryState {
    db_path: PathBuf,
    store: OnceLock<Result<Arc<Store>, String>>,
    adapters: OnceLock<Vec<Box<dyn AgentAdapter>>>,
    pub is_scanning: Arc<AtomicBool>,
    transcripts: Mutex<TranscriptCache>,
}

const TRANSCRIPT_CACHE_MAX_ENTRIES: usize = 8;
const TRANSCRIPT_CACHE_MAX_BYTES: usize = 32 * 1024 * 1024;

struct TranscriptCacheEntry {
    key: String,
    messages: Arc<Vec<HistoryMessage>>,
    bytes: usize,
}
struct TranscriptCache {
    entries: VecDeque<TranscriptCacheEntry>,
    bytes: usize,
}

impl TranscriptCache {
    fn get(&mut self, key: &str) -> Option<Arc<Vec<HistoryMessage>>> {
        let index = self.entries.iter().position(|entry| entry.key == key)?;
        let entry = self.entries.remove(index)?;
        let messages = entry.messages.clone();
        self.entries.push_front(entry);
        Some(messages)
    }
    fn insert(&mut self, key: String, messages: Arc<Vec<HistoryMessage>>, bytes: usize) {
        if bytes > TRANSCRIPT_CACHE_MAX_BYTES {
            return;
        }
        if let Some(index) = self.entries.iter().position(|entry| entry.key == key) {
            if let Some(entry) = self.entries.remove(index) {
                self.bytes = self.bytes.saturating_sub(entry.bytes);
            }
        }
        self.bytes += bytes;
        self.entries.push_front(TranscriptCacheEntry {
            key,
            messages,
            bytes,
        });
        while self.entries.len() > TRANSCRIPT_CACHE_MAX_ENTRIES
            || self.bytes > TRANSCRIPT_CACHE_MAX_BYTES
        {
            if let Some(entry) = self.entries.pop_back() {
                self.bytes = self.bytes.saturating_sub(entry.bytes);
            } else {
                break;
            }
        }
    }
}

struct ScanningGuard(Arc<AtomicBool>);

impl Drop for ScanningGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl Default for AgentHistoryState {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentHistoryState {
    pub fn new() -> Self {
        let db_path = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("voktty")
            .join("agent_history_wake.db");
        Self::with_db_path(db_path)
    }

    fn with_db_path(db_path: PathBuf) -> Self {
        Self {
            db_path,
            store: OnceLock::new(),
            adapters: OnceLock::new(),
            is_scanning: Arc::new(AtomicBool::new(false)),
            transcripts: Mutex::new(TranscriptCache {
                entries: VecDeque::new(),
                bytes: 0,
            }),
        }
    }

    pub fn store(&self) -> Result<&Arc<Store>, String> {
        self.store
            .get_or_init(|| {
                let primary = (|| {
                    if let Some(parent) = self.db_path.parent() {
                        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                    }
                    open_or_rebuild(&self.db_path)
                        .map(|(store, _)| Arc::new(store))
                        .map_err(|error| error.to_string())
                })();
                primary.or_else(|primary| {
                    let fallback_path = PathBuf::from("agent_history_wake.db");
                    open_or_rebuild(&fallback_path)
                        .map(|(store, _)| Arc::new(store))
                        .map_err(|fallback| {
                            format!(
                                "Could not open history database: {primary}; fallback: {fallback}"
                            )
                        })
                })
            })
            .as_ref()
            .map_err(Clone::clone)
    }

    pub fn adapters(&self) -> &[Box<dyn AgentAdapter>] {
        self.adapters.get_or_init(create_adapters)
    }

    pub fn trigger_background_scan(&self, full: bool) -> Result<(), String> {
        let store = self.store()?.clone();
        if self
            .is_scanning
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            let store_bg = store;
            let scanning_bg = self.is_scanning.clone();
            std::thread::spawn(move || {
                let _scanning = ScanningGuard(scanning_bg);
                let adapters = create_adapters();
                let _ = run_scan(&adapters, &store_bg, &NullEvents, full);
            });
        }
        Ok(())
    }
}

fn get_resume_cmd(meta: &SessionMeta) -> Option<String> {
    match meta.agent {
        AgentId::ClaudeCode => Some(format!("claude --resume {}", meta.id)),
        AgentId::Codex => Some(format!("codex resume {}", meta.id)),
        AgentId::Opencode => Some(format!("opencode resume {}", meta.id)),
        AgentId::Grok => Some(format!("grok --resume {}", meta.id)),
        AgentId::Antigravity => Some(format!("antigravity --resume {}", meta.id)),
        AgentId::Gemini => Some(format!("gemini --resume {}", meta.id)),
        AgentId::Cursor => Some(format!("cursor --resume {}", meta.id)),
        AgentId::Copilot => Some(format!("copilot resume {}", meta.id)),
        _ => Some(format!("{} resume {}", meta.agent.as_str(), meta.id)),
    }
}

#[tauri::command]
pub async fn agent_history_get_sessions(
    filter: Option<SessionFilter>,
    state: State<'_, AgentHistoryState>,
) -> Result<Vec<HistorySession>, String> {
    let f = filter.unwrap_or_default();
    state.trigger_background_scan(false)?;

    let wake_filter = WakeSessionFilter {
        limit: 5000,
        ..WakeSessionFilter::default()
    };
    let (wake_sessions, _) = state
        .store()?
        .list_sessions(&wake_filter)
        .map_err(|e| e.to_string())?;

    let sessions: Vec<HistorySession> = wake_sessions
        .into_iter()
        .filter(|s| {
            if let Some(ref ag) = f.agent {
                if ag != "all" {
                    let s_ag = s.agent.as_str();
                    let matches = s_ag.eq_ignore_ascii_case(ag)
                        || (ag.eq_ignore_ascii_case("claude") && s_ag == "claude-code")
                        || (ag.eq_ignore_ascii_case("opencode") && s_ag == "opencode");
                    if !matches {
                        return false;
                    }
                }
            }
            if let Some(ref prj) = f.project {
                if !s.project_name.eq_ignore_ascii_case(prj) {
                    return false;
                }
            }
            if let Some(ref q) = f.search_query {
                if !q.is_empty() {
                    let q_lower = q.to_lowercase();
                    if !s.title.to_lowercase().contains(&q_lower)
                        && !s.project_name.to_lowercase().contains(&q_lower)
                    {
                        return false;
                    }
                }
            }
            true
        })
        .map(|meta| {
            let created_at_sec = if meta.created_at > 1_000_000_000_000 {
                meta.created_at / 1000
            } else {
                meta.created_at
            };
            let updated_at_sec = if meta.updated_at > 1_000_000_000_000 {
                meta.updated_at / 1000
            } else {
                meta.updated_at
            };
            let resume_cmd = get_resume_cmd(&meta);

            HistorySession {
                id: meta.key.clone(),
                agent: meta.agent.as_str().to_string(),
                title: if meta.title.is_empty() {
                    meta.id.clone()
                } else {
                    meta.title
                },
                project_name: if meta.project_name.is_empty() {
                    "Unknown".to_string()
                } else {
                    meta.project_name
                },
                project_path: meta.project_path.clone(),
                cwd: Some(meta.project_path),
                git_branch: meta.git_branch,
                created_at: created_at_sec,
                updated_at: updated_at_sec,
                message_count: meta.message_count as u32,
                is_active: false,
                file_path: Some(meta.file_path),
                source_hash: None,
                can_resume: resume_cmd.is_some(),
                resume_command: resume_cmd,
            }
        })
        .collect();

    Ok(sessions)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySessionPage {
    items: Vec<HistorySession>,
    offset: i64,
    limit: i64,
    total: i64,
    has_more: bool,
    scanning: bool,
}

#[tauri::command]
pub async fn agent_history_get_session_page(
    filter: Option<SessionFilter>,
    state: State<'_, AgentHistoryState>,
) -> Result<HistorySessionPage, String> {
    let f = filter.unwrap_or_default();
    let limit = f.limit.unwrap_or(100).clamp(1, 100) as i64;
    let offset = f.offset.unwrap_or(0) as i64;
    let agents = f
        .agent
        .as_deref()
        .filter(|agent| *agent != "all")
        .and_then(|agent| {
            AgentId::parse(if agent.eq_ignore_ascii_case("claude") {
                "claude-code"
            } else {
                agent
            })
        })
        .into_iter()
        .collect();
    let project_paths = match f.project.as_deref().filter(|project| !project.is_empty()) {
        Some(project) => state
            .store()?
            .list_projects(false)
            .map_err(|error| error.to_string())?
            .into_iter()
            .filter(|entry| entry.name.eq_ignore_ascii_case(project))
            .map(|entry| entry.path)
            .collect(),
        None => Vec::new(),
    };
    let wake_filter = WakeSessionFilter {
        limit,
        offset,
        agents,
        project_paths,
        title_query: f.search_query.clone().filter(|q| !q.is_empty()),
        ..WakeSessionFilter::default()
    };
    let (wake_sessions, total) = state
        .store()?
        .list_sessions(&wake_filter)
        .map_err(|e| e.to_string())?;
    let items = wake_sessions
        .into_iter()
        .map(history_session_from_meta)
        .collect();
    Ok(HistorySessionPage {
        has_more: offset + limit < total,
        items,
        offset,
        limit,
        total,
        scanning: state.is_scanning.load(Ordering::SeqCst),
    })
}

fn history_session_from_meta(meta: SessionMeta) -> HistorySession {
    let created_at = if meta.created_at > 1_000_000_000_000 {
        meta.created_at / 1000
    } else {
        meta.created_at
    };
    let updated_at = if meta.updated_at > 1_000_000_000_000 {
        meta.updated_at / 1000
    } else {
        meta.updated_at
    };
    let resume_command = get_resume_cmd(&meta);
    HistorySession {
        id: meta.key,
        agent: meta.agent.as_str().to_string(),
        title: if meta.title.is_empty() {
            meta.id
        } else {
            meta.title
        },
        project_name: if meta.project_name.is_empty() {
            "Unknown".to_string()
        } else {
            meta.project_name
        },
        project_path: meta.project_path.clone(),
        cwd: Some(meta.project_path),
        git_branch: meta.git_branch,
        created_at,
        updated_at,
        message_count: meta.message_count as u32,
        is_active: false,
        file_path: Some(meta.file_path),
        source_hash: None,
        can_resume: resume_command.is_some(),
        resume_command,
    }
}

#[tauri::command]
pub async fn agent_history_get_messages(
    session_id: String,
    offset: Option<u32>,
    limit: Option<u32>,
    state: State<'_, AgentHistoryState>,
) -> Result<HistoryMessagePage, String> {
    let messages = load_session_messages(&state, &session_id).await?;
    Ok(message_page(&messages, offset, limit))
}

async fn load_session_messages(
    state: &AgentHistoryState,
    session_id: &str,
) -> Result<Arc<Vec<HistoryMessage>>, String> {
    let meta = state
        .store()?
        .get_session(session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Session not found".to_string())?;

    let file_ref = SessionFileRef {
        agent: meta.agent,
        native_id: meta.id.clone(),
        file_path: meta.file_path.clone(),
        mtime_ms: meta.updated_at,
        size: meta.size_bytes,
    };
    let cache_key = format!("{}:{}:{}", session_id, file_ref.mtime_ms, file_ref.size);
    let cached = state
        .transcripts
        .lock()
        .map_err(|_| "Transcript cache is locked".to_string())?
        .get(&cache_key);

    if let Some(messages) = cached {
        return Ok(messages);
    }

    let transcript = tokio::task::spawn_blocking(move || {
        let adapters = create_adapters();
        let adapter = adapter_for(&adapters, file_ref.agent, &file_ref.file_path)
            .ok_or_else(|| format!("No adapter for agent {:?}", file_ref.agent))?;
        adapter
            .parse_transcript(&file_ref)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;

    let mut result = Vec::new();
    let mut seq_counter = 0u32;

    for msg in transcript.mainline {
        let ts_sec = msg
            .timestamp
            .map(|t| if t > 1_000_000_000_000 { t / 1000 } else { t })
            .unwrap_or(0);
        let role_str = msg.role.as_str().to_string();

        seq_counter += 1;
        result.push(HistoryMessage {
            id: format!("{}-{}", session_id, seq_counter),
            session_id: session_id.to_string(),
            role: role_str,
            content: msg.text.clone(),
            sequence: seq_counter,
            timestamp: ts_sec,
            tool_name: msg.tool_calls.first().map(|tc| tc.name.clone()),
            tool_input: msg
                .tool_calls
                .first()
                .and_then(|tc| tc.input.clone().or_else(|| Some(tc.input_preview.clone()))),
            tool_output: msg.tool_calls.first().and_then(|tc| tc.output.clone()),
            is_error: msg
                .tool_calls
                .first()
                .map(|tc| tc.is_error)
                .unwrap_or(false),
            redacted: false,
            thinking: msg.thinking.clone(),
        });

        for tc in msg.tool_calls.iter().skip(1) {
            seq_counter += 1;
            result.push(HistoryMessage {
                id: format!("{}-{}", session_id, seq_counter),
                session_id: session_id.to_string(),
                role: "tool".to_string(),
                content: format!("Tool invocation: {}", tc.name),
                sequence: seq_counter,
                timestamp: ts_sec,
                tool_name: Some(tc.name.clone()),
                tool_input: tc.input.clone().or_else(|| Some(tc.input_preview.clone())),
                tool_output: tc.output.clone(),
                is_error: tc.is_error,
                redacted: false,
                thinking: None,
            });
        }
    }

    let bytes = result.iter().map(history_message_bytes).sum();
    let messages = Arc::new(result);
    state
        .transcripts
        .lock()
        .map_err(|_| "Transcript cache is locked".to_string())?
        .insert(cache_key, messages.clone(), bytes);
    Ok(messages)
}

fn message_page(
    messages: &[HistoryMessage],
    offset: Option<u32>,
    limit: Option<u32>,
) -> HistoryMessagePage {
    let offset = offset.unwrap_or(0).min(messages.len() as u32);
    let limit = limit.unwrap_or(100).clamp(1, 200);
    let end = (offset as usize)
        .saturating_add(limit as usize)
        .min(messages.len());
    HistoryMessagePage {
        items: messages[offset as usize..end].to_vec(),
        offset,
        limit,
        total: messages.len() as u32,
        has_more: end < messages.len(),
    }
}

fn history_message_bytes(message: &HistoryMessage) -> usize {
    message.id.len()
        + message.session_id.len()
        + message.role.len()
        + message.content.len()
        + message.tool_name.as_ref().map_or(0, String::len)
        + message.tool_input.as_ref().map_or(0, String::len)
        + message.tool_output.as_ref().map_or(0, String::len)
        + message.thinking.as_ref().map_or(0, String::len)
}

#[tauri::command]
pub async fn agent_history_rescan(
    state: State<'_, AgentHistoryState>,
) -> Result<HistoryStats, String> {
    if state
        .is_scanning
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return agent_history_get_stats(state).await;
    }

    let store = state.store()?.clone();
    let scanning = state.is_scanning.clone();

    tokio::task::spawn_blocking(move || {
        let _scanning = ScanningGuard(scanning);
        let adapters = create_adapters();
        run_scan(&adapters, &store, &NullEvents, true).map_err(|error| error.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    agent_history_get_stats(state).await
}

#[cfg(test)]
mod state_tests {
    use super::{
        message_page, AgentHistoryState, Arc, AtomicBool, HistoryMessage, Ordering, ScanningGuard,
        TranscriptCache, VecDeque, TRANSCRIPT_CACHE_MAX_ENTRIES,
    };

    fn message(id: &str) -> HistoryMessage {
        HistoryMessage {
            id: id.into(),
            session_id: "s".into(),
            role: "user".into(),
            content: "x".into(),
            sequence: 1,
            timestamp: 0,
            tool_name: None,
            tool_input: None,
            tool_output: None,
            is_error: false,
            redacted: false,
            thinking: None,
        }
    }

    #[test]
    fn scanning_guard_releases_the_scan_claim() {
        let scanning = Arc::new(AtomicBool::new(true));
        {
            let _guard = ScanningGuard(scanning.clone());
            assert!(scanning.load(Ordering::SeqCst));
        }
        assert!(!scanning.load(Ordering::SeqCst));
    }

    #[test]
    fn state_constructor_defers_database_creation() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let path = temp.path().join("history.db");
        let state = AgentHistoryState::with_db_path(path.clone());

        assert!(!path.exists());
        let first = state.store().expect("open history database") as *const _;
        let second = state.store().expect("reuse history database") as *const _;
        assert!(path.exists());
        assert_eq!(first, second);
    }

    #[test]
    fn concurrent_access_opens_one_history_store() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let state = AgentHistoryState::with_db_path(temp.path().join("history.db"));
        let (first, second) = std::thread::scope(|scope| {
            let first = scope.spawn(|| state.store().map(|store| store as *const _ as usize));
            let second = scope.spawn(|| state.store().map(|store| store as *const _ as usize));
            (
                first.join().expect("first worker").expect("first store"),
                second.join().expect("second worker").expect("second store"),
            )
        });
        assert_eq!(first, second);
    }

    #[test]
    fn transcript_cache_evicts_the_least_recently_used_entry() {
        let mut cache = TranscriptCache {
            entries: VecDeque::new(),
            bytes: 0,
        };
        for index in 0..=TRANSCRIPT_CACHE_MAX_ENTRIES {
            cache.insert(
                index.to_string(),
                Arc::new(vec![message(&index.to_string())]),
                1,
            );
        }
        assert!(cache.get("0").is_none());
        assert!(cache
            .get(&TRANSCRIPT_CACHE_MAX_ENTRIES.to_string())
            .is_some());
    }

    #[test]
    fn message_page_clamps_limits_and_reports_remaining_messages() {
        let messages = vec![message("1"), message("2"), message("3")];

        let first = message_page(&messages, Some(0), Some(1));
        assert_eq!(first.items.len(), 1);
        assert_eq!(first.total, 3);
        assert!(first.has_more);

        let final_page = message_page(&messages, Some(2), Some(500));
        assert_eq!(final_page.items.len(), 1);
        assert_eq!(final_page.limit, 200);
        assert!(!final_page.has_more);
    }
}

#[tauri::command]
pub async fn agent_history_delete_session(
    session_id: String,
    state: State<'_, AgentHistoryState>,
) -> Result<(), String> {
    state
        .store()?
        .remove_session(&session_id, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn agent_history_clear_all(state: State<'_, AgentHistoryState>) -> Result<(), String> {
    state.store()?.rebuild_all().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn agent_history_get_resume_command(
    session_id: String,
    state: State<'_, AgentHistoryState>,
) -> Result<Option<String>, String> {
    let session = state
        .store()?
        .get_session(&session_id)
        .map_err(|e| e.to_string())?;
    let Some(s) = session else {
        return Ok(None);
    };
    Ok(get_resume_cmd(&s))
}

#[tauri::command]
pub async fn agent_history_export_markdown(
    session_id: String,
    state: State<'_, AgentHistoryState>,
) -> Result<String, String> {
    let session = state
        .store()?
        .get_session(&session_id)
        .map_err(|e| e.to_string())?
        .ok_or("Session not found")?;

    let messages = load_session_messages(&state, &session_id).await?;

    let mut md = format!(
        "# {} Transcript\n\n- **Agent:** {}\n- **Project:** {}\n- **Date:** {}\n- **Messages:** {}\n\n---\n\n",
        session.title,
        session.agent.as_str().to_uppercase(),
        session.project_name,
        session.created_at,
        messages.len()
    );

    for m in messages.iter() {
        md.push_str(&format!(
            "### {}\n\n{}\n\n",
            m.role.to_uppercase(),
            m.content
        ));
        if let Some(tool) = &m.tool_name {
            md.push_str(&format!("> **Tool Call:** `{}`\n", tool));
            if let Some(inp) = &m.tool_input {
                md.push_str(&format!("```json\n{}\n```\n", inp));
            }
            if let Some(out) = &m.tool_output {
                md.push_str(&format!("*Output:*\n```\n{}\n```\n", out));
            }
            md.push('\n');
        }
    }

    Ok(md)
}

#[tauri::command]
pub async fn agent_history_get_stats(
    state: State<'_, AgentHistoryState>,
) -> Result<HistoryStats, String> {
    let stats = state.store()?.session_stats().map_err(|e| e.to_string())?;

    Ok(HistoryStats {
        total_sessions: stats.total_sessions.try_into().unwrap_or(u32::MAX),
        total_messages: stats.total_messages.try_into().unwrap_or(u32::MAX),
        agents_count: stats
            .agents_count
            .into_iter()
            .map(|(agent, count)| (agent, count.try_into().unwrap_or(u32::MAX)))
            .collect(),
        projects_count: stats
            .projects_count
            .into_iter()
            .map(|(project, count)| (project, count.try_into().unwrap_or(u32::MAX)))
            .collect(),
        last_scan_timestamp: chrono::Utc::now().timestamp(),
    })
}
