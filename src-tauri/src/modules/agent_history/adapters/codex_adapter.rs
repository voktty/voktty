use super::{AgentHistoryAdapter, SessionLocation};
use crate::modules::agent_history::models::{HistoryMessage, HistorySession};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Default)]
pub struct CodexAdapter;

impl CodexAdapter {
    pub fn new() -> Self {
        Self
    }

    fn codex_home_dir() -> Option<PathBuf> {
        dirs::home_dir().map(|h| h.join(".codex"))
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

    fn extract_codex_uuid(raw: &str) -> Option<String> {
        let chars: Vec<char> = raw.chars().collect();
        if chars.len() >= 36 {
            for start in 0..=(chars.len() - 36) {
                let candidate: String = chars[start..start + 36].iter().collect();
                let parts: Vec<&str> = candidate.split('-').collect();
                if parts.len() == 5
                    && parts[0].len() == 8
                    && parts[1].len() == 4
                    && parts[2].len() == 4
                    && parts[3].len() == 4
                    && parts[4].len() == 12
                    && parts
                        .iter()
                        .all(|p| p.chars().all(|c| c.is_ascii_hexdigit()))
                {
                    return Some(candidate);
                }
            }
        }
        None
    }
}

impl AgentHistoryAdapter for CodexAdapter {
    fn id(&self) -> &str {
        "codex"
    }

    fn name(&self) -> &str {
        "OpenAI Codex CLI"
    }

    fn is_installed(&self) -> bool {
        Self::codex_home_dir().map(|d| d.exists()).unwrap_or(false)
    }

    fn scan(&self) -> Vec<SessionLocation> {
        let mut list = Vec::new();
        let Some(dir) = Self::codex_home_dir() else {
            return list;
        };

        if !dir.exists() {
            return list;
        }

        let sessions_dir = dir.join("sessions");
        let search_dir = if sessions_dir.exists() {
            sessions_dir
        } else {
            dir
        };

        Self::scan_recursive(&search_dir, &mut list, 0);
        list
    }

    fn parse_session(&self, path: &Path) -> Option<(HistorySession, Vec<HistoryMessage>)> {
        let content = std::fs::read_to_string(path).ok()?;
        let stem = path.file_stem()?.to_string_lossy().to_string();
        let session_id = format!("codex_{}", stem);
        let loc = SessionLocation::from_path(path.to_path_buf())?;

        let mut messages = Vec::new();
        let mut first_user_prompt = String::new();
        let mut cwd: Option<String> = None;
        let mut created_at = loc.last_modified;
        let mut updated_at = loc.last_modified;

        for (idx, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let Ok(v) = serde_json::from_str::<Value>(line) else {
                continue;
            };

            // Parse timestamp
            if let Some(ts_str) = v.get("timestamp").and_then(|t| t.as_str()) {
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                    let ts = dt.timestamp();
                    if idx == 0 {
                        created_at = ts;
                    }
                    updated_at = ts;
                }
            }

            // Check for turn_context cwd
            if let Some(turn_payload) = v.get("payload") {
                if let Some(turn_cwd) = turn_payload.get("cwd").and_then(|c| c.as_str()) {
                    if cwd.is_none() {
                        cwd = Some(turn_cwd.to_string());
                    }
                }
            }

            // Extract message role and content
            let (role, text_content, tool_name, tool_input, tool_output, is_err) =
                if let Some(payload) = v.get("payload") {
                    let role = payload
                        .get("role")
                        .and_then(|r| r.as_str())
                        .unwrap_or("assistant")
                        .to_string();
                    let mut text = String::new();

                    if let Some(content_val) = payload.get("content") {
                        if let Some(s) = content_val.as_str() {
                            text = s.to_string();
                        } else if let Some(arr) = content_val.as_array() {
                            for item in arr {
                                if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                                    text.push_str(t);
                                }
                            }
                        }
                    }

                    // Check for tool call
                    let mut t_name = None;
                    let mut t_input = None;
                    let mut t_output = None;

                    if let Some(tool_call) = payload.get("tool_call") {
                        t_name = tool_call
                            .get("name")
                            .and_then(|n| n.as_str())
                            .map(|s| s.to_string());
                        t_input = tool_call.get("arguments").map(|a| a.to_string());
                    } else if let Some(output) = payload.get("tool_output") {
                        t_output = Some(output.to_string());
                    }

                    (role, text, t_name, t_input, t_output, false)
                } else {
                    let role = v
                        .get("role")
                        .and_then(|r| r.as_str())
                        .unwrap_or("assistant")
                        .to_string();
                    let content_str = v
                        .get("content")
                        .and_then(|c| c.as_str())
                        .unwrap_or("")
                        .to_string();
                    (role, content_str, None, None, None, false)
                };

