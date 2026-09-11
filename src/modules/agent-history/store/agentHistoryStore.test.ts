import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentHistoryStore } from "./agentHistoryStore";
import * as bridge from "../lib/agentHistoryBridge";
import type { HistorySession } from "../types";

vi.mock("../lib/agentHistoryBridge", () => ({
  fetchSessionPage: vi.fn(),
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
    vi.mocked(bridge.fetchSessionPage).mockResolvedValue({
      items: [], offset: 0, limit: 100, total: 0, has_more: false, scanning: false,
    });
    vi.mocked(bridge.fetchHistoryStats).mockResolvedValue(null);
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
      hasMore: false,
      offset: 0,
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

  it("does not start a full scan when the persisted index is empty", async () => {
    useAgentHistoryStore.getState().openHistory();
    await vi.waitFor(() => expect(bridge.fetchSessionPage).toHaveBeenCalledOnce());
    expect(bridge.rescanHistory).not.toHaveBeenCalled();
  });

  it("loads the first page without reading a transcript", async () => {
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

    vi.mocked(bridge.fetchSessionPage).mockResolvedValue({
      items: [mockSession], offset: 0, limit: 100, total: 1, has_more: false, scanning: false,
    });
    vi.mocked(bridge.fetchHistoryStats).mockResolvedValue({
      total_sessions: 1,
      total_messages: 5,
      agents_count: { claude: 1 },
      projects_count: { voktty: 1 },
      last_scan_timestamp: 1700000000,
    });
    await useAgentHistoryStore.getState().loadSessions();

    const state = useAgentHistoryStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBeNull();
    expect(bridge.fetchMessages).not.toHaveBeenCalled();
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

  it("appends the next page without reloading messages", async () => {
    useAgentHistoryStore.setState({
      sessions: [{ id: "s1", agent: "codex", title: "One", project_name: "p", project_path: "/p", cwd: "/p", git_branch: null, created_at: 1, updated_at: 1, message_count: 1, is_active: false, file_path: null, source_hash: null, can_resume: true, resume_command: null }],
      hasMore: true,
      offset: 0,
    });
    vi.mocked(bridge.fetchSessionPage).mockResolvedValueOnce({
      items: [{ id: "s2", agent: "codex", title: "Two", project_name: "p", project_path: "/p", cwd: "/p", git_branch: null, created_at: 2, updated_at: 2, message_count: 1, is_active: false, file_path: null, source_hash: null, can_resume: true, resume_command: null }],
      offset: 1, limit: 100, total: 2, has_more: false, scanning: false,
    });
    await useAgentHistoryStore.getState().loadMoreSessions();
    expect(useAgentHistoryStore.getState().sessions.map((session) => session.id)).toEqual(["s1", "s2"]);
    expect(bridge.fetchMessages).not.toHaveBeenCalled();
  });
});
