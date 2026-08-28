use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    Voktty,
    Claude,
    Codex,
    Cursor,
    Gemini,
    Kimi,
    OpenCode,
    Custom(String),
}

impl AgentType {
    pub fn as_str(&self) -> &str {
        match self {
            AgentType::Voktty => "voktty",
            AgentType::Claude => "claude",
            AgentType::Codex => "codex",
            AgentType::Cursor => "cursor",
            AgentType::Gemini => "gemini",
            AgentType::Kimi => "kimi",
            AgentType::OpenCode => "opencode",
            AgentType::Custom(s) => s.as_str(),
        }
    }
}

impl std::str::FromStr for AgentType {
    type Err = std::convert::Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s.to_lowercase().as_str() {
            "voktty" => AgentType::Voktty,
            "claude" | "claude_code" | "claudecode" => AgentType::Claude,
            "codex" => AgentType::Codex,
            "cursor" => AgentType::Cursor,
            "gemini" => AgentType::Gemini,
            "kimi" | "kimi_code" => AgentType::Kimi,
            "opencode" => AgentType::OpenCode,
            other => AgentType::Custom(other.to_string()),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistorySession {
    pub id: String,
    pub agent: String,
    pub title: String,
    pub project_name: String,
    pub project_path: String,
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: u32,
    pub is_active: bool,
    pub file_path: Option<String>,
    pub source_hash: Option<String>,
    pub can_resume: bool,
    pub resume_command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
    Tool,
}

impl MessageRole {
    pub fn as_str(&self) -> &str {
        match self {
            MessageRole::User => "user",
            MessageRole::Assistant => "assistant",
            MessageRole::System => "system",
            MessageRole::Tool => "tool",
        }
    }
}

impl std::str::FromStr for MessageRole {
    type Err = std::convert::Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s.to_lowercase().as_str() {
            "user" | "human" => MessageRole::User,
            "assistant" | "model" | "bot" => MessageRole::Assistant,
            "system" => MessageRole::System,
            "tool" | "tool_result" | "function" => MessageRole::Tool,
            _ => MessageRole::Assistant,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub sequence: u32,
    pub timestamp: i64,
    pub tool_name: Option<String>,
    pub tool_input: Option<String>,
    pub tool_output: Option<String>,
    pub is_error: bool,
    pub redacted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionFilter {
    pub search_query: Option<String>,
    pub agent: Option<String>,
    pub project: Option<String>,
    pub from_timestamp: Option<i64>,
    pub to_timestamp: Option<i64>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryStats {
    pub total_sessions: u32,
    pub total_messages: u32,
    pub agents_count: std::collections::HashMap<String, u32>,
    pub projects_count: std::collections::HashMap<String, u32>,
    pub last_scan_timestamp: i64,
}