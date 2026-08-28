import { invoke } from "@tauri-apps/api/core";
import type { HistoryMessage, HistorySession, HistoryStats, SessionFilter } from "../types";

export async function fetchSessions(filter?: SessionFilter): Promise<HistorySession[]> {
  try {
    return await invoke<HistorySession[]>("agent_history_get_sessions", { filter });
  } catch (err) {
    console.error("agent_history_get_sessions error:", err);
    return [];
  }
}

export async function fetchMessages(
  sessionId: string,
  offset = 0,
  limit = 200,
): Promise<HistoryMessage[]> {
  try {
    return await invoke<HistoryMessage[]>("agent_history_get_messages", {
      sessionId,
      offset,
      limit,
    });
  } catch (err) {
    console.error("agent_history_get_messages error:", err);
    return [];
  }
}

export async function rescanHistory(): Promise<HistoryStats | null> {
  try {
    return await invoke<HistoryStats>("agent_history_rescan");
  } catch (err) {
    console.error("agent_history_rescan error:", err);
    return null;
  }
}

export async function deleteHistorySession(sessionId: string): Promise<boolean> {
  try {
    await invoke("agent_history_delete_session", { sessionId });
    return true;
  } catch (err) {
    console.error("agent_history_delete_session error:", err);
    return false;
  }
}

export async function clearAllHistory(): Promise<boolean> {
  try {
    await invoke("agent_history_clear_all");
    return true;
  } catch (err) {
    console.error("agent_history_clear_all error:", err);
    return false;
  }
}

export async function getResumeCommand(sessionId: string): Promise<string | null> {
  try {
    return await invoke<string | null>("agent_history_get_resume_command", { sessionId });
  } catch (err) {
    console.error("agent_history_get_resume_command error:", err);
    return null;
  }
}

export async function exportSessionMarkdown(sessionId: string): Promise<string> {
  try {
    return await invoke<string>("agent_history_export_markdown", { sessionId });
  } catch (err) {
    console.error("agent_history_export_markdown error:", err);
    return "";
  }
}

export async function fetchHistoryStats(): Promise<HistoryStats | null> {
  try {
    return await invoke<HistoryStats>("agent_history_get_stats");
  } catch (err) {
    console.error("agent_history_get_stats error:", err);
    return null;
  }
}