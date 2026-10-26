import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RunAgentOptions } from "@/modules/ai/lib/agent";
import { createContextAwareTransport } from "@/modules/ai/lib/transport";
import { getOrCreateChat } from "@/modules/ai/store/chatRuntime";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import { forgetChatFileTools } from "@/modules/ai/lib/chatFileTools";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import type { ToolContext } from "@/modules/ai/tools/context";

const fixture = vi.hoisted(() => ({
  runs: [] as RunAgentOptions[],
  errors: [] as ((error: unknown) => string)[],
  run: vi.fn(),
}));
vi.mock("@/modules/ai/lib/agent", () => ({ runAgentStream: fixture.run }));
vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  isAiRuntimeAvailable: () => true,
  requireAiRuntime: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

function usage(inputTokens: number) {
  return {
    inputTokens,
    outputTokens: 2,
    cachedInputTokens: 1,
    lastInputTokens: inputTokens,
    lastCachedTokens: 1,
  };
}
function stream() {
  return {
    toUIMessageStream: (options: { onError?: (error: unknown) => string }) => {
      if (options.onError) fixture.errors.push(options.onError);
      return new ReadableStream({ start: (c) => c.close() });
    },
  };
}
beforeEach(() => {
  fixture.runs.length = 0;
  fixture.errors.length = 0;
  fixture.run.mockReset().mockImplementation(async (args: RunAgentOptions) => {
    fixture.runs.push(args);
    return stream();
  });
  chats.clear();
  useChatStore.setState({ activeSessionId: "original" });
  useChatStore.getState().resetAgentMeta();
});
afterEach(() => {
  chats.clear();
  useChatStore.setState({ activeSessionId: null });
  useChatStore.getState().resetAgentMeta();
});

function direct() {
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
    onAgentStep: vi.fn(),
  };
  const deps = {
    toolContext: ctx,
    getKeys: () => ({ ...EMPTY_PROVIDER_KEYS }),
    getModelId: () => "fixture",
    getCustomInstructions: () => "",
    getAgentPersona: () => null,
    getLive: () => ({
      cwd: null,
      workspaceRoot: null,
      activeFile: null,
      terminalPrivate: false,
    }),
    onStep: vi.fn(),
    onUsage: vi.fn(),
    onCompact: vi.fn(),
    onFinishMeta: vi.fn(),
  };
  const transport = createContextAwareTransport(deps);
  return {
    ctx,
    deps,
    send: (abortSignal?: AbortSignal) =>
      transport.sendMessages({ messages: [], abortSignal }),
  };
}

it("preserves late usage totals after Stop without overwriting a fresh turn's presentation", async () => {
  const chat = getOrCreateChat("original");
  await chat.sendMessage({ text: "first" });
  const old = fixture.runs[0];
  old.onUsage?.(usage(3));
  await chat.stop();
  await chat.sendMessage({ text: "second" });
  const current = fixture.runs[1];
  current.onStep?.("fresh");
  current.onUsage?.(usage(10));
  old.onStep?.("stale");
  old.onCompact?.({ droppedCount: 8 });
  old.onFinishMeta?.({ hitStepCap: true, finishReason: "tool-calls" });
  old.onUsage?.({ ...usage(5), lastCachedTokens: 99 });
  expect(useChatStore.getState().agentMeta).toMatchObject({
    step: "fresh",
    hitStepCap: false,
    compactionNotice: null,
    lastInputTokens: 10,
    lastCachedTokens: 1,
    tokens: { inputTokens: 18, outputTokens: 6, cachedInputTokens: 3 },
  });
});

it("binds child progress to the original request without replacing its tool context", async () => {
  const f = direct();
  await f.send();
  const old = fixture.runs[0];
  await f.send();
  const current = fixture.runs[1];
  expect(old.toolContext).toBe(f.ctx);
  expect(current.toolContext).toBe(f.ctx);
  old.onSubagentStep?.("stale child");
  current.onSubagentStep?.("fresh child");
  expect(f.ctx.onAgentStep).toHaveBeenCalledExactlyOnceWith("fresh child");
});

it.each(["abort", "stop", "supersede"])(
  "suppresses retired presentation after %s while retaining accounted usage",
  async (mode) => {
    const f = direct();
    const abort = new AbortController();
    await f.send(abort.signal);
    const old = fixture.runs[0];
    if (mode === "abort") abort.abort();
    else if (mode === "stop") fileToolCallsFor(f.ctx).retireAll();
    else await f.send();
    old.onStep?.("retired");
    old.onCompact?.({ droppedCount: 1 });
    old.onFinishMeta?.({ hitStepCap: true, finishReason: "fixture" });
    old.onUsage?.(usage(7));
    expect(f.deps.onStep).not.toHaveBeenCalled();
    expect(f.deps.onCompact).not.toHaveBeenCalled();
    expect(f.deps.onFinishMeta).not.toHaveBeenCalled();
    expect(f.deps.onUsage).toHaveBeenCalledExactlyOnceWith(usage(7), false);
  },
);

