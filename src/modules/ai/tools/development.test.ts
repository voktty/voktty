import type { ToolExecutionOptions } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const nativeMock = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
  shellBgSpawn: vi.fn(async () => 7),
  shellBgLogs: vi.fn(),
  shellBgKill: vi.fn(async () => undefined),
  gitResolveRepo: vi.fn(async () => null),
}));

const recordCommand = vi.hoisted(() => vi.fn());

vi.mock("../lib/native", () => ({ native: nativeMock }));
vi.mock("../lib/developmentChecks", () => ({
  discoverDevelopmentChecks: vi.fn(async () => [
    { kind: "tests", command: "pnpm test", source: "package.json" },
  ]),
}));
vi.mock("../store/planStore", () => ({
  usePlanStore: { getState: () => ({ recordCommand }) },
}));

import { buildDevelopmentTools } from "./development";

function context(): ToolContext {
  return {
    getCwd: () => "/repo",
    getWorkspaceRoot: () => "/repo",
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

describe("run_development_check", () => {
  it("refuses commands that were not discovered", async () => {
    const execute = buildDevelopmentTools(context()).run_development_check
      .execute;
    if (!execute) throw new Error("execute missing");
    const result = (await execute(
      { kind: "tests", command: "rm -rf /" },
      { toolCallId: "call", messages: [] },
    )) as { error?: string };
    expect(result.error).toContain("not a discovered workspace check");
    expect(nativeMock.shellBgSpawn).not.toHaveBeenCalled();
  });

  it("kills the background process when the agent run is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const options: ToolExecutionOptions = {
      toolCallId: "call",
      messages: [],
      abortSignal: controller.signal,
    };
    const execute = buildDevelopmentTools(context()).run_development_check
      .execute;
    if (!execute) throw new Error("execute missing");
    const result = (await execute(
      { kind: "tests", command: "pnpm test", timeout_secs: 30 },
      options,
    )) as { cancelled?: boolean };
    expect(result.cancelled).toBe(true);
    expect(nativeMock.shellBgKill).toHaveBeenCalledWith(7);
    expect(recordCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: "pnpm test", cancelled: true }),
    );
  });
});
