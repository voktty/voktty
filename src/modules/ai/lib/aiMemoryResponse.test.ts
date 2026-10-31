import { beforeEach, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createAiMemoryDelivery } from "@/modules/ai/lib/aiMemoryDelivery";
import { createContextAwareTransport } from "@/modules/ai/lib/transport";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { runAgentStream } from "@/modules/ai/lib/agent";
import type { ToolContext } from "@/modules/ai/tools/context";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import type { MemoryContextResult } from "@/modules/workspace-kit/lib/context";

const io = vi.hoisted(() => ({ stream: vi.fn(), model: vi.fn() }));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: () => io.model,
}));
vi.mock("@/modules/ai/tools/mcp", () => ({
  loadMcpToolsForRun: async () => ({}),
}));
vi.mock("@/modules/ai/tools/tools", () => ({ buildTools: () => ({}) }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    canonicalize: async (path: string) => path,
    readFile: async () => ({ kind: "text", content: "legacy rules", size: 12 }),
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

const text = "PROJECT MEMORY (.voktty)\nShared project facts.";
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
beforeEach(() => {
  io.stream.mockReset();
  io.model.mockReturnValue(
    new MockLanguageModelV4({ doStream: (options) => io.stream(options) }),
  );
});
function fixture() {
  let active = true;
  let root = "/project";
  const listeners = new Set<() => void>();
  const read = vi.fn(
    async (): Promise<MemoryContextResult> => ({
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
  );
  const conversation: MemoryConversation = {
    cwd: root,
    projectCwd: root,
    isCurrent: () => active,
    status: () => (active ? "ready" : "retired"),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    bind: async () => {},
    close: async () => {},
    read,
  };
  const receipt = vi.fn();
  const source = createAiMemoryDelivery(conversation, receipt).capture(
    () => {},
  );
  const ctx: ToolContext = {
    getCwd: () => root,
    getWorkspaceRoot: () => root,
    getFileRootContext: () => ({ root, workspace: { kind: "local" } }),
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "fixture",
  };
  const compact = vi.fn();
  const transport = createContextAwareTransport({
    toolContext: ctx,
    getKeys: () => ({ ...EMPTY_PROVIDER_KEYS }),
    getModelId: () => "ollama-local",
    getOllamaModelId: () => "fixture-api-memory",
    getCustomInstructions: () => "User instructions prevail.",
    getAgentPersona: () => null,
    getProjectKitMemory: () => source,
    onCompact: compact,
    getLive: () => ({
      cwd: root,
      workspaceRoot: root,
      activeFile: null,
      terminalPrivate: false,
    }),
  });
  const messages: UIMessage[] = [
    {
      id: "user",
      role: "user",
      parts: [{ type: "text", text: "original task" }],
    },
  ];
  const start = async (signal?: AbortSignal) => {
    const stream = await transport.sendMessages({
      messages,
      abortSignal: signal,
    });
    return stream.getReader();
  };
  return {
    start,
    messages,
    receipt,
    read,
    compact,
    ctx,
    retire() {
      active = false;
      for (const listener of [...listeners]) listener();
    },
    move() {
      root = "/other";
      for (const listener of [...listeners]) listener();
    },
  };
}
function modelStream(reason = "stop", error = false) {
  io.stream.mockImplementation(async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        if (error)
          controller.enqueue({
            type: "error",
            error: new Error("fixture provider failed"),
          });
        else {
          controller.enqueue({ type: "text-start", id: "text" });
          controller.enqueue({
            type: "text-delta",
            id: "text",
            delta: "answer",
          });
          controller.enqueue({ type: "text-end", id: "text" });
        }
        controller.enqueue({
          type: "finish",
          usage,
          finishReason: { unified: reason, raw: undefined },
        });
        controller.close();
      },
    }),
  }));
}
async function drain(reader: ReadableStreamDefaultReader) {
  while (!(await reader.read()).done) {}
}

it("records a model response only after the real SDK receives its finish, with exact memory in user input", async () => {
  const f = fixture();
  modelStream();
  expect(f.receipt).not.toHaveBeenCalled();
  await drain(await f.start());
  expect(f.receipt).toHaveBeenCalledTimes(1);
  const prompt = io.stream.mock.calls[0][0].prompt;
  const user = prompt.find(
    (message: { role: string }) => message.role === "user",
  );
  expect(user.content[0]).toEqual({ type: "text", text });
  const system = prompt.filter(
    (message: { role: string }) => message.role === "system",
  );
  expect(JSON.stringify(system)).toContain("legacy rules");
  expect(JSON.stringify(system)).toContain("User instructions prevail.");
  expect(JSON.stringify(system)).not.toContain(text);
  expect(f.messages[0].parts).toEqual([
    { type: "text", text: "original task" },
  ]);
  expect(f.receipt.mock.calls[0][0]).not.toHaveProperty("providerSessionId");
});

it.each(["error", "other", "unknown"])(
  "does not acknowledge a %s model finish",
  async (reason) => {
    const f = fixture();
    modelStream(reason);
    await drain(await f.start());
    expect(f.receipt).not.toHaveBeenCalled();
  },
);

it("does not acknowledge a finish after a provider error chunk", async () => {
  const f = fixture();
  modelStream("stop", true);
  await drain(await f.start());
  expect(f.receipt).not.toHaveBeenCalled();
});

