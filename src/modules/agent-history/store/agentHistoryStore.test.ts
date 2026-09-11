import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentHistoryStore } from "./agentHistoryStore";
import * as bridge from "../lib/agentHistoryBridge";
import type { HistoryMessage, HistorySession } from "../types";

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
      items: [], offset: 0, limit: 100, total: 0, hasMore: false, scanning: false,
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
      error: null,
      searchQuery: "",
      selectedAgent: "all",
      selectedProject: "",
      stats: null,
      hasMore: false,
      offset: 0,
      nextOffset: 0,
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
      items: [mockSession], offset: 0, limit: 100, total: 1, hasMore: false, scanning: false,
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
      nextOffset: 1,
    });
    vi.mocked(bridge.fetchSessionPage).mockResolvedValueOnce({
      items: [{ id: "s2", agent: "codex", title: "Two", project_name: "p", project_path: "/p", cwd: "/p", git_branch: null, created_at: 2, updated_at: 2, message_count: 1, is_active: false, file_path: null, source_hash: null, can_resume: true, resume_command: null }],
      offset: 1, limit: 100, total: 2, hasMore: false, scanning: false,
    });
    await useAgentHistoryStore.getState().loadMoreSessions();
    expect(useAgentHistoryStore.getState().sessions.map((session) => session.id)).toEqual(["s1", "s2"]);
    expect(bridge.fetchMessages).not.toHaveBeenCalled();
  });

  it("keeps the current filters and cursor when loading another page", async () => {
    useAgentHistoryStore.setState({
      sessions: [],
      hasMore: true,
      nextOffset: 200,
      searchQuery: "oauth",
      selectedAgent: "codex",
      selectedProject: "voktty",
    });
    await useAgentHistoryStore.getState().loadMoreSessions();
    expect(bridge.fetchSessionPage).toHaveBeenCalledWith({
      limit: 100,
      offset: 200,
      search_query: "oauth",
      agent: "codex",
      project: "voktty",
    });
  });

  it("ignores a stale transcript response after another session is selected", async () => {
    let resolveFirst: (messages: HistoryMessage[]) => void;
    const first = new Promise<HistoryMessage[]>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(bridge.fetchMessages)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce([]);
    useAgentHistoryStore.setState({
      sessions: [
        { id: "s1", agent: "codex", title: "One", project_name: "p", project_path: "/p", cwd: "/p", git_branch: null, created_at: 1, updated_at: 1, message_count: 1, is_active: false, file_path: null, source_hash: null, can_resume: true, resume_command: null },
        { id: "s2", agent: "codex", title: "Two", project_name: "p", project_path: "/p", cwd: "/p", git_branch: null, created_at: 2, updated_at: 2, message_count: 1, is_active: false, file_path: null, source_hash: null, can_resume: true, resume_command: null },
      ],
    });
    const firstSelection = useAgentHistoryStore.getState().selectSession("s1");
    await useAgentHistoryStore.getState().selectSession("s2");
    resolveFirst!([{ id: "old", session_id: "s1", role: "user", content: "old", sequence: 1, timestamp: 1, tool_name: null, tool_input: null, tool_output: null, is_error: false, redacted: false }]);
    await firstSelection;
    expect(useAgentHistoryStore.getState().activeSessionId).toBe("s2");
    expect(useAgentHistoryStore.getState().messages).toEqual([]);
  });

  it("keeps the modal state stable when a page request fails", async () => {
    vi.mocked(bridge.fetchSessionPage).mockRejectedValueOnce(new Error("index unavailable"));
    await useAgentHistoryStore.getState().loadSessions();
    const state = useAgentHistoryStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBe("index unavailable");
  });
});
