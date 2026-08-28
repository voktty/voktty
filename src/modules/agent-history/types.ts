export type AgentType =
  | "voktty"
  | "claude"
  | "codex"
  | "cursor"
  | "gemini"
  | "kimi"
  | "opencode"
  | string;

export interface HistorySession {
  id: string;
  agent: string;
  title: string;
  project_name: string;
  project_path: string;
  cwd: string | null;
  git_branch: string | null;
  created_at: number;
  updated_at: number;
  message_count: number;
  is_active: boolean;
  file_path: string | null;
  source_hash: string | null;
  can_resume: boolean;
  resume_command: string | null;
}

export interface HistoryMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system" | "tool" | string;
  content: string;
  sequence: number;
  timestamp: number;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  is_error: boolean;
  redacted: boolean;
}

export interface SessionFilter {
  search_query?: string;
  agent?: string;
  project?: string;
  from_timestamp?: number;
  to_timestamp?: number;
  limit?: number;
  offset?: number;
}

export interface HistoryStats {
  total_sessions: number;
  total_messages: number;
  agents_count: Record<string, number>;
  projects_count: Record<string, number>;
  last_scan_timestamp: number;
}