it.each(["retire", "move", "abort", "cancel"])(
  "ignores a late provider finish after %s",
  async (mode) => {
    const f = fixture();
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      io.stream.mockImplementation(async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            finish = () => {
              try {
                controller.enqueue({
                  type: "finish",
                  usage,
                  finishReason: { unified: "stop", raw: undefined },
                });
                controller.close();
              } catch {}
            };
            resolve();
          },
        }),
      }));
    });
    const abort = new AbortController();
    const reader = await f.start(abort.signal);
    const first = reader.read();
    await started;
    await first;
    if (mode === "abort") abort.abort();
    else if (mode === "cancel") await reader.cancel();
    else if (mode === "move") f.move();
    else f.retire();
    finish();
    if (mode !== "cancel") await drain(reader);
    expect(f.receipt).not.toHaveBeenCalled();
  },
);

it("rereads and reintroduces memory on subsequent calls without persisting its text in chat history", async () => {
  const f = fixture();
  modelStream();
  await drain(await f.start());
  await drain(await f.start());
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.receipt).toHaveBeenCalledTimes(2);
  expect(f.receipt.mock.calls[0][0].requestId).not.toBe(
    f.receipt.mock.calls[1][0].requestId,
  );
  for (const [options] of io.stream.mock.calls) {
    const user = options.prompt.find(
      (message: { role: string }) => message.role === "user",
    );
    expect(user.content[0]).toEqual({ type: "text", text });
  }
  expect(f.messages[0].parts).toEqual([
    { type: "text", text: "original task" },
  ]);
});

it("refuses to call the model if the exact memory packet is absent after prompt preparation", async () => {
  modelStream();
  const onResponse = vi.fn();
  await expect(
    runAgentStream({
      keys: { ...EMPTY_PROVIDER_KEYS },
      modelId: "ollama-local",
      ollamaModelId: "fixture-api-memory",
      toolContext: {
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
      },
      uiMessages: [
        {
          id: "user",
          role: "user",
          parts: [{ type: "text", text: "original task" }],
        },
      ],
      projectKitInput: { text, onResponse },
    }),
  ).rejects.toThrow("KIT_MEMORY_INPUT_CHANGED");
  expect(io.stream).not.toHaveBeenCalled();
  expect(onResponse).not.toHaveBeenCalled();
});

it.each(["harness@codex", "harness-claude", "harness-codex", "harness-agy"])(
  "refuses the API receipt contract for CLI model %s before construction",
  async (modelId) => {
    const f = fixture();
    const onResponse = vi.fn();
    await expect(
      runAgentStream({
        keys: { ...EMPTY_PROVIDER_KEYS },
        modelId,
        toolContext: f.ctx,
        uiMessages: f.messages,
        projectKitInput: { text, onResponse },
      }),
    ).rejects.toThrow("KIT_MEMORY_MODEL_UNSUPPORTED");
    expect(io.stream).not.toHaveBeenCalled();
    expect(onResponse).not.toHaveBeenCalled();
  },
);

it("snapshots packet identity and its response sink before asynchronous model preparation", async () => {
  modelStream();
  const original = vi.fn();
  const replacement = vi.fn();
  const input = { text, onResponse: original };
  const starting = runAgentStream({
    keys: { ...EMPTY_PROVIDER_KEYS },
    modelId: "ollama-local",
    ollamaModelId: "fixture-api-memory",
    toolContext: {
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
    },
    uiMessages: [
      {
        id: "user",
        role: "user",
        parts: [
          { type: "text", text },
          { type: "text", text: "original task" },
        ],
      },
    ],
    projectKitInput: input,
  });
  input.text = "replacement";
  input.onResponse = replacement;
  const result = await starting;
  await drain(result.toUIMessageStream().getReader());
  expect(original).toHaveBeenCalledTimes(1);
  expect(replacement).not.toHaveBeenCalled();
});

it("does not publish an older model response after a newer request takes ownership", async () => {
  const f = fixture();
  let finish!: () => void;
  let started!: () => void;
  const admitted = new Promise<void>((resolve) => {
    started = resolve;
  });
  io.stream.mockImplementation(async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        finish = () => {
          try {
            controller.enqueue({
              type: "finish",
              usage,
              finishReason: { unified: "stop", raw: undefined },
            });
            controller.close();
          } catch {}
        };
        started();
      },
    }),
  }));
  const old = await f.start();
  const first = old.read();
  await admitted;
  await first;
  modelStream();
  await drain(await f.start());
  expect(f.receipt).toHaveBeenCalledTimes(1);
  finish();
  await drain(old);
  expect(f.receipt).toHaveBeenCalledTimes(1);
});

it("reintroduces exact context when a resumed history needs real compaction", async () => {
  const f = fixture();
  const history: UIMessage[] = [];
  for (let index = 0; index < 20; index++) {
    history.push(
      {
        id: `user-${index}`,
        role: "user",
        parts: [{ type: "text", text: "old task" }],
      },
      {
        id: `tool-${index}`,
        role: "assistant",
        parts: [
          {
            type: "tool-read_file",
            toolCallId: `read-${index}`,
            state: "output-available",
            input: { path: `file-${index}.txt` },
            output: { content: "x".repeat(20_000) },
          },
        ],
      },
    );
  }
  f.messages.unshift(...history);
  modelStream();
  await drain(await f.start());
  expect(f.compact).toHaveBeenCalledTimes(1);
  expect(f.compact.mock.calls[0][0].droppedCount).toBeGreaterThan(0);
  const prompt = io.stream.mock.calls[0][0].prompt;
  const lastUser = prompt.findLast(
    (message: { role: string }) => message.role === "user",
  );
  expect(lastUser.content[0]).toEqual({ type: "text", text });
  expect(f.receipt).toHaveBeenCalledTimes(1);
  expect(f.messages[f.messages.length - 1]?.parts).toEqual([
    { type: "text", text: "original task" },
  ]);
});
