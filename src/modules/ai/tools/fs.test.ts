import type { ToolExecutionOptions } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const nativeMock = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
  readFile: vi.fn(async () => ({ kind: "text", content: "safe", size: 4 })),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("../lib/native", () => ({ native: nativeMock }));

import { buildFsTools } from "./fs";

const options: ToolExecutionOptions = { toolCallId: "call", messages: [] };

function context(): ToolContext {
  return {
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
    const read = (await tools.read_file.execute(
      { path: "/outside/file.ts" },
      options,
    )) as { error?: string };
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
