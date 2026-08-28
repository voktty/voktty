import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAgentHistoryTools } from "./agentHistory";
import * as agentHistoryModule from "@/modules/agent-history";
import type { ToolContext } from "./context";

vi.mock("@/modules/agent-history", () => ({
  fetchSessions: vi.fn(),
  fetchMessages: vi.fn(),
}));

describe("agentHistory AI tools", () => {
  const mockContext = {} as ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("history_search_sessions executes and returns formatted results", async () => {
    vi.mocked(agentHistoryModule.fetchSessions).mockResolvedValue([
      {
        id: "claude_999",
        agent: "claude",
        title: "Database migration debugging",
        project_name: "voktty",
        project_path: "/workspace",
        cwd: "/workspace",
        git_branch: "main",
        created_at: 1700000000,
        updated_at: 1700000100,
        message_count: 8,
        is_active: false,
        file_path: "/path",
        source_hash: "abc",
        can_resume: true,
        resume_command: "claude --resume claude_999",
      },
    ]);

    const tools = buildAgentHistoryTools(mockContext);
    const result = await (tools.history_search_sessions as any).execute({
      query: "migration",
      agent: "claude",
    });

    expect(result.status).toBe("success");
    expect(result.total_found).toBe(1);
    expect(result.results[0].title).toBe("Database migration debugging");
  });

  it("history_get_session_summary returns sanitized message transcript", async () => {
    vi.mocked(agentHistoryModule.fetchMessages).mockResolvedValue([
      {
        id: "m1",
        session_id: "claude_999",
        role: "user",
        content: "Fix migration schema",
        sequence: 0,
        timestamp: 1700000000,
        tool_name: null,
        tool_input: null,
        tool_output: null,
        is_error: false,
        redacted: false,
      },
      {
        id: "m2",
        session_id: "claude_999",
        role: "assistant",
        content: "I will update the migration file",
        sequence: 1,
        timestamp: 1700000010,
        tool_name: "edit",
        tool_input: '{"path": "mig.sql"}',
        tool_output: "ok",
        is_error: false,
        redacted: true,
      },
    ]);

    const tools = buildAgentHistoryTools(mockContext);
    const result = await (tools.history_get_session_summary as any).execute({
      session_id: "claude_999",
    });

    expect(result.status).toBe("success");
    expect(result.total_messages).toBe(2);
    expect(result.transcript[1].redacted).toBe(true);
  });
});