import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import { runAgentStream, type RunAgentOptions } from "@/modules/ai/lib/agent";
import { createContextAwareTransport } from "@/modules/ai/lib/transport";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import type { ToolContext } from "@/modules/ai/tools/context";
import { getOrCreateChat } from "@/modules/ai/store/chatRuntime";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";

const fixture = vi.hoisted(() => ({
  convert: vi.fn<() => Promise<ModelMessage[]>>(),
  mcp: vi.fn<() => Promise<Record<string, never>>>(),
  build: vi.fn(),
  stream: vi.fn(),
  compact: vi.fn(),
  model: vi.fn(),
}));
const originalModel = useChatStore.getState().selectedModelId;
const originalOllama = usePreferencesStore.getState().ollamaModelId;
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  convertToModelMessages: fixture.convert,
  streamText: fixture.stream,
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: () => fixture.model,
}));
vi.mock("@/modules/ai/tools/mcp", () => ({ loadMcpToolsForRun: fixture.mcp }));
vi.mock("@/modules/ai/tools/tools", () => ({ buildTools: fixture.build }));
vi.mock("@/modules/ai/lib/compact", () => ({
  compactModelMessagesDetailed: fixture.compact,
}));
vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  isAiRuntimeAvailable: () => true,
  requireAiRuntime: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

function deferred() {
  let finish = () => {};
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}
function context(): ToolContext {
  return {
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
  };
}
function options(ctx = context()): RunAgentOptions {
  return {
    keys: { ...EMPTY_PROVIDER_KEYS },
    modelId: "ollama-local",
    ollamaModelId: "fixture",
    toolContext: ctx,
    uiMessages: [],
  };
}
beforeEach(() => {
  chats.clear();
  fixture.model.mockReset().mockReturnValue({ modelId: "fixture" });
  fixture.convert.mockReset().mockResolvedValue([]);
  fixture.mcp.mockReset().mockResolvedValue({});
  fixture.build.mockReset().mockReturnValue({});
  fixture.compact
    .mockReset()
    .mockReturnValue({ messages: [], compacted: false, droppedCount: 0 });
  fixture.stream.mockReset().mockReturnValue({
    toUIMessageStream: () =>
      new ReadableStream({ start: (controller) => controller.close() }),
  });
});
afterEach(() => {
  chats.clear();
  useChatStore.setState({ selectedModelId: originalModel });
  usePreferencesStore.setState({ ollamaModelId: originalOllama });
});

for (const stage of ["model", "history", "mcp"] as const) {
  it.each(["stop", "abort", "forget", "caller"])(
    `does not start a provider after %s retires the ${stage} await`,
    async (reason) => {
      const opts = options();
      const controller = new AbortController();
      opts.abortSignal = controller.signal;
      let current = true;
      opts.isCurrent = () => current;
      const pending = deferred();
      if (stage === "history")
        fixture.convert.mockImplementationOnce(async () => {
          await pending.promise;
          return [];
        });
      if (stage === "mcp")
        fixture.mcp.mockImplementationOnce(async () => {
          await pending.promise;
          return {};
        });
      const request = runAgentStream(opts);
      const observed = expect(request).rejects.toThrow("retired");
      if (stage === "history")
        await vi.waitFor(() =>
          expect(fixture.convert).toHaveBeenCalledTimes(1),
        );
      if (stage === "mcp")
        await vi.waitFor(() => expect(fixture.mcp).toHaveBeenCalledTimes(1));
      if (reason === "stop") fileToolCallsFor(opts.toolContext).retireAll();
      if (reason === "forget") fileToolCallsFor(opts.toolContext).forget();
      if (reason === "abort") controller.abort();
      if (reason === "caller") current = false;
      pending.finish();
      await observed;
      expect(fixture.stream).not.toHaveBeenCalled();
      expect(fixture.build).not.toHaveBeenCalled();
      if (stage === "model") expect(fixture.convert).not.toHaveBeenCalled();
      if (stage !== "mcp") expect(fixture.mcp).not.toHaveBeenCalled();
    },
  );
}

it("refuses an already-aborted request before loading any model", async () => {
  const opts = options();
  const abort = new AbortController();
  abort.abort();
  opts.abortSignal = abort.signal;
  await expect(runAgentStream(opts)).rejects.toThrow("retired");
  expect(fixture.model).not.toHaveBeenCalled();
  expect(fixture.convert).not.toHaveBeenCalled();
  expect(fixture.stream).not.toHaveBeenCalled();
});

it("revalidates after a compaction callback retires its original owner", async () => {
  const opts = options();
  fixture.compact.mockReturnValue({
    messages: [],
    compacted: true,
    droppedCount: 1,
  });
  opts.onCompact = () => fileToolCallsFor(opts.toolContext).retireAll();
  await expect(runAgentStream(opts)).rejects.toThrow("retired");
  expect(fixture.mcp).not.toHaveBeenCalled();
  expect(fixture.stream).not.toHaveBeenCalled();
});