            // Filter out internal env context blocks from title
            if role == "user"
                && first_user_prompt.is_empty()
                && !text_content.is_empty()
                && !text_content.starts_with("<environment_context>")
            {
                first_user_prompt = text_content.chars().take(80).collect();
            }

            if !text_content.is_empty() || tool_name.is_some() || tool_output.is_some() {
                messages.push(HistoryMessage {
                    id: format!("{}_{}", session_id, idx),
                    session_id: session_id.clone(),
                    role,
                    content: text_content,
                    sequence: idx as u32,
                    timestamp: updated_at,
                    tool_name,
                    tool_input,
                    tool_output,
                    is_error: is_err,
                    redacted: false,
                });
            }
        }

        let project_path = cwd
            .clone()
            .unwrap_or_else(|| "Unknown Directory".to_string());
        let project_name = if let Some(ref c) = cwd {
            Path::new(c)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "Codex Project".to_string())
        } else {
            "Codex Project".to_string()
        };

        let title = if !first_user_prompt.is_empty() {
            first_user_prompt
        } else {
            format!("Codex Session {}", &stem[..stem.len().min(8)])
        };

        let resume_uuid = Self::extract_codex_uuid(&stem).unwrap_or_else(|| stem.clone());

        let session = HistorySession {
            id: session_id,
            agent: "codex".to_string(),
            title,
            project_name,
            project_path,
            cwd: cwd.clone(),
            git_branch: None,
            created_at,
            updated_at,
            message_count: messages.len() as u32,
            is_active: false,
            file_path: Some(path.to_string_lossy().to_string()),
            source_hash: Some(loc.source_hash),
            can_resume: true,
            resume_command: Some(format!("codex resume {}", resume_uuid)),
        };

        Some((session, messages))
    }

    fn resume_command(&self, session: &HistorySession) -> Option<String> {
        if let Some(ref cmd) = session.resume_command {
            if let Some(uuid) = Self::extract_codex_uuid(cmd) {
                return Some(format!("codex resume {}", uuid));
            }
            return Some(cmd.clone());
        }
        if let Some(uuid) = Self::extract_codex_uuid(&session.id) {
            return Some(format!("codex resume {}", uuid));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_codex_uuid() {
        let raw = "rollout-2026-08-27T13-07-30-01a042e7-4d7d-72f2-885c-832fbd15883d";
        assert_eq!(
            CodexAdapter::extract_codex_uuid(raw),
            Some("01a042e7-4d7d-72f2-885c-832fbd15883d".to_string())
        );

        let cmd = "codex resume rollout-2026-08-27T13-07-30-01a042e7-4d7d-72f2-885c-832fbd15883d";
        assert_eq!(
            CodexAdapter::extract_codex_uuid(cmd),
            Some("01a042e7-4d7d-72f2-885c-832fbd15883d".to_string())
        );

        let session = HistorySession {
            id: "codex_rollout-2026-08-27T13-07-30-01a042e7-4d7d-72f2-885c-832fbd15883d"
                .to_string(),
            agent: "codex".to_string(),
            title: "Test".to_string(),
            project_name: "Test".to_string(),
            project_path: "/test".to_string(),
            cwd: None,
            git_branch: None,
            created_at: 0,
            updated_at: 0,
            message_count: 0,
            is_active: false,
            file_path: None,
            source_hash: None,
            can_resume: true,
            resume_command: Some(
                "codex resume rollout-2026-08-27T13-07-30-01a042e7-4d7d-72f2-885c-832fbd15883d"
                    .to_string(),
            ),
        };

        let adapter = CodexAdapter::new();
        assert_eq!(
            adapter.resume_command(&session),
            Some("codex resume 01a042e7-4d7d-72f2-885c-832fbd15883d".to_string())
        );
    }
}
