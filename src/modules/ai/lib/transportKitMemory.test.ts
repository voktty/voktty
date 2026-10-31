import { beforeEach, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { ToolContext } from "@/modules/ai/tools/context";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import type { MemoryContextResult } from "@/modules/workspace-kit/lib/context";
import { captureAiProjectKitMemory } from "@/modules/ai/lib/projectKitMemory";
import { createContextAwareTransport } from "@/modules/ai/lib/transport";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import { captureAiMessageSnapshot } from "@/modules/ai/lib/messageSnapshot";

const io = vi.hoisted(() => ({
  readFile: vi.fn(),
  canonicalize: vi.fn(),
  run: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: io }));
vi.mock("@/modules/ai/lib/agent", () => ({ runAgentStream: io.run }));
let sequence = 0;
beforeEach(() => {
  vi.resetAllMocks();
  io.canonicalize.mockImplementation(async (path: string) => path);
  io.readFile.mockResolvedValue({
    kind: "text",
    content: "legacy root rules",
    size: 17,
  });
  io.stream.mockImplementation(
    () => new ReadableStream({ start: (controller) => controller.close() }),
  );
  io.run.mockResolvedValue({ toUIMessageStream: io.stream });
});
function result(
  text = "PROJECT MEMORY (.voktty)\nshared facts",
): MemoryContextResult {
  return {
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
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture(enabled = true, sameRoot?: string) {
  const originalRoot = sameRoot ?? `/fixture/kit-${++sequence}`;
  let root = originalRoot;
  let workspace: WorkspaceEnv = { kind: "local" };
  let active = true;
  let selected = enabled;
  const listeners = new Set<() => void>();
  let subscriptionHook = () => {};
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const read = vi.fn(async () => result());
  const conversation: MemoryConversation = {
    cwd: root,
    projectCwd: root,
    isCurrent: () => active,
    status: () => (active ? "ready" : "retired"),
    subscribe: (listener) => {
      listeners.add(listener);
      subscriptionHook();
      return () => {
        listeners.delete(listener);
      };
    },
    bind: async () => {},
    read,
    close: async () => {
      active = false;
      notify();
    },
  };
  const source = captureAiProjectKitMemory(conversation, () => {});
  const ctx: ToolContext = {
    getCwd: () => root,
    getWorkspaceRoot: () => root,
    getFileRootContext: () => ({ root, workspace }),
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "fixture",
  };
  const deps = {
    getKeys: () => ({ ...EMPTY_PROVIDER_KEYS }),
    toolContext: ctx,
    getModelId: () => "fixture-model",
    getCustomInstructions: () => "user instructions",
    getAgentPersona: () => null,
    getProjectKitMemory: () => (selected ? source : undefined),
    getLive: () => ({
      cwd: originalRoot,
      workspaceRoot: originalRoot,
      activeFile: null,
      terminalPrivate: false,
    }),
    onStep: vi.fn(),
    onUsage: vi.fn(),
  };
  const transport = createContextAwareTransport(deps);
  const messages: UIMessage[] = [
    {
      id: "system",
      role: "system",
      parts: [{ type: "text", text: "explicit rules" }],
    },
    {
      id: "user",
      role: "user",
      parts: [{ type: "text", text: "original task" }],
    },
  ];
  return {
    ctx,
    deps,
    messages,
    source,
    read,
    conversation,
    originalRoot,
    send: (abortSignal?: AbortSignal) =>
      transport.sendMessages({ messages, abortSignal }),
    enable: () => {
      selected = true;
    },
    move: () => {
      root = "/fixture/replacement";
      notify();
    },
    changeWorkspace: () => {
      workspace = { kind: "wsl", distro: "replacement" };
      notify();
    },
    listenerCount: () => listeners.size,
    retireOnSubscribe: () => {
      subscriptionHook = () => {
        void conversation.close();
      };
    },
  };
}
it("sends a separate user text block while preserving legacy root memory and system instructions", async () => {
  const f = fixture();
  const original = structuredClone(f.messages);
  await f.send();
  const run = io.run.mock.calls[0][0];
  expect(run.projectMemory).toBe("legacy root rules");
  expect(run.uiMessages[0]).toEqual(original[0]);
  expect(run.uiMessages[1].parts).toEqual([
    { type: "text", text: result().packet?.text },
    { type: "text", text: expect.stringContaining("original task") },
  ]);
  expect(f.messages).toEqual(original);
  expect(io.stream.mock.calls[0][0].originalMessages).toEqual(original);
  expect(
    JSON.stringify(io.stream.mock.calls[0][0].originalMessages),
  ).not.toContain(result().packet?.text);
});
it("rereads kit policy and facts on every request without replacing the legacy cache", async () => {
  const f = fixture();
  await f.send();
  f.read.mockResolvedValue(result("updated facts"));
  f.deps.getProjectKitMemory = () =>
    captureAiProjectKitMemory(f.conversation, () => {});
  await f.send();
  expect(io.run.mock.calls[1][0].uiMessages[1].parts[0]).toEqual({
    type: "text",
    text: "updated facts",
  });
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(io.readFile).toHaveBeenCalledTimes(1);
});
it("does not read or rewrite a kit when no source was captured", async () => {
  const f = fixture(false);
  await f.send();
  expect(f.read).not.toHaveBeenCalled();
  expect(io.run.mock.calls[0][0].uiMessages[1].parts).toHaveLength(1);
  expect(io.run.mock.calls[0][0].projectMemory).toBe("legacy root rules");
});
it("fails a denied native policy instead of sending a prompt without the enabled memory", async () => {
  const f = fixture();
  f.read.mockResolvedValue({
    ...result(),
    decision: {
      ...result().decision,
      contextAllowed: false,
      reason: "KIT_MEMORY_POLICY_NEVER",
    },
    packet: null,
  });
  await expect(f.send()).rejects.toThrow("KIT_MEMORY_POLICY_NEVER");
  expect(io.run).not.toHaveBeenCalled();
});
it.each(["different root", "unsupported filesystem", "missing root"])(
  "rejects %s before legacy or kit IO",
  async (kind) => {
    const f = fixture();
    if (kind === "different root") f.move();
    if (kind === "unsupported filesystem") f.changeWorkspace();
    if (kind === "missing root") f.ctx.getFileRootContext = () => null;
    await expect(f.send()).rejects.toThrow("KIT_MEMORY_CONTEXT_UNSUPPORTED");
    expect(io.readFile).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    expect(io.run).not.toHaveBeenCalled();
  },
);
it("captures consent before legacy preparation instead of adopting a later activation", async () => {
  const f = fixture(false);
  const held = deferred<unknown>();
  io.readFile.mockReturnValueOnce(held.promise);
  const send = f.send();
  await vi.waitFor(() => expect(io.readFile).toHaveBeenCalledTimes(1));
  f.enable();
  held.resolve({ kind: "text", content: "root rules", size: 10 });
  await send;
  expect(f.read).not.toHaveBeenCalled();
  expect(io.run.mock.calls[0][0].uiMessages[1].parts).toHaveLength(1);
  await f.send();
  expect(f.read).toHaveBeenCalledTimes(1);
  expect(io.run.mock.calls[1][0].uiMessages[1].parts).toHaveLength(2);
});
it.each([
  "owner",
  "abort",
  "stop",
  "forget",
  "root change",
  "filesystem change",
  "supersede",
])(
  "does not start a retired model after %s during kit reading",
  async (kind) => {
    const f = fixture();
    const held = deferred<MemoryContextResult>();
    f.read.mockReturnValueOnce(held.promise);
    const abort = new AbortController();
    const send = f.send(abort.signal);
    const outcome = expect(send).rejects.toThrow();
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(1));
    if (kind === "owner") await f.conversation.close();
    else if (kind === "abort") abort.abort();
    else if (kind === "stop") fileToolCallsFor(f.ctx).retireAll();
    else if (kind === "forget") fileToolCallsFor(f.ctx).forget();
    else if (kind === "root change") f.move();
    else if (kind === "filesystem change") f.changeWorkspace();
    else await f.send();
    held.resolve(result());
    await outcome;
    expect(io.run).toHaveBeenCalledTimes(kind === "supersede" ? 1 : 0);
  },
);
it("does not read kit or legacy memory without an existing user turn", async () => {
  const f = fixture();
  f.messages.splice(1);
  await expect(f.send()).rejects.toThrow("KIT_MEMORY_USER_TURN_REQUIRED");
  expect(f.read).not.toHaveBeenCalled();
  expect(io.readFile).not.toHaveBeenCalled();
});
it("stops legacy fallback if an enabled kit's root retires during that read", async () => {
  const f = fixture();
  const held = deferred<unknown>();
  io.readFile.mockReturnValueOnce(held.promise);
  const send = f.send();
  const outcome = expect(send).rejects.toThrow("retired");
  await vi.waitFor(() => expect(io.readFile).toHaveBeenCalledTimes(1));
  f.move();
  held.resolve({ kind: "binary", size: 0 });
  await outcome;
  expect(io.readFile).toHaveBeenCalledTimes(1);
  expect(f.read).not.toHaveBeenCalled();
  expect(io.run).not.toHaveBeenCalled();
});
it("retains the submitted history and attachments while memory is pending", async () => {
  const f = fixture();
  f.messages[1].parts.unshift({
    type: "file",
    mediaType: "image/png",
    url: "data:image/png;base64,original",
  });
  const original = structuredClone(f.messages);
  const held = deferred<MemoryContextResult>();
  f.read.mockReturnValueOnce(held.promise);
  const send = f.send();
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(1));
  f.messages[1].parts = [{ type: "text", text: "replacement input" }];
  held.resolve(result());
  await send;
  const parts = io.run.mock.calls[0][0].uiMessages[1].parts;
  expect(parts).toEqual([
    { type: "text", text: result().packet?.text },
    original[1].parts[0],
    { type: "text", text: expect.stringContaining("original task") },
  ]);
  expect(io.stream.mock.calls[0][0].originalMessages).toEqual(original);
});
it("retires model/tool authority and presentation on a later root change while retaining usage accounting", async () => {
  const f = fixture();
  await f.send();
  const run = io.run.mock.calls[0][0];
  expect(run.isCurrent()).toBe(true);
  f.move();
  expect(run.isCurrent()).toBe(false);
  run.onStep("late progress");
  run.onUsage({ inputTokens: 5 });
  expect(f.deps.onStep).not.toHaveBeenCalled();
  expect(f.deps.onUsage).toHaveBeenCalledExactlyOnceWith(
    { inputTokens: 5 },
    false,
  );
});

it("aborts a live model and withdraws late UI output when its root changes", async () => {
  const f = fixture();
  io.run.mockImplementation(async (options) => ({
    toUIMessageStream: () =>
      new ReadableStream({
        start(controller) {
          options.abortSignal.addEventListener(
            "abort",
            () => controller.error(new Error("retired model output")),
            { once: true },
          );
        },
      }),
  }));
  const stream = await f.send();
  const reader = stream.getReader();
  const pending = reader.read();
  expect(f.listenerCount()).toBe(1);
  f.move();
  expect(await pending).toMatchObject({ done: true });
  expect(io.run.mock.calls[0][0].abortSignal.aborted).toBe(true);
  expect(f.listenerCount()).toBe(0);
});
it("releases the source observer when stream consumption finishes normally", async () => {
  const f = fixture();
  const stream = await f.send();
  expect(await stream.getReader().read()).toMatchObject({ done: true });
  expect(f.listenerCount()).toBe(0);
  expect(io.run.mock.calls[0][0].abortSignal.aborted).toBe(false);
});
it("cancels the captured model and releases the observer on UI cancellation", async () => {
  const f = fixture();
  const cancel = vi.fn();
  io.stream.mockImplementation(() => new ReadableStream({ cancel }));
  const stream = await f.send();
  await stream.cancel("stop");
  expect(cancel).toHaveBeenCalledWith("stop");
  expect(io.run.mock.calls[0][0].abortSignal.aborted).toBe(true);
  expect(f.listenerCount()).toBe(0);
});
it("releases a reentrant source subscription before starting any model", async () => {
  const f = fixture();
  f.retireOnSubscribe();
  await expect(f.send()).rejects.toThrow("retired");
  expect(io.run).not.toHaveBeenCalled();
  expect(f.listenerCount()).toBe(0);
});
it("releases source observation and aborts a failed model setup", async () => {
  const f = fixture();
  io.run.mockRejectedValue(new Error("setup failed"));
  await expect(f.send()).rejects.toThrow("setup failed");
  expect(f.listenerCount()).toBe(0);
  expect(io.run.mock.calls[0][0].abortSignal.aborted).toBe(true);
});
it("keeps the original stream and signal when kit memory is absent", async () => {
  const f = fixture(false);
  const abort = new AbortController();
  const stream = await f.send(abort.signal);
  expect(stream).toBe(io.stream.mock.results[0].value);
  expect(io.run.mock.calls[0][0].abortSignal).toBe(abort.signal);
  expect(io.run.mock.calls[0][0].isToolRunCurrent).toBeUndefined();
  expect(f.listenerCount()).toBe(0);
});
it("invalidates pending file captures before a new request enters a different kit root", async () => {
  const f = fixture();
  await f.send();
  const input = { path: "file.txt", content: "fixture" };
  fileToolCallsFor(f.ctx).capture("approval", "write_file", input, {
    directory: f.originalRoot,
    root: f.originalRoot,
    workspace: { kind: "local" },
    sessionId: "fixture",
    modelId: "fixture",
    planMode: false,
  });
  f.move();
  await expect(f.send()).rejects.toThrow("KIT_MEMORY_CONTEXT_UNSUPPORTED");
  expect(() =>
    fileToolCallsFor(f.ctx).preview("approval", "write_file", input),
  ).toThrow();
  fileToolCallsFor(f.ctx).forget();
});

it("does not reuse legacy rules or approvals from a replaced native kit context at the same path", async () => {
  const f = fixture();
  await f.send();
  const input = { path: "file.txt", content: "old request" };
  fileToolCallsFor(f.ctx).capture("old", "write_file", input, {
    directory: f.originalRoot,
    root: f.originalRoot,
    workspace: { kind: "local" },
    sessionId: "fixture",
    modelId: "fixture",
    planMode: false,
  });
  const replacement = fixture(true, f.originalRoot);
  replacement.read.mockResolvedValue(result("replacement kit facts"));
  f.deps.getProjectKitMemory = () => replacement.source;
  io.readFile.mockResolvedValue({
    kind: "text",
    content: "replacement root rules",
    size: 22,
  });
  await f.send();
  expect(io.run.mock.calls[1][0].projectMemory).toBe("replacement root rules");
  expect(io.run.mock.calls[1][0].uiMessages[1].parts[0]).toEqual({
    type: "text",
    text: "replacement kit facts",
  });
  expect(() =>
    fileToolCallsFor(f.ctx).preview("old", "write_file", input),
  ).toThrow();
  expect(io.readFile).toHaveBeenCalledTimes(2);
  fileToolCallsFor(f.ctx).forget();
});
it("refreshes legacy rules when enabling kit memory after a legacy cached request", async () => {
  const f = fixture(false);
  await f.send();
  io.readFile.mockResolvedValue({
    kind: "text",
    content: "current root rules",
    size: 18,
  });
  f.enable();
  await f.send();
  expect(io.run.mock.calls[1][0].projectMemory).toBe("current root rules");
  expect(io.readFile).toHaveBeenCalledTimes(2);
});
it("does not fall back to an older unscoped legacy snapshot after its kit owner closes", async () => {
  const f = fixture(false);
  await f.send();
  f.enable();
  await f.send();
  await f.conversation.close();
  f.deps.getProjectKitMemory = () => undefined;
  io.readFile.mockResolvedValue({
    kind: "text",
    content: "rules after owner change",
    size: 24,
  });
  await f.send();
  expect(io.run.mock.calls[2][0].projectMemory).toBe(
    "rules after owner change",
  );
  expect(io.readFile).toHaveBeenCalledTimes(3);
});

it("rejects oversized history before native reads or model setup", async () => {
  const f = fixture();
  f.messages[1].parts = [{ type: "text", text: "x".repeat(16 * 1024 * 1024) }];
  await expect(f.send()).rejects.toThrow("snapshot limits");
  expect(io.readFile).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  expect(io.run).not.toHaveBeenCalled();
});

it("holds a retired preparation reservation until its native read actually settles", async () => {
  const f = fixture();
  const held = deferred<MemoryContextResult>();
  f.read.mockReturnValue(held.promise);
  const pending = f.send();
  const outcome = expect(pending).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(1));
  const others = Array.from({ length: 31 }, () => captureAiMessageSnapshot([]));
  try {
    await f.conversation.close();
    expect(() => captureAiMessageSnapshot([])).toThrow("still in use");
    held.resolve(result());
    await outcome;
    const next = captureAiMessageSnapshot([]);
    next.release();
  } finally {
    held.resolve(result());
    for (const snapshot of others) snapshot.release();
    await outcome;
  }
});

it("holds a cancelled stream reservation until provider cancellation settles", async () => {
  const f = fixture();
  const held = deferred<void>();
  io.stream.mockImplementation(
    () => new ReadableStream({ cancel: () => held.promise }),
  );
  const stream = await f.send();
  const others = Array.from({ length: 31 }, () => captureAiMessageSnapshot([]));
  const cancelling = stream.cancel();
  try {
    expect(f.listenerCount()).toBe(0);
    expect(() => captureAiMessageSnapshot([])).toThrow("still in use");
    held.resolve();
    await cancelling;
    const next = captureAiMessageSnapshot([]);
    next.release();
  } finally {
    held.resolve();
    await cancelling;
    for (const snapshot of others) snapshot.release();
  }
});
