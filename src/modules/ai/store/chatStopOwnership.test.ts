import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";
import { getOrCreateChat } from "@/modules/ai/store/chatRuntime";
import {
  chats,
  stop as stopSelected,
  useChatStore,
} from "@/modules/ai/store/chatStore";
import { registerChatFileTools } from "@/modules/ai/lib/chatFileTools";
import {
  fileToolCallsFor,
  inheritFileToolCalls,
} from "@/modules/ai/lib/fileToolCalls";
import type { ToolContext } from "@/modules/ai/tools/context";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
const fixture = vi.hoisted(() => ({
  send: vi.fn<
    (options: {
      abortSignal?: AbortSignal;
    }) => Promise<ReadableStream<UIMessageChunk>>
  >(),
}));
vi.mock("@/modules/ai/lib/transport", () => ({
  createContextAwareTransport: () => ({
    sendMessages: fixture.send,
    reconnectToStream: async () => null,
  }),
}));

beforeEach(() => {
  fixture.send
    .mockReset()
    .mockResolvedValue(new ReadableStream({ start: (c) => c.close() }));
});

function context(): ToolContext {
  return {
    getCwd: () => "/fixture",
    getWorkspaceRoot: () => "/fixture",
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
const target = {
  directory: "/fixture",
  root: "/fixture",
  workspace: { kind: "local" as const },
};
const input = { path: "file.ts" };
function capture(owner: ToolContext, id = "call") {
  const calls = fileToolCallsFor(owner);
  calls.capture(id, "read_file", input, target);
  return calls.claim(id, "read_file", input);
}
afterEach(() => {
  chats.clear();
  useChatStore.setState({ activeSessionId: null });
});

it("retires the exact chat's file family synchronously on direct SDK stop", async () => {
  const original = getOrCreateChat("original");
  const other = getOrCreateChat("other");
  const owner = context();
  const child = context();
  const sibling = context();
  registerChatFileTools(original, owner);
  registerChatFileTools(other, sibling);
  inheritFileToolCalls(owner, child);
  const rootCall = capture(owner);
  const childCall = capture(child);
  const otherCall = capture(sibling);
  useChatStore.setState({ activeSessionId: "other" });
  const stop = original.stop();
  expect(rootCall.isCurrent()).toBe(false);
  expect(childCall.isCurrent()).toBe(false);
  expect(otherCall.isCurrent()).toBe(true);
  const successor = capture(owner, "successor");
  await stop;
  expect(successor.isCurrent()).toBe(true);
  rootCall.release();
  childCall.release();
  otherCall.release();
  successor.release();
});

it("does not repeat root retirement when Stop is requested through the store", () => {
  const chat = getOrCreateChat("fixture");
  const owner = context();
  registerChatFileTools(chat, owner);
  const calls = fileToolCallsFor(owner);
  calls.capture("old", "read_file", input, target, () => {
    calls.capture("successor", "read_file", input, target);
  });
  useChatStore.setState({ activeSessionId: "fixture" });
  stopSelected();
  expect(calls.preview("successor", "read_file", input)).toEqual(target);
  calls.retireAll();
});

it("still aborts the SDK's active transport after retiring file captures", async () => {
  let signal: AbortSignal | undefined;
  fixture.send.mockImplementationOnce(async ({ abortSignal }) => {
    signal = abortSignal;
    return new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "start", messageId: "assistant" });
        abortSignal?.addEventListener(
          "abort",
          () => controller.error(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      },
    });
  });
  const chat = getOrCreateChat("fixture");
  const owner = context();
  registerChatFileTools(chat, owner);
  const call = capture(owner);
  const request = chat.sendMessage({ text: "fixture" });
  await vi.waitFor(() => expect(signal).toBeDefined());
  await chat.stop();
  expect(signal?.aborted).toBe(true);
  expect(call.isCurrent()).toBe(false);
  await request;
  call.release();
});
