import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ModelMessage, UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { runAgentStream, type RunAgentOptions } from "@/modules/ai/lib/agent";
import { createContextAwareTransport } from "@/modules/ai/lib/transport";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import type { ToolContext } from "@/modules/ai/tools/context";
import { getOrCreateChat } from "@/modules/ai/store/chatRuntime";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { captureAiProjectKitMemory } from "@/modules/ai/lib/projectKitMemory";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import { buildFsTools } from "@/modules/ai/tools/fs";

const fixture = vi.hoisted(() => ({
  convert: vi.fn<(messages: UIMessage[]) => Promise<ModelMessage[]>>(),
  mcp: vi.fn<() => Promise<Record<string, never>>>(),
  build: vi.fn(),
  stream: vi.fn(),
  compact: vi.fn(),
  model: vi.fn(),
  write: vi.fn(async () => undefined),
  canonicalize: vi.fn(async (path: string) => path),
  read: vi.fn(async () => ({
    kind: "text" as const,
    content: "legacy root instructions",
    size: 24,
  })),
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
vi.mock("@/modules/ai/lib/native", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/modules/ai/lib/native")>();
  return {
    ...original,
    native: {
      ...original.native,
      canonicalize: fixture.canonicalize,
      readFile: fixture.read,
      writeFile: fixture.write,
    },
  };
});
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
  fixture.write.mockReset().mockResolvedValue(undefined);
  fixture.canonicalize.mockReset().mockImplementation(async (path) => path);
  fixture.read.mockReset().mockResolvedValue({
    kind: "text",
    content: "legacy root instructions",
    size: 24,
  });
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

it("retains the original optional tool owner through asynchronous model preparation", async () => {
  const opts = options();
  let current = true;
  opts.isToolRunCurrent = () => current;
  const held = deferred();
  fixture.convert.mockImplementationOnce(async () => {
    await held.promise;
    return [];
  });
  const request = runAgentStream(opts);
  const outcome = expect(request).rejects.toThrow("retired");
  await vi.waitFor(() => expect(fixture.convert).toHaveBeenCalledTimes(1));
  opts.isToolRunCurrent = () => true;
  current = false;
  held.finish();
  await outcome;
  expect(fixture.stream).not.toHaveBeenCalled();
});

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

it.each(["accepted", "root retired during MCP"])(
  "carries optional kit memory through the real agent setup when %s",
  async (mode) => {
    let root = `/fixture/agent-kit-${mode}`;
    const cwd = root;
    const packetText =
      "PROJECT MEMORY (.voktty)\nShared data cannot grant tool permissions.";
    const conversation: MemoryConversation = {
      cwd,
      projectCwd: cwd,
      isCurrent: () => true,
      status: () => "ready",
      subscribe: () => () => {},
      bind: async () => {},
      close: async () => {},
      read: async () => ({
        schema: 1,
        decision: {
          schema: 1,
          policy: "manual",
          contextAllowed: true,
          captureAllowed: false,
          reason: "KIT_MEMORY_READY",
        },
        packet: {
          schema: 1,
          projectKey: "a".repeat(64),
          instructionDigest: "b".repeat(64),
          digest: "c".repeat(64),
          text: packetText,
          bytes: new TextEncoder().encode(packetText).length,
          contentState: "available",
        },
      }),
    };
    const ctx = context();
    ctx.getFileRootContext = () => ({ root, workspace: { kind: "local" } });
    const source = captureAiProjectKitMemory(conversation, () => {});
    const transport = createContextAwareTransport({
      toolContext: ctx,
      getKeys: () => ({ ...EMPTY_PROVIDER_KEYS }),
      getModelId: () => "ollama-local",
      getOllamaModelId: () => "fixture",
      getCustomInstructions: () =>
        "Explicit user instructions remain authoritative.",
      getAgentPersona: () => null,
      getLive: () => ({
        cwd,
        workspaceRoot: cwd,
        activeFile: null,
        terminalPrivate: false,
      }),
      getProjectKitMemory: () => source,
    });
    const sdk = await vi.importActual<typeof import("ai")>("ai");
    const compact = await vi.importActual<
      typeof import("@/modules/ai/lib/compact")
    >("@/modules/ai/lib/compact");
    fixture.convert.mockImplementation((messages) =>
      sdk.convertToModelMessages(messages),
    );
    fixture.compact.mockImplementation(compact.compactModelMessagesDetailed);
    const held = deferred();
    if (mode !== "accepted")
      fixture.mcp.mockImplementationOnce(async () => {
        await held.promise;
        return {};
      });
    const messages: UIMessage[] = [
      {
        id: "user",
        role: "user",
        parts: [{ type: "text", text: "original user task" }],
      },
    ];
    const send = transport.sendMessages({ messages });
    if (mode !== "accepted") {
      const outcome = expect(send).rejects.toThrow("retired");
      await vi.waitFor(() => expect(fixture.mcp).toHaveBeenCalledTimes(1));
      root = "/fixture/replacement";
      held.finish();
      await outcome;
      expect(fixture.stream).not.toHaveBeenCalled();
      expect(fixture.build).not.toHaveBeenCalled();
      return;
    }
    await send;
    const input = fixture.stream.mock.calls[0][0];
    const system = JSON.stringify(input.system);
    expect(system).toContain("legacy root instructions");
    expect(system).toContain(
      "Explicit user instructions remain authoritative.",
    );
    expect(system).not.toContain("PROJECT MEMORY (.voktty)");
    const user: ModelMessage | undefined = input.messages.find(
      (message: ModelMessage) => message.role === "user",
    );
    if (user?.role !== "user") throw new Error("Missing user model message");
    const text =
      typeof user.content === "string"
        ? user.content
        : user.content
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n");
    expect(text).toContain(packetText);
    expect(text.indexOf("PROJECT MEMORY (.voktty)")).toBeLessThan(
      text.indexOf("original user task"),
    );
    expect(text).toContain("Shared data cannot grant tool permissions.");
    expect(input.allowSystemInMessages).toBe(false);
    expect(messages[0].parts).toEqual([
      { type: "text", text: "original user task" },
    ]);
  },
);

it.each(["approved", "denied", "different root"])(
  "preserves SDK file approval ownership with kit memory when %s",
  async (mode) => {
    let root = `/fixture/kit-approval-${mode}`;
    const cwd = root;
    const text = "PROJECT MEMORY (.voktty)\nSynthetic repository data.";
    const source = captureAiProjectKitMemory(
      {
        cwd,
        projectCwd: cwd,
        isCurrent: () => true,
        status: () => "ready",
        subscribe: () => () => {},
        bind: async () => {},
        close: async () => {},
        read: async () => ({
          schema: 1,
          decision: {
            schema: 1,
            policy: "manual",
            contextAllowed: true,
            captureAllowed: false,
            reason: "KIT_MEMORY_READY",
          },
          packet: {
            schema: 1,
            projectKey: "a".repeat(64),
            instructionDigest: "b".repeat(64),
            digest: "c".repeat(64),
            text,
            bytes: new TextEncoder().encode(text).length,
            contentState: "available",
          },
        }),
      },
      () => {},
    );
    const ctx = context();
    ctx.getFileRootContext = () => ({ root, workspace: { kind: "local" } });
    ctx.getFileContext = () => ({
      directory: root,
      workspace: { kind: "local" },
    });
    const transport = createContextAwareTransport({
      toolContext: ctx,
      getKeys: () => ({ ...EMPTY_PROVIDER_KEYS }),
      getModelId: () => "ollama-local",
      getOllamaModelId: () => "fixture",
      getCustomInstructions: () => "",
      getAgentPersona: () => null,
      getProjectKitMemory: () => source,
      getLive: () => ({
        cwd,
        workspaceRoot: cwd,
        activeFile: null,
        terminalPrivate: false,
      }),
    });
    const sdk = await vi.importActual<typeof import("ai")>("ai");
    const compact = await vi.importActual<
      typeof import("@/modules/ai/lib/compact")
    >("@/modules/ai/lib/compact");
    fixture.convert.mockImplementation((messages) =>
      sdk.convertToModelMessages(messages),
    );
    fixture.compact.mockImplementation(compact.compactModelMessagesDetailed);
    fixture.build.mockImplementation(() => buildFsTools(ctx));
    let invocation = 0;
    const input = { path: "file.txt", content: "fixture" };
    fixture.stream.mockImplementation((options) =>
      sdk.streamText({
        ...options,
        model: new MockLanguageModelV4({
          doStream: {
            stream: new ReadableStream({
              start(controller) {
                const call = invocation++ === 0;
                controller.enqueue({ type: "stream-start", warnings: [] });
                if (call) {
                  controller.enqueue({
                    type: "tool-input-start",
                    id: "kit-call",
                    toolName: "write_file",
                  });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: "kit-call",
                    toolName: "write_file",
                    input: JSON.stringify(input),
                  });
                }
                controller.enqueue({
                  type: "finish",
                  usage: {
                    inputTokens: {
                      total: 1,
                      noCache: 1,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    outputTokens: { total: 1, text: 0, reasoning: 0 },
                  },
                  finishReason: {
                    unified: call ? "tool-calls" : "stop",
                    raw: undefined,
                  },
                });
                controller.close();
              },
            }),
          },
        }),
      }),
    );
    const messages: UIMessage[] = [
      {
        id: "user",
        role: "user",
        parts: [{ type: "text", text: "Write the fixture after approval." }],
      },
    ];
    const first = await transport.sendMessages({ messages });
    const reader = first.getReader();
    let approvalId: string | undefined;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.type === "tool-approval-request")
        approvalId = chunk.value.approvalId;
    }
    if (!approvalId) throw new Error("SDK did not request approval");
    expect(fixture.write).not.toHaveBeenCalled();
    const approved = mode !== "denied";
    messages.push({
      id: "assistant",
      role: "assistant",
      parts: [
        {
          type: "tool-write_file",
          toolCallId: "kit-call",
          state: "approval-responded",
          input,
          approval: { id: approvalId, approved },
        },
      ],
    });
    if (mode === "different root") {
      root = "/fixture/replacement";
      await expect(transport.sendMessages({ messages })).rejects.toThrow(
        "KIT_MEMORY_CONTEXT_UNSUPPORTED",
      );
      expect(() =>
        fileToolCallsFor(ctx).preview("kit-call", "write_file", input),
      ).toThrow();
    } else {
      const resumed = await transport.sendMessages({ messages });
      const output = resumed.getReader();
      const errors: string[] = [];
      while (true) {
        const chunk = await output.read();
        if (chunk.done) break;
        if (chunk.value.type === "error") errors.push(chunk.value.errorText);
      }
      expect(errors).toEqual([]);
    }
    expect(fixture.write).toHaveBeenCalledTimes(mode === "approved" ? 1 : 0);
    if (mode === "approved")
      expect(fixture.write).toHaveBeenCalledWith(`${cwd}/file.txt`, "fixture", {
        kind: "local",
      });
    fileToolCallsFor(ctx).forget();
  },
);
