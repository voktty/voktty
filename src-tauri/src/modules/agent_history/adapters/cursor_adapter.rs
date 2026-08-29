use super::{AgentHistoryAdapter, SessionLocation};
use crate::modules::agent_history::models::{HistoryMessage, HistorySession};
use std::path::{Path, PathBuf};

#[derive(Default)]
pub struct CursorAdapter;

impl CursorAdapter {
    pub fn new() -> Self {
        Self
    }

    fn cursor_storage_dir() -> Option<PathBuf> {
        #[cfg(windows)]
        {
            std::env::var("APPDATA").ok().map(|appdata| {
                PathBuf::from(appdata)
                    .join("Cursor")
                    .join("User")
                    .join("workspaceStorage")
            })
        }
        #[cfg(target_os = "macos")]
        {
            dirs::home_dir().map(|h| {
                h.join("Library")
                    .join("Application Support")
                    .join("Cursor")
                    .join("User")
                    .join("workspaceStorage")
            })
        }
        #[cfg(target_os = "linux")]
        {
            dirs::home_dir().map(|h| {
                h.join(".config")
                    .join("Cursor")
                    .join("User")
                    .join("workspaceStorage")
            })
        }
    }
}

impl AgentHistoryAdapter for CursorAdapter {
    fn id(&self) -> &str {
        "cursor"
    }

    fn name(&self) -> &str {
        "Cursor Editor AI"
    }

    fn is_installed(&self) -> bool {
        Self::cursor_storage_dir()
            .map(|d| d.exists())
            .unwrap_or(false)
    }

    fn scan(&self) -> Vec<SessionLocation> {
        let mut list = Vec::new();
        let Some(dir) = Self::cursor_storage_dir() else {
            return list;
        };

        if !dir.exists() {
            return list;
        }

        if let Ok(workspaces) = std::fs::read_dir(dir) {
            for ws_entry in workspaces.flatten() {
                let ws_path = ws_entry.path();
                if ws_path.is_dir() {
                    let db_path = ws_path.join("state.vscdb");
                    if db_path.exists() {
                        if let Some(loc) = SessionLocation::from_path(db_path) {
                            list.push(loc);
                        }
                    }
                }
            }
        }

        list
    }

    fn parse_session(&self, path: &Path) -> Option<(HistorySession, Vec<HistoryMessage>)> {
        let loc = SessionLocation::from_path(path.to_path_buf())?;
        let parent = path.parent()?;
        let folder_name = parent.file_name()?.to_string_lossy().to_string();
        let session_id = format!("cursor_{}", folder_name);

        let session = HistorySession {
            id: session_id.clone(),
            agent: "cursor".to_string(),
            title: format!(
                "Cursor Workspace {}",
                &folder_name[..folder_name.len().min(8)]
            ),
            project_name: "Cursor Workspace".to_string(),
            project_path: parent.to_string_lossy().to_string(),
            cwd: None,
            git_branch: None,
            created_at: loc.last_modified,
            updated_at: loc.last_modified,
            message_count: 0,
            is_active: false,
            file_path: Some(path.to_string_lossy().to_string()),
            source_hash: Some(loc.source_hash),
            can_resume: false,
            resume_command: None,
        };

        Some((session, Vec::new()))
    }

    fn resume_command(&self, _session: &HistorySession) -> Option<String> {
        None
    }
}