it("seals all metadata on forget even if the same runtime is still registered", async () => {
  const chat = getOrCreateChat("original");
  await chat.sendMessage({ text: "fixture" });
  const old = fixture.runs[0];
  forgetChatFileTools(chat);
  old.onUsage?.(usage(10));
  old.onStep?.("forgotten");
  expect(useChatStore.getState().agentMeta).toMatchObject({
    step: null,
    lastInputTokens: 0,
    tokens: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  });
});

it("seals completed presentation without losing late accounting", async () => {
  const f = direct();
  await f.send();
  const run = fixture.runs[0];
  run.onFinishMeta?.({ hitStepCap: false, finishReason: "stop" });
  run.onStep?.("after finish");
  run.onCompact?.({ droppedCount: 1 });
  run.onFinishMeta?.({ hitStepCap: true, finishReason: "duplicate" });
  run.onUsage?.(usage(4));
  expect(f.deps.onStep).not.toHaveBeenCalled();
  expect(f.deps.onCompact).not.toHaveBeenCalled();
  expect(f.deps.onFinishMeta).toHaveBeenCalledTimes(1);
  expect(f.deps.onUsage).toHaveBeenCalledExactlyOnceWith(usage(4), false);
});

it("keeps independently owned transports current", async () => {
  const original = direct();
  const sibling = direct();
  await original.send();
  await sibling.send();
  fixture.runs[0].onStep?.("original");
  fixture.runs[0].onUsage?.(usage(4));
  fixture.runs[1].onStep?.("sibling");
  fixture.runs[1].onUsage?.(usage(8));
  expect(original.deps.onStep).toHaveBeenCalledExactlyOnceWith("original");
  expect(original.deps.onUsage).toHaveBeenCalledExactlyOnceWith(usage(4), true);
  expect(sibling.deps.onStep).toHaveBeenCalledExactlyOnceWith("sibling");
  expect(sibling.deps.onUsage).toHaveBeenCalledExactlyOnceWith(usage(8), true);
});

it("captures metadata callbacks before waiting rather than consulting replacement configuration", async () => {
  const f = direct();
  await f.send();
  const original = f.deps.onStep;
  const child = f.ctx.onAgentStep;
  f.deps.onStep = vi.fn();
  f.ctx.onAgentStep = vi.fn();
  fixture.runs[0].onStep?.("captured");
  fixture.runs[0].onSubagentStep?.("captured child");
  expect(original).toHaveBeenCalledExactlyOnceWith("captured");
  expect(child).toHaveBeenCalledExactlyOnceWith("captured child");
  expect(f.deps.onStep).not.toHaveBeenCalled();
  expect(f.ctx.onAgentStep).not.toHaveBeenCalled();
});

it("does not retire current publication for an already-aborted new request", async () => {
  const f = direct();
  await f.send();
  const abort = new AbortController();
  abort.abort();
  await expect(f.send(abort.signal)).rejects.toThrow("retired");
  fixture.runs[0].onStep?.("still current");
  expect(f.deps.onStep).toHaveBeenCalledExactlyOnceWith("still current");
  expect(fixture.run).toHaveBeenCalledTimes(1);
});

it("seals failed model setup's escaped callbacks while retaining accounted usage", async () => {
  const f = direct();
  fixture.run.mockImplementationOnce(async (args: RunAgentOptions) => {
    fixture.runs.push(args);
    throw new Error("setup failed");
  });
  await expect(f.send()).rejects.toThrow("setup failed");
  const old = fixture.runs[0];
  old.onStep?.("after failure");
  old.onUsage?.(usage(2));
  expect(f.deps.onStep).not.toHaveBeenCalled();
  expect(f.deps.onUsage).toHaveBeenCalledExactlyOnceWith(usage(2), false);
  await f.send();
  fixture.runs[1].onStep?.("fresh");
  expect(f.deps.onStep).toHaveBeenCalledExactlyOnceWith("fresh");
});

it("does not return an older model result after a successor has started", async () => {
  const f = direct();
  let complete = () => {};
  fixture.run.mockImplementationOnce(async (args: RunAgentOptions) => {
    fixture.runs.push(args);
    await new Promise<void>((resolve) => {
      complete = resolve;
    });
    return stream();
  });
  const old = f.send();
  const observed = expect(old).rejects.toThrow("retired");
  await vi.waitFor(() => expect(fixture.run).toHaveBeenCalledTimes(1));
  await f.send();
  complete();
  await observed;
  fixture.runs[1].onStep?.("fresh");
  fixture.runs[0].onStep?.("stale");
  expect(f.deps.onStep).toHaveBeenCalledExactlyOnceWith("fresh");
});

it("seals failed stream presentation while preserving its late usage", async () => {
  const f = direct();
  await f.send();
  expect(fixture.errors[0](new Error("fixture stream failure"))).toContain(
    "fixture stream failure",
  );
  fixture.runs[0].onStep?.("after stream failure");
  fixture.runs[0].onUsage?.(usage(3));
  expect(f.deps.onStep).not.toHaveBeenCalled();
  expect(f.deps.onUsage).toHaveBeenCalledExactlyOnceWith(usage(3), false);
});
