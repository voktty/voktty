pub mod claude_adapter;
pub mod codex_adapter;
pub mod cursor_adapter;
pub mod gemini_adapter;
pub mod voktty_adapter;

use super::models::{HistoryMessage, HistorySession};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct SessionLocation {
    pub path: PathBuf,
    pub last_modified: i64,
    pub file_size: u64,
    pub source_hash: String,
}

impl SessionLocation {
    pub fn from_path(path: PathBuf) -> Option<Self> {
        let meta = std::fs::metadata(&path).ok()?;
        let last_modified = meta
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs() as i64;
        let file_size = meta.len();
        let source_hash = format!("{}_{}", last_modified, file_size);

        Some(Self {
            path,
            last_modified,
            file_size,
            source_hash,
        })
    }
}

pub trait AgentHistoryAdapter: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn is_installed(&self) -> bool;
    fn scan(&self) -> Vec<SessionLocation>;
    fn parse_session(&self, path: &Path) -> Option<(HistorySession, Vec<HistoryMessage>)>;
    fn resume_command(&self, session: &HistorySession) -> Option<String>;
}