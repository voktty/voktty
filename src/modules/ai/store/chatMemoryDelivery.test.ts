import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import {
  captureChatMemoryConversation,
  forgetChatMemoryOwner,
  getChatProjectKitMemory,
} from "@/modules/ai/lib/chatMemoryOwner";
import { getOrCreateChat } from "@/modules/ai/store/chatRuntime";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";
import { trustReply } from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  model: vi.fn(),
  stream: vi.fn(),
  denied: false,
  error: false,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: () => io.model,
}));
vi.mock("@/modules/ai/tools/mcp", () => ({
  loadMcpToolsForRun: async () => ({}),
}));
vi.mock("@/modules/ai/tools/tools", () => ({ buildTools: () => ({}) }));
vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  isAiRuntimeAvailable: () => true,
  requireAiRuntime: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    canonicalize: async (path: string) => path,
    readFile: async () => ({
      kind: "text",
      content: "legacy root rules",
      size: 17,
    }),
  },
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
vi.mock("@/modules/ai/store/todoStore", () => ({
  useTodosStore: { getState: () => ({ clearSession: vi.fn() }) },
}));

const text = "PROJECT MEMORY (.voktty)\nShared facts for the original Chat.";
const originalPreferences = usePreferencesStore.getState();
const originalState = useChatStore.getState();
let scopes: MemoryConversation[];
let panels: ReturnType<typeof createNativeMemoryPresentation>[];
function packet() {
  return {
    schema: 1,
    decision: {
      schema: 1,
      policy: io.denied ? "never" : "manual",
      contextAllowed: !io.denied,
      captureAllowed: false,
      reason: io.denied ? "KIT_MEMORY_POLICY_NEVER" : "KIT_MEMORY_READY",
    },
    packet: io.denied
      ? null
      : {
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
function publish(root: string) {
  const state = useChatStore.getState();
  state.setLive({
    ...state.live,
    getCwd: () => root,
    getWorkspaceRoot: () => root,
    getFileRootContext: () => ({ root, workspace: { kind: "local" } }),
  });
}
function owner(id = "original") {
  const chat = getOrCreateChat(id);
  const scope = captureChatMemoryConversation(chat);
  if (!scope) throw new Error("Missing original memory conversation");
  scopes.push(scope);
  return { chat, scope };
}
async function bind(scope: MemoryConversation) {
  const presentation = createNativeMemoryPresentation();
  panels.push(presentation);
  const selection = await presentation.select(scope.cwd, { kind: "local" });
  const review = await presentation.reviewTrust(selection);
  await scope.bind({ presentation, selection, review, mode: "enabled" });
  const result = await scope.read();
  if (!result?.packet) throw new Error("Missing enabled fixture packet");
  return result.packet;
}
async function enabled() {
  const f = owner();
  const packet = await bind(f.scope);
  await f.scope.delivery?.enable(packet, () => true);
  expect(f.scope.delivery?.getSnapshot().enabled).toBe(true);
  return f;
}
beforeEach(() => {
  scopes = [];
  panels = [];
  io.denied = false;
  io.error = false;
  chats.clear();
  useChatStore.setState({
    activeSessionId: "original",
    selectedModelId: "ollama-local",
    sessions: ["original", "sibling"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
    })),
  });
  usePreferencesStore.setState({
    ollamaModelId: "fixture-consent",
    customInstructions: "Explicit user rules prevail.",
  });
  publish("/project");
  let nextId = 10;
  io.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "project_memory_open") return { id: 1, token: "panel" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_review_trust")
      return trustReply(args.request.revision);
    if (command === "project_memory_context_open")
      return { id: nextId++, token: "00000000-0000-4000-8000-000000000009" };
    if (command === "project_memory_context_bind")
      return { schema: 1, root: trustReply().root };
    if (command === "project_memory_context_read") return packet();
  });
  io.stream.mockReset().mockImplementation(async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        if (io.error)
          controller.enqueue({
            type: "error",
            error: new Error("fixture provider failed"),
          });
        else {
          controller.enqueue({ type: "text-start", id: "answer" });
          controller.enqueue({
            type: "text-delta",
            id: "answer",
            delta: "model answer",
          });
          controller.enqueue({ type: "text-end", id: "answer" });
        }
        controller.enqueue({
          type: "finish",
          finishReason: {
            unified: io.error ? "error" : "stop",
            raw: undefined,
          },
          usage: {
            inputTokens: {
              total: 10,
              noCache: 10,
              cacheRead: 0,
              cacheWrite: 0,
            },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        });
        controller.close();
      },
    }),
  }));
  io.model.mockReturnValue(
    new MockLanguageModelV4({ doStream: (options) => io.stream(options) }),
  );
});
afterEach(async () => {
  for (const chat of chats.values()) forgetChatMemoryOwner(chat);
  await Promise.all(scopes.map((scope) => scope.close()));
  await Promise.all(panels.map((panel) => panel.close()));
  chats.clear();
  useChatStore.setState({
    activeSessionId: originalState.activeSessionId,
    sessions: originalState.sessions,
    selectedModelId: originalState.selectedModelId,
    live: originalState.live,
  });
  usePreferencesStore.setState({
    ollamaModelId: originalPreferences.ollamaModelId,
    customInstructions: originalPreferences.customInstructions,
  });
});

