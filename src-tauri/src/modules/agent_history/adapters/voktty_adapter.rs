use super::{AgentHistoryAdapter, SessionLocation};
use crate::modules::agent_history::models::{HistoryMessage, HistorySession};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub struct VokttyAdapter;

impl VokttyAdapter {
    pub fn new() -> Self {
        Self
    }

    fn storage_dir() -> Option<PathBuf> {
        dirs::data_dir().map(|d| d.join("voktty").join("sessions"))
    }
}

impl AgentHistoryAdapter for VokttyAdapter {
    fn id(&self) -> &str {
        "voktty"
    }

    fn name(&self) -> &str {
        "Voktty Native Agent"
    }

    fn is_installed(&self) -> bool {
        true
    }

    fn scan(&self) -> Vec<SessionLocation> {
        let mut list = Vec::new();
        let Some(dir) = Self::storage_dir() else {
            return list;
        };

        if !dir.exists() {
            return list;
        }

        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Some(loc) = SessionLocation::from_path(path) {
                        list.push(loc);
                    }
                }
            }
        }

        list
    }

    fn parse_session(&self, path: &Path) -> Option<(HistorySession, Vec<HistoryMessage>)> {
        let content = std::fs::read_to_string(path).ok()?;
        let json: Value = serde_json::from_str(&content).ok()?;

        let id = json.get("id").and_then(|v| v.as_str())?.to_string();
        let title = json
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Voktty Agent Session")
            .to_string();

        let project_name = json
            .get("project_name")
            .and_then(|v| v.as_str())
            .unwrap_or("Workspace")
            .to_string();

        let project_path = json
            .get("project_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let cwd = json.get("cwd").and_then(|v| v.as_str()).map(|s| s.to_string());
        let git_branch = json.get("git_branch").and_then(|v| v.as_str()).map(|s| s.to_string());

        let created_at = json.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0);
        let updated_at = json.get("updated_at").and_then(|v| v.as_i64()).unwrap_or(created_at);

        let mut messages = Vec::new();
        if let Some(arr) = json.get("messages").and_then(|v| v.as_array()) {
            for (idx, m) in arr.iter().enumerate() {
                let m_id = m.get("id").and_then(|v| v.as_str()).unwrap_or(&format!("{}_{}", id, idx)).to_string();
                let role = m.get("role").and_then(|v| v.as_str()).unwrap_or("assistant").to_string();
                let content_str = m.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let timestamp = m.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(created_at);
                let tool_name = m.get("tool_name").and_then(|v| v.as_str()).map(|s| s.to_string());
                let tool_input = m.get("tool_input").and_then(|v| v.as_str()).map(|s| s.to_string());
                let tool_output = m.get("tool_output").and_then(|v| v.as_str()).map(|s| s.to_string());
                let is_error = m.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);

                messages.push(HistoryMessage {
                    id: m_id,
                    session_id: id.clone(),
                    role,
                    content: content_str,
                    sequence: idx as u32,
                    timestamp,
                    tool_name,
                    tool_input,
                    tool_output,
                    is_error,
                    redacted: false,
                });
            }
        }

        let loc = SessionLocation::from_path(path.to_path_buf())?;

        let session = HistorySession {
            id,
            agent: "voktty".to_string(),
            title,
            project_name,
            project_path,
            cwd: cwd.clone(),
            git_branch,
            created_at,
            updated_at,
            message_count: messages.len() as u32,
            is_active: false,
            file_path: Some(path.to_string_lossy().to_string()),
            source_hash: Some(loc.source_hash),
            can_resume: true,
            resume_command: Some(format!("voktty chat --cwd \"{}\"", cwd.unwrap_or_default())),
        };

        Some((session, messages))
    }

    fn resume_command(&self, session: &HistorySession) -> Option<String> {
        let cwd = session.cwd.as_deref().unwrap_or(&session.project_path);
        Some(format!("voktty chat --cwd \"{}\"", cwd))
    }
}