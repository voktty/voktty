pub mod adapters;
pub mod db;
pub mod indexer;
pub mod models;
pub mod sanitizer;

use db::HistoryDb;
use indexer::HistoryIndexer;
use models::{HistoryMessage, HistorySession, HistoryStats, SessionFilter};
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct AgentHistoryState {
    db: Arc<HistoryDb>,
    indexer: Arc<HistoryIndexer>,
    initialized: Mutex<bool>,
}

impl Default for AgentHistoryState {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentHistoryState {
    pub fn new() -> Self {
        let db_path = HistoryDb::default_db_path().unwrap_or_else(|| std::path::PathBuf::from("agent_history.db"));
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let db = Arc::new(HistoryDb::open(&db_path).unwrap_or_else(|_| HistoryDb::open_in_memory().unwrap()));
        let indexer = Arc::new(HistoryIndexer::new(db.clone()));

        Self {
            db,
            indexer,
            initialized: Mutex::new(false),
        }
    }

    fn ensure_initial_scan(&self) {
        let mut init = self.initialized.lock().unwrap();
        if !*init {
            let _ = self.indexer.rescan_all();
            *init = true;
        }
    }
}

#[tauri::command]
pub async fn agent_history_get_sessions(
    filter: Option<SessionFilter>,
    state: State<'_, AgentHistoryState>,
) -> Result<Vec<HistorySession>, String> {
    let f = filter.unwrap_or_default();
    state.db.get_sessions(&f).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_history_get_messages(
    session_id: String,
    offset: Option<u32>,
    limit: Option<u32>,
    state: State<'_, AgentHistoryState>,
) -> Result<Vec<HistoryMessage>, String> {
    let off = offset.unwrap_or(0);
    let lim = limit.unwrap_or(200);
    state.db.get_messages(&session_id, off, lim).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_history_rescan(
    state: State<'_, AgentHistoryState>,
) -> Result<HistoryStats, String> {
    let indexer = state.indexer.clone();
    tokio::task::spawn_blocking(move || {
        indexer.rescan_all()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_history_delete_session(
    session_id: String,
    state: State<'_, AgentHistoryState>,
) -> Result<(), String> {
    state.db.delete_session(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_history_clear_all(
    state: State<'_, AgentHistoryState>,
) -> Result<(), String> {
    state.db.clear_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_history_get_resume_command(
    session_id: String,
    state: State<'_, AgentHistoryState>,
) -> Result<Option<String>, String> {
    let session = state.db.get_session(&session_id).map_err(|e| e.to_string())?;
    let Some(s) = session else {
        return Ok(None);
    };
    Ok(state.indexer.get_resume_command(&s))
}

#[tauri::command]
pub async fn agent_history_export_markdown(
    session_id: String,
    state: State<'_, AgentHistoryState>,
) -> Result<String, String> {
    let session = state.db.get_session(&session_id).map_err(|e| e.to_string())?.ok_or("Session not found")?;
    let messages = state.db.get_messages(&session_id, 0, 1000).map_err(|e| e.to_string())?;

    let mut md = format!(
        "# {} Transcript\n\n- **Agent:** {}\n- **Project:** {}\n- **Date:** {}\n- **Messages:** {}\n\n---\n\n",
        session.title,
        session.agent.to_uppercase(),
        session.project_name,
        session.created_at,
        messages.len()
    );

    for m in messages {
        md.push_str(&format!("### {}\n\n{}\n\n", m.role.to_uppercase(), m.content));
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
    state.ensure_initial_scan();
    state.db.get_stats(0).map_err(|e| e.to_string())
}