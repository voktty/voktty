use super::{AgentHistoryAdapter, SessionLocation};
use crate::modules::agent_history::models::{HistoryMessage, HistorySession};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Default)]
pub struct GeminiAdapter;

impl GeminiAdapter {
    pub fn new() -> Self {
        Self
    }

    fn gemini_brain_dirs() -> Vec<PathBuf> {
        let mut dirs_list = Vec::new();
        if let Some(h) = dirs::home_dir() {
            let candidates = [
                h.join(".gemini").join("antigravity-cli").join("brain"),
                h.join(".gemini").join("antigravity").join("brain"),
                h.join(".gemini").join("brain"),
                h.join(".antigravity").join("brain"),
                h.join(".antigravity-cli").join("brain"),
            ];
            for dir in candidates {
                if dir.is_dir() {
                    dirs_list.push(dir);
                }
            }
        }
        dirs_list
    }
}

impl AgentHistoryAdapter for GeminiAdapter {
    fn id(&self) -> &str {
        "gemini"
    }

    fn name(&self) -> &str {
        "Antigravity"
    }

    fn is_installed(&self) -> bool {
        !Self::gemini_brain_dirs().is_empty()
    }

    fn scan(&self) -> Vec<SessionLocation> {
        let mut list = Vec::new();
        for brain_dir in Self::gemini_brain_dirs() {
            if let Ok(entries) = std::fs::read_dir(&brain_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let transcript_path = path
                            .join(".system_generated")
                            .join("logs")
                            .join("transcript.jsonl");
                        if transcript_path.is_file() {
                            if let Some(loc) = SessionLocation::from_path(transcript_path) {
                                list.push(loc);
                            }
                        }
                    }
                }
            }
        }
        list
    }

    fn parse_session(&self, path: &Path) -> Option<(HistorySession, Vec<HistoryMessage>)> {
        let content = std::fs::read_to_string(path).ok()?;
        let loc = SessionLocation::from_path(path.to_path_buf())?;

        // Extract session ID from parent directory: .../<session-uuid>/.system_generated/logs/transcript.jsonl
        let session_uuid = path
            .parent() // logs
            .and_then(|p| p.parent()) // .system_generated
            .and_then(|p| p.parent()) // <session_uuid>
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "gemini_session".to_string());

        let session_id = format!("gemini_{}", session_uuid);
        let resume_cmd = Some(format!("agy --conversation={}", session_uuid));

        let mut messages = Vec::new();
        let mut first_user_prompt = String::new();
        let mut created_at = loc.last_modified;
        let mut updated_at = loc.last_modified;
        let mut project_path = String::new();
        let mut project_name = "Antigravity Workspace".to_string();

        for (idx, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let Ok(v) = serde_json::from_str::<Value>(line) else {
                continue;
            };

            let step_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let content_str = v.get("content").and_then(|c| c.as_str()).unwrap_or("");

            // Parse timestamp if available
            let ts = if let Some(dt_str) = v.get("created_at").and_then(|s| s.as_str()) {
                chrono::DateTime::parse_from_rfc3339(dt_str)
                    .map(|dt| dt.timestamp())
                    .unwrap_or(loc.last_modified)
            } else {
                loc.last_modified
            };

            if idx == 0 {
                created_at = ts;
            }
            updated_at = ts;

            // Extract project path or prompt
            if step_type == "USER_INPUT"
                || v.get("source").and_then(|s| s.as_str()) == Some("USER_EXPLICIT")
            {
                let clean_text = if let Some(start) = content_str.find("<USER_REQUEST>") {
                    if let Some(end) = content_str.find("</USER_REQUEST>") {
                        content_str[start + "<USER_REQUEST>".len()..end].trim()
                    } else {
                        content_str
                    }
                } else {
                    content_str
                };

                if first_user_prompt.is_empty() && !clean_text.is_empty() {
                    first_user_prompt = clean_text.chars().take(90).collect();
                }

                // Look for workspace path in metadata if not yet found
                if project_path.is_empty() {
                    if let Some(idx_cwd) = content_str.find("C:\\") {
                        let end_idx = content_str[idx_cwd..]
                            .find(['\n', '<', '"', ']'])
                            .unwrap_or(30);
                        project_path = content_str[idx_cwd..idx_cwd + end_idx].trim().to_string();
                    } else if let Some(idx_cwd) = content_str.find("/Users/") {
                        let end_idx = content_str[idx_cwd..]
                            .find(['\n', '<', '"', ']'])
                            .unwrap_or(30);
                        project_path = content_str[idx_cwd..idx_cwd + end_idx].trim().to_string();
                    }
                }

                messages.push(HistoryMessage {
                    id: format!("{}_{}", session_id, idx),
                    session_id: session_id.clone(),
                    role: "user".to_string(),
                    content: clean_text.to_string(),
                    sequence: idx as u32,
                    timestamp: ts,
                    tool_name: None,
                    tool_input: None,
                    tool_output: None,
                    is_error: false,
                    redacted: false,
                });
            } else if step_type == "PLANNER_RESPONSE"
                || v.get("source").and_then(|s| s.as_str()) == Some("MODEL")
            {
                let mut tool_name = None;
                let mut tool_input = None;

                if let Some(tool_calls) = v.get("tool_calls").and_then(|tc| tc.as_array()) {
                    if let Some(first_tc) = tool_calls.first() {
                        tool_name = first_tc
                            .get("name")
                            .and_then(|n| n.as_str())
                            .map(|s| s.to_string());
                        tool_input = first_tc.get("args").map(|a| a.to_string());

                        // Check if args contains cwd / path
                        if project_path.is_empty() {
                            if let Some(args) = first_tc.get("args") {
                                for key in &[
                                    "Cwd",
                                    "DirectoryPath",
                                    "SearchPath",
                                    "TargetFile",
                                    "AbsolutePath",
                                ] {
                                    if let Some(p) = args.get(*key).and_then(|v| v.as_str()) {
                                        if !p.is_empty() {
                                            project_path = p.to_string();
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if !content_str.is_empty() || tool_name.is_some() {
                    messages.push(HistoryMessage {
                        id: format!("{}_{}", session_id, idx),
                        session_id: session_id.clone(),
                        role: "assistant".to_string(),
                        content: content_str.to_string(),
                        sequence: idx as u32,
                        timestamp: ts,
                        tool_name,
                        tool_input,
                        tool_output: None,
                        is_error: false,
                        redacted: false,
                    });
                }
            }
        }

        if !project_path.is_empty() {
            if let Some(name) = Path::new(&project_path).file_name() {
                project_name = name.to_string_lossy().to_string();
            }
        }

        let title = if !first_user_prompt.is_empty() {
            first_user_prompt
        } else {
            format!(
                "Antigravity Task {}",
                &session_uuid[..session_uuid.len().min(8)]
            )
        };

        let session = HistorySession {
            id: session_id,
            agent: "gemini".to_string(),
            title,
            project_name,
            project_path: if project_path.is_empty() {
                "Local Workspace".to_string()
            } else {
                project_path.clone()
            },
            cwd: if project_path.is_empty() {
                None
            } else {
                Some(project_path)
            },
            git_branch: None,
            created_at,
            updated_at,
            message_count: messages.len() as u32,
            is_active: false,
            file_path: Some(path.to_string_lossy().to_string()),
            source_hash: Some(loc.source_hash),
            can_resume: true,
            resume_command: resume_cmd,
        };

        Some((session, messages))
    }

    fn resume_command(&self, session: &HistorySession) -> Option<String> {
        let clean_uuid = session.id.strip_prefix("gemini_").unwrap_or(&session.id);
        Some(format!("agy --conversation={}", clean_uuid))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gemini_adapter_name_and_id() {
        let adapter = GeminiAdapter::new();
        assert_eq!(adapter.id(), "gemini");
        assert_eq!(adapter.name(), "Antigravity");
    }

    #[test]
    fn test_gemini_resume_command_generation() {
        let adapter = GeminiAdapter::new();
        let session = HistorySession {
            id: "gemini_8c9a2f19-8f66-4eb2-9367-1937d9b26e6d".to_string(),
            agent: "gemini".to_string(),
            title: "Test Antigravity Task".to_string(),
            project_name: "Test".to_string(),
            project_path: "C:\\test".to_string(),
            cwd: Some("C:\\test".to_string()),
            git_branch: None,
            created_at: 0,
            updated_at: 0,
            message_count: 1,
            is_active: false,
            file_path: None,
            source_hash: None,
            can_resume: true,
            resume_command: None,
        };

        let cmd = adapter.resume_command(&session);
        assert_eq!(
            cmd,
            Some("agy --conversation=8c9a2f19-8f66-4eb2-9367-1937d9b26e6d".to_string())
        );
    }
}
