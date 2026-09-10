use super::{AgentHistoryAdapter, SessionLocation};
use crate::modules::agent_history::models::{HistoryMessage, HistorySession};
use std::path::{Path, PathBuf};

#[derive(Default)]
pub struct OpenCodeAdapter;

impl OpenCodeAdapter {
    pub fn new() -> Self {
        Self
    }

    fn opencode_dir() -> Option<PathBuf> {
        let home = dirs::home_dir()?;
        let paths = vec![
            home.join(".local").join("share").join("opencode"),
            home.join(".opencode"),
        ];
        paths.into_iter().find(|p| p.exists())
    }

    fn scan_recursive(dir: &Path, list: &mut Vec<SessionLocation>, depth: usize) {
        if depth > 4 {
            return;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    Self::scan_recursive(&path, list, depth + 1);
                } else if path.is_file() {
                    let ext = path.extension().and_then(|e| e.to_str());
                    if ext == Some("db") || ext == Some("sqlite") || ext == Some("json") || ext == Some("jsonl") {
                        if let Some(loc) = SessionLocation::from_path(path) {
                            list.push(loc);
                        }
                    }
                }
            }
        }
    }
}

impl AgentHistoryAdapter for OpenCodeAdapter {
    fn id(&self) -> &str {
        "opencode"
    }

    fn name(&self) -> &str {
        "OpenCode"
    }

    fn is_installed(&self) -> bool {
        Self::opencode_dir().map(|d| d.exists()).unwrap_or(false)
    }

    fn scan(&self) -> Vec<SessionLocation> {
        let mut list = Vec::new();
        let Some(opencode_dir) = Self::opencode_dir() else {
            return list;
        };
        Self::scan_recursive(&opencode_dir, &mut list, 0);
        list
    }

    fn parse_session(&self, path: &Path) -> Option<(HistorySession, Vec<HistoryMessage>)> {
        let file_name = path.file_name()?.to_str()?;
        let session_id = format!("opencode_{}", file_name.replace('.', "_"));

        let created_at = std::fs::metadata(path)
            .ok()?
            .created()
            .or_else(|_| std::fs::metadata(path).ok()?.modified())
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs() as i64;

        let session = HistorySession {
            id: session_id.clone(),
            agent: "opencode".to_string(),
            title: format!("OpenCode Session ({})", file_name),
            project_name: "OpenCode".to_string(),
            project_path: path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            cwd: None,
            git_branch: None,
            created_at,
            updated_at: created_at,
            message_count: 0,
            is_active: false,
            file_path: Some(path.to_string_lossy().to_string()),
            source_hash: format!("{}_{}", created_at, path.to_string_lossy()),
            can_resume: true,
            resume_command: Some(format!("opencode --session {}", session_id)),
        };

        Some((session, Vec::new()))
    }

    fn resume_command(&self, session: &HistorySession) -> Option<String> {
        session.resume_command.clone().or_else(|| Some("opencode".to_string()))
    }
}
