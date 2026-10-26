import type { ToolExecutionOptions } from "ai";
import { captureFileApproval } from "@/modules/ai/lib/fileToolApprovals";
import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const nativeMock = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
  readFile: vi.fn(async () => ({ kind: "text", content: "safe", size: 4 })),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("../lib/native", () => ({ native: nativeMock }));

import { buildFsTools } from "./fs";

const options: ToolExecutionOptions<Record<string, unknown>> = {
  toolCallId: "call",
  messages: [
    {
      role: "assistant",
      content: [
        {
          type: "tool-approval-request",
          toolCallId: "call",
          approvalId: "fixture-approval",
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-approval-response",
          approvalId: "fixture-approval",
          approved: true,
        },
      ],
    },
  ],
  context: {},
};

function context(): ToolContext {
  return {
    getFileContext: () => ({
      directory: "/workspace",
      workspace: { kind: "local" },
    }),
    getFileRootContext: () => ({
      root: "/workspace",
      workspace: { kind: "local" },
    }),
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "session",
  };
}

describe("AI filesystem workspace boundary", () => {
  it("refuses reads and writes outside the active workspace", async () => {
    const tools = buildFsTools(context());
    if (!tools.read_file.execute || !tools.write_file.execute)
      throw new Error("missing tool");
    await tools.read_file.onInputAvailable?.({
      input: { path: "/outside/file.ts" },
      ...options,
    });
    const read = (await tools.read_file.execute(
      { path: "/outside/file.ts" },
      options,
    )) as { error?: string };
    await tools.write_file.onInputAvailable?.({
      input: { path: "/outside/file.ts", content: "x" },
      ...options,
    });
    captureFileApproval(tools, {
      approvalId: "fixture-approval",
      toolCall: { toolName: "write_file", toolCallId: "call" },
    });
    const write = (await tools.write_file.execute(
      { path: "/outside/file.ts", content: "x" },
      options,
    )) as { error?: string };
    expect(read.error).toContain("outside the active workspace");
    expect(write.error).toContain("outside the active workspace");
    expect(nativeMock.readFile).not.toHaveBeenCalled();
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });
});
