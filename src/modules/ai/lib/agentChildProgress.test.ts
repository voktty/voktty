import { beforeEach, expect, it, vi } from "vitest";
import type { ToolExecutionOptions } from "ai";
import type { ChatTools, ToolContext } from "@/modules/ai/tools/tools";
import { runAgentStream } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";

const fixture = vi.hoisted(() => ({
  stream: vi.fn<(args: { tools: ChatTools }) => object>(),
  child: vi.fn(),
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  convertToModelMessages: vi.fn(async () => []),
  streamText: fixture.stream,
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: () => () => ({ modelId: "fixture" }),
}));
vi.mock("@/modules/ai/agents/runSubagent", () => ({
  runSubagent: fixture.child,
}));
vi.mock("@/modules/ai/tools/mcp", () => ({
  loadMcpToolsForRun: async () => ({}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

beforeEach(() => {
  fixture.stream.mockClear().mockReturnValue({});
  fixture.child.mockReset().mockImplementation(async (args) => {
    args.onStep?.("original child");
    return { summary: "done", stepCount: 1, durationMs: 1 };
  });
});

it.each([false, true])(
  "routes child progress through the original model run with override=%s",
  async (override) => {
    const original = vi.fn();
    const replacement = vi.fn();
    const scoped = vi.fn();
    const ctx: ToolContext = {
      getCwd: () => null,
      getWorkspaceRoot: () => null,
      getTerminalContext: () => null,
      isActiveTerminalPrivate: () => false,
      injectIntoActivePty: () => false,
      openPreview: () => false,
      spawnAgent: () => null,
      readAgentOutput: () => null,
      readCache: new Map(),
      getSessionId: () => "fixture",
      onAgentStep: original,
    };
    await runAgentStream({
      keys: { ...EMPTY_PROVIDER_KEYS },
      modelId: "ollama-local",
      ollamaModelId: "fixture",
      toolContext: ctx,
      uiMessages: [],
      onSubagentStep: override ? scoped : undefined,
    });
    ctx.onAgentStep = replacement;
    const execute = fixture.stream.mock.calls[0][0].tools.run_subagent.execute;
    if (!execute) throw new Error("Missing subagent tool");
    const options: ToolExecutionOptions<Record<string, unknown>> = {
      toolCallId: "child",
      messages: [],
      context: {},
    };
    await execute({ type: "explore", prompt: "fixture" }, options);
    expect(override ? scoped : original).toHaveBeenCalledExactlyOnceWith(
      "original child",
    );
    expect(override ? original : scoped).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
    expect(fixture.child).toHaveBeenCalledWith(
      expect.objectContaining({ toolContext: ctx }),
    );
  },
);
