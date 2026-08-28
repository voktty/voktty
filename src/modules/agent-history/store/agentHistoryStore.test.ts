import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentHistoryStore } from "./agentHistoryStore";
import * as bridge from "../lib/agentHistoryBridge";
import type { HistorySession } from "../types";

vi.mock("../lib/agentHistoryBridge", () => ({
  fetchSessions: vi.fn(),
  fetchMessages: vi.fn(),
  rescanHistory: vi.fn(),
  deleteHistorySession: vi.fn(),
  clearAllHistory: vi.fn(),
  getResumeCommand: vi.fn(),
  exportSessionMarkdown: vi.fn(),
  fetchHistoryStats: vi.fn(),
}));

describe("agentHistoryStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentHistoryStore.setState({
      isOpen: false,
      sessions: [],
      activeSessionId: null,
      activeSession: null,
      messages: [],
      isLoading: false,
      isScanning: false,
      searchQuery: "",
      selectedAgent: "all",
      selectedProject: "",
      stats: null,
    });
  });

  it("toggles and opens history modal", () => {
    const store = useAgentHistoryStore.getState();
    expect(store.isOpen).toBe(false);

    store.openHistory();
    expect(useAgentHistoryStore.getState().isOpen).toBe(true);

    store.closeHistory();
    expect(useAgentHistoryStore.getState().isOpen).toBe(false);
  });

  it("loads sessions and sets first active session", async () => {
    const mockSession: HistorySession = {
      id: "claude_123",
      agent: "claude",
      title: "Fix OAuth2 Bug",
      project_name: "voktty",
      project_path: "/projects/voktty",
      cwd: "/projects/voktty",
      git_branch: "main",
      created_at: 1700000000,
      updated_at: 1700000500,
      message_count: 5,
      is_active: false,
      file_path: "/path/to/session.jsonl",
      source_hash: "123_456",
      can_resume: true,
      resume_command: "claude --resume claude_123",
    };

    vi.mocked(bridge.fetchSessions).mockResolvedValue([mockSession]);
    vi.mocked(bridge.fetchHistoryStats).mockResolvedValue({
      total_sessions: 1,
      total_messages: 5,
      agents_count: { claude: 1 },
      projects_count: { voktty: 1 },
      last_scan_timestamp: 1700000000,
    });
    vi.mocked(bridge.fetchMessages).mockResolvedValue([
      {
        id: "msg_1",
        session_id: "claude_123",
        role: "user",
        content: "Fix OAuth",
        sequence: 1,
        timestamp: 1700000000,
        tool_name: null,
        tool_input: null,
        tool_output: null,
        is_error: false,
        redacted: false,
      },
    ]);

    await useAgentHistoryStore.getState().loadSessions();

    const state = useAgentHistoryStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe("claude_123");
    expect(state.activeSession?.title).toBe("Fix OAuth2 Bug");
  });

  it("handles deleteSession properly", async () => {
    useAgentHistoryStore.setState({
      sessions: [
        {
          id: "session_1",
          agent: "voktty",
          title: "Session 1",
          project_name: "p1",
          project_path: "/p1",
          cwd: null,
          git_branch: null,
          created_at: 100,
          updated_at: 100,
          message_count: 1,
          is_active: false,
          file_path: null,
          source_hash: null,
          can_resume: false,
          resume_command: null,
        },
      ],
      activeSessionId: "session_1",
    });

    vi.mocked(bridge.deleteHistorySession).mockResolvedValue(true);

    await useAgentHistoryStore.getState().deleteSession("session_1");

    const state = useAgentHistoryStore.getState();
    expect(state.sessions).toHaveLength(0);
    expect(state.activeSessionId).toBeNull();
  });
});