pub mod adapters;
pub mod db;
pub mod indexer;
pub mod models;
pub mod sanitizer;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

use models::{HistoryMessage, HistorySession, HistoryStats, SessionFilter};
use wake_core::adapters::{adapter_for, create_adapters, AgentAdapter};
use wake_core::db::{open_or_rebuild, Store};
use wake_core::models::{AgentId, SessionFileRef, SessionFilter as WakeSessionFilter, SessionMeta};
use wake_core::scanner::{run_scan, NullEvents};

pub struct AgentHistoryState {
    pub store: Arc<Store>,
    pub adapters: Vec<Box<dyn AgentAdapter>>,
    pub is_scanning: Arc<std::sync::atomic::AtomicBool>,
}

impl Default for AgentHistoryState {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentHistoryState {
    pub fn new() -> Self {
        let db_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("voktty");
        let _ = std::fs::create_dir_all(&db_dir);
        let db_path = db_dir.join("agent_history_wake.db");

        let (store, _) = open_or_rebuild(&db_path).unwrap_or_else(|_| {
            (
                open_or_rebuild(&PathBuf::from("agent_history_wake.db"))
                    .unwrap()
                    .0,
                None,
            )
        });
        let store = Arc::new(store);
        let adapters = create_adapters();
        let is_scanning = Arc::new(std::sync::atomic::AtomicBool::new(false));

        // Start non-blocking background incremental scan on startup (cross-platform)
        let store_bg = store.clone();
        let scanning_bg = is_scanning.clone();
        std::thread::spawn(move || {
            scanning_bg.store(true, std::sync::atomic::Ordering::SeqCst);
            let adapters = create_adapters();
            let _ = run_scan(&adapters, &store_bg, &NullEvents, false);
            scanning_bg.store(false, std::sync::atomic::Ordering::SeqCst);
        });

        Self {
            store,
            adapters,
            is_scanning,
        }
    }

    pub fn trigger_background_scan(&self, full: bool) {
        if self
            .is_scanning
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
            )
            .is_ok()
        {
            let store_bg = self.store.clone();
            let scanning_bg = self.is_scanning.clone();
            std::thread::spawn(move || {
                let adapters = create_adapters();
                let _ = run_scan(&adapters, &store_bg, &NullEvents, full);
                scanning_bg.store(false, std::sync::atomic::Ordering::SeqCst);
            });
        }
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

    let wake_filter = WakeSessionFilter {
        limit: 5000,
        ..WakeSessionFilter::default()
    };
    let (wake_sessions, _) = state
        .store
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

#[tauri::command]
pub async fn agent_history_get_messages(
    session_id: String,
    _offset: Option<u32>,
    _limit: Option<u32>,
    state: State<'_, AgentHistoryState>,
) -> Result<Vec<HistoryMessage>, String> {
    let meta = state
        .store
        .get_session(&session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Session not found".to_string())?;

    let adapter = adapter_for(&state.adapters, meta.agent, &meta.file_path)
        .ok_or_else(|| format!("No adapter for agent {:?}", meta.agent))?;

    let file_ref = SessionFileRef {
        agent: meta.agent,
        native_id: meta.id.clone(),
        file_path: meta.file_path.clone(),
        mtime_ms: meta.updated_at,
        size: meta.size_bytes,
    };

    let transcript = adapter
        .parse_transcript(&file_ref)
        .map_err(|e| e.to_string())?;

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
            session_id: session_id.clone(),
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
                session_id: session_id.clone(),
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

    Ok(result)
}

#[tauri::command]
pub async fn agent_history_rescan(
    state: State<'_, AgentHistoryState>,
) -> Result<HistoryStats, String> {
    let store = state.store.clone();

    tokio::task::spawn_blocking(move || {
        let adapters = create_adapters();
        let _ = run_scan(&adapters, &store, &NullEvents, true);
    })
    .await
    .map_err(|e| e.to_string())?;

    agent_history_get_stats(state).await
}

#[tauri::command]
pub async fn agent_history_delete_session(
    session_id: String,
    state: State<'_, AgentHistoryState>,
) -> Result<(), String> {
    state
        .store
        .remove_session(&session_id, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn agent_history_clear_all(state: State<'_, AgentHistoryState>) -> Result<(), String> {
    state.store.rebuild_all().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn agent_history_get_resume_command(
    session_id: String,
    state: State<'_, AgentHistoryState>,
) -> Result<Option<String>, String> {
    let session = state
        .store
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
        .store
        .get_session(&session_id)
        .map_err(|e| e.to_string())?
        .ok_or("Session not found")?;

    let messages = agent_history_get_messages(session_id.clone(), None, None, state).await?;

    let mut md = format!(
        "# {} Transcript\n\n- **Agent:** {}\n- **Project:** {}\n- **Date:** {}\n- **Messages:** {}\n\n---\n\n",
        session.title,
        session.agent.as_str().to_uppercase(),
        session.project_name,
        session.created_at,
        messages.len()
    );

    for m in messages {
        md.push_str(&format!(
            "### {}\n\n{}\n\n",
            m.role.to_uppercase(),
            m.content
        ));
        if let Some(tool) = m.tool_name {
            md.push_str(&format!("> **Tool Call:** `{}`\n", tool));
            if let Some(inp) = m.tool_input {
                md.push_str(&format!("```json\n{}\n```\n", inp));
            }
            if let Some(out) = m.tool_output {
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
    let wake_filter = WakeSessionFilter {
        limit: 5000,
        ..WakeSessionFilter::default()
    };
    let (wake_sessions, _) = state
        .store
        .list_sessions(&wake_filter)
        .map_err(|e| e.to_string())?;

    let mut agents_count = std::collections::HashMap::new();
    let mut projects_count = std::collections::HashMap::new();
    let mut total_messages = 0u32;

    for s in &wake_sessions {
        *agents_count
            .entry(s.agent.as_str().to_string())
            .or_insert(0) += 1;
        if !s.project_name.is_empty() {
            *projects_count.entry(s.project_name.clone()).or_insert(0) += 1;
        }
        total_messages += s.message_count as u32;
    }

    Ok(HistoryStats {
        total_sessions: wake_sessions.len() as u32,
        total_messages,
        agents_count,
        projects_count,
        last_scan_timestamp: chrono::Utc::now().timestamp(),
    })
}
