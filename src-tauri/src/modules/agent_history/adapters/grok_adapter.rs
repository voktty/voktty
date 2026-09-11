use super::{AgentHistoryAdapter, SessionLocation};
use crate::modules::agent_history::models::{HistoryMessage, HistorySession};
use std::path::{Path, PathBuf};

#[derive(Default)]
pub struct GrokAdapter;

impl GrokAdapter {
    pub fn new() -> Self {
        Self
    }

    fn grok_dir() -> Option<PathBuf> {
        dirs::home_dir().map(|h| h.join(".grok"))
    }

    fn scan_recursive(dir: &Path, list: &mut Vec<SessionLocation>, depth: usize) {
        if depth > 5 {
            return;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    Self::scan_recursive(&path, list, depth + 1);
                } else if path.is_file() {
                    let ext = path.extension().and_then(|e| e.to_str());
                    if ext == Some("jsonl") || ext == Some("json") {
                        if let Some(loc) = SessionLocation::from_path(path) {
                            list.push(loc);
                        }
                    }
                }
            }
        }
    }
}

impl AgentHistoryAdapter for GrokAdapter {
    fn id(&self) -> &str {
        "grok"
    }

    fn name(&self) -> &str {
        "Grok Build"
    }

    fn is_installed(&self) -> bool {
        Self::grok_dir().map(|d| d.exists()).unwrap_or(false)
    }

    fn scan(&self) -> Vec<SessionLocation> {
        let mut list = Vec::new();
        let Some(grok_dir) = Self::grok_dir() else {
            return list;
        };
        Self::scan_recursive(&grok_dir, &mut list, 0);
        list
    }

    fn parse_session(&self, path: &Path) -> Option<(HistorySession, Vec<HistoryMessage>)> {
        let file_name = path.file_name()?.to_str()?;
        let session_id = format!("grok_{}", file_name.replace('.', "_"));

        let metadata = std::fs::metadata(path).ok()?;
        let created_at = metadata
            .created()
            .or_else(|_| metadata.modified())
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs() as i64;

        let session = HistorySession {
            id: session_id,
            agent: "grok".to_string(),
            title: format!("Grok Session ({})", file_name),
            project_name: "Grok".to_string(),
            project_path: path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            cwd: None,
            git_branch: None,
            created_at,
            updated_at: created_at,
            message_count: 0,
            is_active: false,
            file_path: Some(path.to_string_lossy().to_string()),
            source_hash: Some(format!("{}_{}", created_at, path.to_string_lossy())),
            can_resume: true,
            resume_command: Some("grok".to_string()),
        };

        Some((session, Vec::new()))
    }

    fn resume_command(&self, session: &HistorySession) -> Option<String> {
        session
            .resume_command
            .clone()
            .or_else(|| Some("grok".to_string()))
    }
}
