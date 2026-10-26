import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { createContextAwareTransport } from "@/modules/ai/lib/transport";
import { getOrCreateChat } from "@/modules/ai/store/chatRuntime";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";

type TransportDeps = Parameters<typeof createContextAwareTransport>[0];
const fixture = vi.hoisted(() => ({
  callbacks: [] as TransportDeps[],
  send: vi.fn(),
}));
vi.mock("@/modules/ai/store/todoStore", () => ({
  useTodosStore: { getState: () => ({ clearSession: vi.fn() }) },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/modules/ai/lib/sessions", () => ({
  loadMessages: vi.fn(async () => []),
  saveActiveId: vi.fn(),
  saveSessionsList: vi.fn(),
  saveMessages: vi.fn(),
  deleteSessionData: vi.fn(),
  deriveTitle: () => "fixture",
  newSessionId: () => "fresh",
}));
vi.mock("@/modules/ai/lib/transport", () => ({
  createContextAwareTransport: (deps: TransportDeps) => {
    fixture.callbacks.push(deps);
    return {
      sendMessages: fixture.send,
      reconnectToStream: async () => null,
    };
  },
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

beforeEach(() => {
  fixture.send
    .mockReset()
    .mockResolvedValue(
      new ReadableStream({ start: (controller) => controller.close() }),
    );
  fixture.callbacks.length = 0;
  chats.clear();
  useChatStore.getState().resetAgentMeta();
  useChatStore.setState({
    activeSessionId: "original",
    sessions: ["original", "selected"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
    })),
  });
});
afterEach(() => {
  chats.clear();
  useChatStore.setState({ activeSessionId: null, sessions: [] });
  useChatStore.getState().resetAgentMeta();
});

it("retains background usage and progress without changing the selected chat", () => {
  getOrCreateChat("original");
  getOrCreateChat("selected");
  const original = fixture.callbacks[0];
  const selected = fixture.callbacks[1];
  original.onUsage?.(usage(10));
  useChatStore.getState().switchSession("selected");
  selected.onUsage?.(usage(20));
  selected.onStep?.("selected step");
  original.onUsage?.(usage(3));
  original.onStep?.("background step");
  original.onFinishMeta?.({ hitStepCap: true, finishReason: "tool-calls" });
  original.onCompact?.({ droppedCount: 4 });
  expect(useChatStore.getState().agentMeta).toMatchObject({
    step: "selected step",
    tokens: { inputTokens: 20, outputTokens: 2, cachedInputTokens: 1 },
    hitStepCap: false,
    compactionNotice: null,
  });
  useChatStore.getState().switchSession("original");
  expect(useChatStore.getState().agentMeta).toMatchObject({
    step: "background step",
    tokens: { inputTokens: 13, outputTokens: 4, cachedInputTokens: 2 },
    hitStepCap: true,
    compactionNotice: { droppedCount: 4 },
  });
});

it("does not let a deleted runtime update a replacement with the same ID", () => {
  const retired = getOrCreateChat("original");
  getOrCreateChat("selected");
  const original = fixture.callbacks[0];
  useChatStore.getState().deleteSession("original");
  const replacement = getOrCreateChat("original");
  expect(replacement).not.toBe(retired);
  useChatStore.setState({ activeSessionId: "original" });
  fixture.callbacks[2].onStep?.("replacement step");
  original.onUsage?.(usage(9));
  original.onStep?.("retired step");
  expect(useChatStore.getState().agentMeta).toMatchObject({
    step: "replacement step",
    tokens: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  });
});

it("clears the selected projection immediately when its session is deleted", () => {
  getOrCreateChat("original");
  getOrCreateChat("selected");
  fixture.callbacks[0].onUsage?.(usage(10));
  fixture.callbacks[0].onStep?.("deleted step");
  useChatStore.getState().deleteSession("original");
  expect(useChatStore.getState().activeSessionId).toBe("selected");
  expect(useChatStore.getState().agentMeta).toMatchObject({
    step: null,
    tokens: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  });
});

it("keeps a background SDK error on its original conversation", async () => {
  const original = getOrCreateChat("original");
  getOrCreateChat("selected");
  useChatStore.getState().switchSession("selected");
  fixture.send.mockRejectedValueOnce(new Error("original failure"));
  await original.sendMessage({ text: "fixture" });
  expect(useChatStore.getState().agentMeta).toMatchObject({
    status: "idle",
    error: null,
  });
  useChatStore.getState().switchSession("original");
  expect(useChatStore.getState().agentMeta).toMatchObject({
    status: "error",
    error: "original failure",
  });
});

it("does not notify selected metadata readers for background usage", () => {
  getOrCreateChat("original");
  getOrCreateChat("selected");
  useChatStore.getState().switchSession("selected");
  const notify = vi.fn();
  const release = useChatStore.subscribe(notify);
  try {
    fixture.callbacks[0].onUsage?.(usage(3));
    expect(notify).not.toHaveBeenCalled();
  } finally {
    release();
  }
  useChatStore.getState().switchSession("original");
  expect(useChatStore.getState().agentMeta.tokens.inputTokens).toBe(3);
});

it("does not let evicted callbacks contaminate a recreated conversation", () => {
  getOrCreateChat("original");
  getOrCreateChat("selected");
  const retired = fixture.callbacks[0];
  useChatStore.getState().switchSession("selected");
  for (let i = 0; i < 8; i++) getOrCreateChat(`extra-${i}`);
  expect(chats.has("original")).toBe(false);
  getOrCreateChat("original");
  useChatStore.getState().switchSession("original");
  retired.onUsage?.(usage(99));
  retired.onStep?.("evicted");
  retired.onCompact?.({ droppedCount: 99 });
  expect(useChatStore.getState().agentMeta).toMatchObject({
    step: null,
    compactionNotice: null,
    tokens: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  });
});

it("resets only the selected runtime and preserves its sibling's usage", () => {
  getOrCreateChat("original");
  getOrCreateChat("selected");
  fixture.callbacks[0].onUsage?.(usage(10));
  fixture.callbacks[1].onUsage?.(usage(20));
  useChatStore.getState().resetAgentMeta();
  expect(useChatStore.getState().agentMeta.tokens.inputTokens).toBe(0);
  useChatStore.getState().switchSession("selected");
  expect(useChatStore.getState().agentMeta.tokens.inputTokens).toBe(20);
  useChatStore.getState().switchSession("original");
  expect(useChatStore.getState().agentMeta.tokens.inputTokens).toBe(0);
});
