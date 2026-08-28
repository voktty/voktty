use super::{AgentHistoryAdapter, SessionLocation};
use crate::modules::agent_history::models::{HistoryMessage, HistorySession};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub struct ClaudeAdapter;

impl ClaudeAdapter {
    pub fn new() -> Self {
        Self
    }

    fn claude_home_dir() -> Option<PathBuf> {
        dirs::home_dir().map(|h| h.join(".claude"))
    }

    fn scan_recursive(dir: &Path, list: &mut Vec<SessionLocation>, depth: usize) {
        if depth > 6 {
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

impl AgentHistoryAdapter for ClaudeAdapter {
    fn id(&self) -> &str {
        "claude"
    }

    fn name(&self) -> &str {
        "Claude Code"
    }

    fn is_installed(&self) -> bool {
        Self::claude_home_dir().map(|d| d.exists()).unwrap_or(false)
    }

    fn scan(&self) -> Vec<SessionLocation> {
        let mut list = Vec::new();
        let Some(claude_dir) = Self::claude_home_dir() else {
            return list;
        };

        if !claude_dir.exists() {
            return list;
        }

        Self::scan_recursive(&claude_dir, &mut list, 0);
        list
    }

    fn parse_session(&self, path: &Path) -> Option<(HistorySession, Vec<HistoryMessage>)> {
        let content = std::fs::read_to_string(path).ok()?;
        let stem = path.file_stem()?.to_string_lossy().to_string();
        let session_id = format!("claude_{}", stem);

        let mut messages = Vec::new();
        let mut first_user_prompt = String::new();
        let mut cwd = None;
        let mut git_branch = None;
        let mut first_ts = 0i64;
        let mut last_ts = 0i64;

        for (idx, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let Ok(v) = serde_json::from_str::<Value>(line) else {
                continue;
            };

            let role_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("message");
            let role = match role_type {
                "user" | "user_prompt" | "USER_INPUT" => "user",
                "assistant" | "assistant_response" | "PLANNER_RESPONSE" => "assistant",
                "tool_use" | "tool_call" => "tool",
                "tool_result" | "tool_output" => "tool",
                "system" => "system",
                _ => "assistant",
            };

            let msg_text = if let Some(s) = v.get("content").and_then(|c| c.as_str()) {
                s.to_string()
            } else if let Some(s) = v.get("text").and_then(|c| c.as_str()) {
                s.to_string()
            } else if let Some(s) = v.get("message").and_then(|c| c.as_str()) {
                s.to_string()
            } else {
                String::new()
            };

            if role == "user" && first_user_prompt.is_empty() && !msg_text.is_empty() {
                first_user_prompt = msg_text.chars().take(80).collect::<String>();
            }

            let ts = v
                .get("timestamp")
                .and_then(|t| t.as_i64())
                .or_else(|| {
                    v.get("created_at")
                        .and_then(|c| c.as_str())
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                        .map(|dt| dt.timestamp())
                })
                .unwrap_or(0);

            if first_ts == 0 || (ts > 0 && ts < first_ts) {
                first_ts = ts;
            }
            if ts > last_ts {
                last_ts = ts;
            }

            if cwd.is_none() {
                if let Some(c) = v.get("cwd").and_then(|c| c.as_str()) {
                    cwd = Some(c.to_string());
                }
            }

            if git_branch.is_none() {
                if let Some(b) = v.get("git_branch").or_else(|| v.get("branch")).and_then(|b| b.as_str()) {
                    git_branch = Some(b.to_string());
                }
            }

            let tool_name = v.get("tool_name").or_else(|| v.get("tool")).and_then(|t| t.as_str()).map(|s| s.to_string());
            let tool_input = v.get("tool_input").or_else(|| v.get("input")).map(|i| i.to_string());
            let tool_output = v.get("tool_output").or_else(|| v.get("output")).map(|o| o.to_string());
            let is_error = v.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false);

            if !msg_text.is_empty() || tool_name.is_some() {
                messages.push(HistoryMessage {
                    id: format!("{}_{}", session_id, idx),
                    session_id: session_id.clone(),
                    role: role.to_string(),
                    content: msg_text,
                    sequence: idx as u32,
                    timestamp: ts,
                    tool_name,
                    tool_input,
                    tool_output,
                    is_error,
                    redacted: false,
                });
            }
        }

        if messages.is_empty() {
            return None;
        }

        let loc = SessionLocation::from_path(path.to_path_buf())?;
        let project_name = cwd
            .as_ref()
            .and_then(|p| Path::new(p).file_name())
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "Project".to_string());

        let title = if !first_user_prompt.is_empty() {
            first_user_prompt
        } else {
            format!("Claude Code Session {}", &stem[..stem.len().min(8)])
        };

        let session = HistorySession {
            id: session_id,
            agent: "claude".to_string(),
            title,
            project_name,
            project_path: cwd.clone().unwrap_or_default(),
            cwd: cwd.clone(),
            git_branch,
            created_at: if first_ts > 0 { first_ts } else { loc.last_modified },
            updated_at: if last_ts > 0 { last_ts } else { loc.last_modified },
            message_count: messages.len() as u32,
            is_active: false,
            file_path: Some(path.to_string_lossy().to_string()),
            source_hash: Some(loc.source_hash),
            can_resume: true,
            resume_command: Some(format!("claude --resume {}", stem)),
        };

        Some((session, messages))
    }

    fn resume_command(&self, session: &HistorySession) -> Option<String> {
        let raw_id = session.id.strip_prefix("claude_").unwrap_or(&session.id);
        Some(format!("claude --resume {}", raw_id))
    }
}