it("keeps memory out of requests until explicit delivery enablement, then records an actual SDK response", async () => {
  const f = owner();
  expect(getChatProjectKitMemory(f.chat)).toBeUndefined();
  const expected = await bind(f.scope);
  expect(getChatProjectKitMemory(f.chat)).toBeUndefined();
  await f.chat.sendMessage({ text: "ordinary task" });
  expect(
    JSON.stringify(io.stream.mock.calls[0][0].prompt).includes(
      "PROJECT MEMORY (.voktty)",
    ),
  ).toBe(false);
  expect(f.scope.delivery?.getSnapshot().receipt).toBeNull();
  await f.scope.delivery?.enable(expected, () => true);
  expect(io.stream).toHaveBeenCalledTimes(1);
  await f.chat.sendMessage({ text: "memory task" });
  const prompt = io.stream.mock.calls[1][0].prompt;
  const user = [...prompt]
    .reverse()
    .find((message: { role: string }) => message.role === "user");
  expect(user.content[0]).toEqual({ type: "text", text });
  const receipt = f.scope.delivery?.getSnapshot().receipt;
  expect(receipt).toMatchObject({
    method: "model-response",
    modelId: "ollama-local",
    requestId: expect.any(String),
    packet: expected,
  });
  expect(receipt).not.toHaveProperty("providerSessionId");
  expect(
    JSON.stringify(f.chat.messages).includes("PROJECT MEMORY (.voktty)"),
  ).toBe(false);
});

it("retains accepted consent for the original Chat when another conversation is selected", async () => {
  const f = await enabled();
  const sibling = getOrCreateChat("sibling");
  useChatStore.getState().switchSession("sibling");
  expect(getChatProjectKitMemory(sibling)).toBeUndefined();
  await f.chat.sendMessage({ text: "original background task" });
  expect(f.scope.delivery?.getSnapshot().receipt?.method).toBe(
    "model-response",
  );
  expect(getChatProjectKitMemory(sibling)).toBeUndefined();
});

it("does not fall back to ordinary delivery after enabled context retires, even before its first request", async () => {
  const f = await enabled();
  publish("/other");
  publish("/project");
  expect(() => getChatProjectKitMemory(f.chat)).toThrow("cancelled");
  await f.chat.sendMessage({ text: "must not send" });
  expect(io.stream).not.toHaveBeenCalled();
  expect(f.scope.isCurrent()).toBe(false);
});

it("permits ordinary requests after explicit disable in the same root", async () => {
  const f = await enabled();
  await f.scope.close();
  expect(getChatProjectKitMemory(f.chat)).toBeUndefined();
  await f.chat.sendMessage({ text: "ordinary task" });
  expect(io.stream).toHaveBeenCalledTimes(1);
  expect(
    JSON.stringify(io.stream.mock.calls[0][0].prompt).includes(
      "PROJECT MEMORY (.voktty)",
    ),
  ).toBe(false);
});

it("rechecks native policy and refuses a requested memory turn without silent fallback", async () => {
  const f = await enabled();
  io.denied = true;
  await f.chat.sendMessage({ text: "policy blocked" });
  expect(io.stream).not.toHaveBeenCalled();
  expect(f.scope.delivery?.getSnapshot().receipt).toBeNull();
});

it("does not publish a receipt for provider errors", async () => {
  const f = await enabled();
  io.error = true;
  await f.chat.sendMessage({ text: "failing model" });
  expect(io.stream).toHaveBeenCalledTimes(1);
  expect(f.scope.delivery?.getSnapshot().receipt).toBeNull();
});

it("blocks a CLI model after API memory was enabled without starting a provider", async () => {
  const f = await enabled();
  useChatStore.setState({ selectedModelId: "harness-claude" });
  await f.chat.sendMessage({ text: "unsupported model" });
  expect(io.stream).not.toHaveBeenCalled();
  expect(f.scope.delivery?.getSnapshot().receipt).toBeNull();
});

it("rejects a retired getter before cleanup observers can publish a replacement", async () => {
  const f = await enabled();
  let observation = "missing";
  f.scope.subscribe(() => {
    if (!f.scope.isCurrent()) {
      try {
        getChatProjectKitMemory(f.chat);
        observation = "fallback";
      } catch {
        observation = "blocked";
      }
    }
  });
  publish("/other");
  expect(observation).toBe("blocked");
  expect(() => getChatProjectKitMemory(f.chat)).toThrow("cancelled");
});

it("retains requested delivery before reentrant enable observers can retire its root", async () => {
  const f = owner();
  const expected = await bind(f.scope);
  f.scope.subscribe(() => {
    if (f.scope.delivery?.getSnapshot().enabled) publish("/other");
  });
  await f.scope.delivery?.enable(expected, () => true);
  expect(() => getChatProjectKitMemory(f.chat)).toThrow("cancelled");
  await f.chat.sendMessage({ text: "must not fall back" });
  expect(io.stream).not.toHaveBeenCalled();
});

it("rejects a late native context read after retirement without starting the model", async () => {
  const f = await enabled();
  let finish!: (value: unknown) => void;
  let start!: () => void;
  const held = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const admitted = new Promise<void>((resolve) => {
    start = resolve;
  });
  const original = io.invoke.getMockImplementation();
  io.invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_read") {
      start();
      return held;
    }
    return original?.(command, args);
  });
  const pending = f.chat.sendMessage({ text: "retiring request" });
  await admitted;
  publish("/other");
  finish(packet());
  await pending;
  expect(io.stream).not.toHaveBeenCalled();
  expect(() => getChatProjectKitMemory(f.chat)).toThrow("cancelled");
});