it("revalidates after tool construction before starting the provider", async () => {
  const opts = options();
  fixture.build.mockImplementationOnce(() => {
    fileToolCallsFor(opts.toolContext).retireAll();
    return {};
  });
  await expect(runAgentStream(opts)).rejects.toThrow("retired");
  expect(fixture.stream).not.toHaveBeenCalled();
});

it("a newer transport request prevents the older prepared request from starting its provider", async () => {
  const ctx = context();
  const transport = createContextAwareTransport({
    toolContext: ctx,
    getKeys: () => ({ ...EMPTY_PROVIDER_KEYS }),
    getModelId: () => "ollama-local",
    getOllamaModelId: () => "fixture",
    getCustomInstructions: () => "",
    getAgentPersona: () => null,
    getLive: () => ({
      cwd: null,
      workspaceRoot: null,
      activeFile: null,
      terminalPrivate: false,
    }),
  });
  const pending = deferred();
  fixture.convert.mockImplementationOnce(async () => {
    await pending.promise;
    return [];
  });
  const old = transport.sendMessages({ messages: [] });
  const observed = expect(old).rejects.toThrow("retired");
  await vi.waitFor(() => expect(fixture.convert).toHaveBeenCalledTimes(1));
  await transport.sendMessages({ messages: [] });
  pending.finish();
  await observed;
  expect(fixture.stream).toHaveBeenCalledTimes(1);
});

it("starts a fresh request after Stop without reviving the older preparation", async () => {
  const opts = options();
  const old = runAgentStream(opts);
  const observed = expect(old).rejects.toThrow("retired");
  fileToolCallsFor(opts.toolContext).retireAll();
  await runAgentStream(opts);
  await observed;
  expect(fixture.stream).toHaveBeenCalledTimes(1);
});

it.each(["signal", "caller"])(
  "retains the original %s rather than replacement options during setup",
  async (mode) => {
    const opts = options();
    const abort = new AbortController();
    let current = true;
    opts.abortSignal = abort.signal;
    opts.isCurrent = () => current;
    const pending = deferred();
    fixture.convert.mockImplementationOnce(async () => {
      await pending.promise;
      return [];
    });
    const request = runAgentStream(opts);
    const observed = expect(request).rejects.toThrow("retired");
    await vi.waitFor(() => expect(fixture.convert).toHaveBeenCalledTimes(1));
    if (mode === "signal") {
      opts.abortSignal = new AbortController().signal;
      abort.abort();
    } else {
      opts.isCurrent = () => true;
      current = false;
    }
    pending.finish();
    await observed;
    expect(fixture.stream).not.toHaveBeenCalled();
  },
);

it("retains the original tool context through setup without adopting mutated options", async () => {
  const opts = options();
  const original = opts.toolContext;
  const pending = deferred();
  fixture.convert.mockImplementationOnce(async () => {
    await pending.promise;
    return [];
  });
  const request = runAgentStream(opts);
  await vi.waitFor(() => expect(fixture.convert).toHaveBeenCalledTimes(1));
  opts.toolContext = context();
  pending.finish();
  await request;
  expect(fixture.build).toHaveBeenCalledExactlyOnceWith(
    original,
    {},
    undefined,
  );
});

it("revalidates callbacks from approval reconciliation before model setup", async () => {
  const opts = options();
  const calls = fileToolCallsFor(opts.toolContext);
  calls
    .capture(
      "call",
      "write_file",
      { path: "file.ts", content: "fixture" },
      {
        directory: "/fixture",
        root: "/fixture",
        workspace: { kind: "local" },
      },
      () => calls.retireAll(),
    )
    .bindApproval("approval");
  opts.uiMessages = [
    {
      id: "assistant",
      role: "assistant",
      parts: [
        {
          type: "tool-write_file",
          toolCallId: "call",
          state: "output-denied",
          input: { path: "file.ts", content: "fixture" },
          approval: { id: "approval", approved: false },
        },
      ],
    },
  ];
  await expect(runAgentStream(opts)).rejects.toThrow("retired");
  expect(fixture.convert).not.toHaveBeenCalled();
  expect(fixture.stream).not.toHaveBeenCalled();
});

it("honors direct SDK Stop during MCP loading and allows a fresh turn before the old load settles", async () => {
  useChatStore.setState({ selectedModelId: "ollama-local" });
  usePreferencesStore.setState({ ollamaModelId: "fixture" });
  const pending = deferred();
  fixture.mcp.mockImplementationOnce(async () => {
    await pending.promise;
    return {};
  });
  const chat = getOrCreateChat("original");
  const old = chat.sendMessage({ text: "first" });
  await vi.waitFor(() => expect(fixture.mcp).toHaveBeenCalledTimes(1));
  await chat.stop();
  await chat.sendMessage({ text: "fresh" });
  expect(fixture.stream).toHaveBeenCalledTimes(1);
  pending.finish();
  await old;
  expect(fixture.stream).toHaveBeenCalledTimes(1);
  expect(chat.error).toBeUndefined();
  expect(chat.status).toBe("ready");
});
