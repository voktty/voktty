import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Chat } from "@ai-sdk/react";
import type { AiFileRootContext } from "@/modules/ai/lib/aiFileContext";
import {
  captureChatMemoryConversation,
  forgetChatMemoryOwner,
  registerChatMemoryOwner,
  prepareChatProjectKitMemory,
} from "@/modules/ai/lib/chatMemoryOwner";
import { getOrCreateChat } from "@/modules/ai/store/chatRuntime";
import { chats, touchChat, useChatStore } from "@/modules/ai/store/chatStore";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";
import { trustReply } from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));
vi.mock("@/modules/ai/lib/transport", () => ({
  createContextAwareTransport: () => ({
    sendMessages: vi.fn(),
    reconnectToStream: async () => null,
  }),
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

const boundary: AiFileRootContext = {
  root: "/project",
  workspace: { kind: "local" },
};
let scopes: MemoryConversation[];
let panels: ReturnType<typeof createNativeMemoryPresentation>[];
const extraOwners = new Set<object>();
function capture(chat = getOrCreateChat("original")) {
  const scope = captureChatMemoryConversation(chat);
  if (!scope) throw new Error("Missing chat memory owner");
  scopes.push(scope);
  return scope;
}
function publish(root: AiFileRootContext | null) {
  const state = useChatStore.getState();
  state.setLive({ ...state.live, getFileRootContext: () => root });
}
async function bind(scope: MemoryConversation) {
  const presentation = createNativeMemoryPresentation();
  panels.push(presentation);
  const selection = await presentation.select(scope.cwd, { kind: "local" });
  const review = await presentation.reviewTrust(selection);
  await scope.bind({ presentation, selection, review, mode: "enabled" });
}
beforeEach(() => {
  scopes = [];
  panels = [];
  chats.clear();
  useChatStore.setState({
    activeSessionId: "original",
    sessions: ["original", "sibling"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
    })),
  });
  publish(boundary);
  let nextId = 10;
  invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "project_memory_open") return { id: 1, token: "panel" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_review_trust")
      return trustReply(args.request.revision);
    if (command === "project_memory_context_open")
      return { id: nextId++, token: "00000000-0000-4000-8000-000000000009" };
    if (command === "project_memory_context_bind")
      return { schema: 1, root: trustReply().root };
    if (command === "project_memory_context_read")
      return {
        schema: 1,
        decision: {
          schema: 1,
          policy: "never",
          contextAllowed: false,
          captureAllowed: false,
          reason: "KIT_MEMORY_POLICY_NEVER",
        },
        packet: null,
      };
  });
});
afterEach(async () => {
  for (const chat of chats.values()) forgetChatMemoryOwner(chat);
  for (const owner of extraOwners) forgetChatMemoryOwner(owner);
  extraOwners.clear();
  await Promise.all(scopes.map((scope) => scope.close()));
  await Promise.all(panels.map((panel) => panel.close()));
  chats.clear();
  useChatStore.setState({ activeSessionId: null, sessions: [] });
});

it("allocates no memory resource or root read by constructing and selecting chats", () => {
  const root = vi.fn(() => boundary);
  const state = useChatStore.getState();
  state.setLive({ ...state.live, getFileRootContext: root });
  getOrCreateChat("original");
  getOrCreateChat("sibling");
  useChatStore.getState().switchSession("sibling");
  state.setLive({ ...state.live, getFileRootContext: root });
  expect(root).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});

it("prepares an ordinary request without global memory IPC", async () => {
  const chat = getOrCreateChat("original");
  invoke.mockRejectedValue(new Error("application storage unavailable"));
  expect(await prepareChatProjectKitMemory(chat, () => {})).toBeUndefined();
  expect(invoke).not.toHaveBeenCalled();
});

it("captures the exact Chat independently of active selection and Stop", async () => {
  const chat = getOrCreateChat("original");
  const scope = capture(chat);
  expect(scope.delivery?.getSnapshot()).toMatchObject({
    supported: true,
    channel: "model-response",
    enabled: false,
  });
  await bind(scope);
  getOrCreateChat("sibling");
  useChatStore.getState().switchSession("sibling");
  await chat.stop();
  expect(capture(chat)).toBe(scope);
  expect((await scope.read())?.decision.reason).toBe("KIT_MEMORY_POLICY_NEVER");
});

it.each(["delete", "replace", "evict"])(
  "retires a %s Chat before callbacks without borrowing its replacement",
  async (operation) => {
    const chat = getOrCreateChat("original");
    const scope = capture(chat);
    await bind(scope);
    const stop = chat.stop;
    let retiredAtStop: boolean | undefined;
    chat.stop = () => {
      retiredAtStop = !scope.isCurrent();
      return stop();
    };
    getOrCreateChat("sibling");
    useChatStore.getState().switchSession("sibling");
    if (operation === "delete") useChatStore.getState().deleteSession(chat.id);
    else if (operation === "replace") {
      const replacement = new Chat({ id: chat.id });
      registerChatMemoryOwner(replacement, {
        isCurrent: () => chats.get(chat.id) === replacement,
        getRoot: () => boundary,
      });
      touchChat(chat.id, replacement);
    } else {
      for (let index = 0; index < 8; index++) getOrCreateChat(`other-${index}`);
    }
    expect(scope.isCurrent()).toBe(false);
    expect(captureChatMemoryConversation(chat)).toBeNull();
    if (operation !== "replace") expect(retiredAtStop).toBe(true);
    await scope.close();
    const next = getOrCreateChat("original");
    expect(next).not.toBe(chat);
    expect(next.id).toBe(chat.id);
    expect(capture(next).status()).toBe("inactive");
  },
);

const changedRoots: (AiFileRootContext | null)[] = [
  null,
  { root: "/other", workspace: { kind: "local" } },
  { root: "/project", workspace: { kind: "wsl", distro: "fixture" } },
  { root: "remote://host/project", workspace: { kind: "local" } },
];
it.each(changedRoots)(
  "permanently retires the old root on an observed roundtrip through %j",
  async (changed) => {
    const chat = getOrCreateChat("original");
    const scope = capture(chat);
    await bind(scope);
    publish(changed);
    publish(boundary);
    expect(scope.isCurrent()).toBe(false);
    expect(captureChatMemoryConversation(chat)).toBeNull();
    expect(capture(getOrCreateChat("new-chat")).status()).toBe("inactive");
  },
);

it("retires before a store subscriber can restore the previous root", () => {
  const chat = getOrCreateChat("original");
  const scope = capture(chat);
  let restored = false;
  const unsubscribe = useChatStore.subscribe(() => {
    if (restored) return;
    restored = true;
    publish(boundary);
  });
  try {
    publish({ root: "/other", workspace: { kind: "local" } });
  } finally {
    unsubscribe();
  }
  expect(restored).toBe(true);
  expect(scope.isCurrent()).toBe(false);
  expect(captureChatMemoryConversation(chat)).toBeNull();
});

it.each(changedRoots)(
  "only captures valid local boundaries without native IO: %j",
  (root) => {
    publish(root);
    const chat = getOrCreateChat("original");
    if (root?.workspace.kind === "local" && root.root === "/other") {
      expect(capture(chat).cwd).toBe("/other");
    } else expect(captureChatMemoryConversation(chat)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  },
);

it("preserves an exact root across harmless republication and permits explicit reactivation after close", async () => {
  const chat = getOrCreateChat("original");
  const first = capture(chat);
  await bind(first);
  publish(structuredClone(boundary));
  expect(capture(chat)).toBe(first);
  await first.close();
  const second = capture(chat);
  expect(second).not.toBe(first);
  expect(second.status()).toBe("inactive");
  await bind(second);
  expect(second.status()).toBe("ready");
});

it("reserves capture before a reentrant root getter can allocate another context", () => {
  const chat = {};
  extraOwners.add(chat);
  let nested: MemoryConversation | null | undefined;
  registerChatMemoryOwner(chat, {
    isCurrent: () => true,
    getRoot: () => {
      if (nested === undefined) nested = captureChatMemoryConversation(chat);
      return boundary;
    },
  });
  const scope = captureChatMemoryConversation(chat);
  if (!scope) throw new Error("Missing reentrant capture");
  scopes.push(scope);
  expect(nested).toBeNull();
  expect(captureChatMemoryConversation(chat)).toBe(scope);
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects a deleted chat's pending read while preserving the same-ID successor", async () => {
  const chat = getOrCreateChat("original");
  const scope = capture(chat);
  await bind(scope);
  let finish!: (value: unknown) => void;
  let started!: () => void;
  const reading = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const admitted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_read") {
      started();
      return reading;
    }
    return original?.(command, args);
  });
  const pending = scope.read().catch((error: unknown) => error);
  await admitted;
  useChatStore.getState().deleteSession(chat.id);
  const next = capture(getOrCreateChat(chat.id));
  finish(null);
  expect(await pending).toMatchObject({ code: "cancelled" });
  expect(next.status()).toBe("inactive");
  await bind(next);
  expect(next.status()).toBe("ready");
});

it("rebinds same-root replacement publications before observing later root roundtrips", async () => {
  const chat = getOrCreateChat("original");
  const scope = capture(chat);
  await bind(scope);
  const listeners = new Set<() => void>();
  let next = boundary;
  const state = useChatStore.getState();
  state.setLive({
    ...state.live,
    getFileRootContext: () => next,
    subscribeFileRootContext(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  expect(scope.isCurrent()).toBe(true);
  expect(listeners.size).toBe(1);
  next = { root: "/other", workspace: { kind: "local" } };
  for (const listener of [...listeners]) listener();
  next = boundary;
  for (const listener of [...listeners]) listener();
  expect(scope.isCurrent()).toBe(false);
  expect(listeners.size).toBe(0);
});

it("fails closed when a replacement publication cannot be observed", async () => {
  const scope = capture();
  await bind(scope);
  const state = useChatStore.getState();
  expect(() =>
    state.setLive({
      ...state.live,
      subscribeFileRootContext: () => {
        throw new Error("fixture observer failure");
      },
    }),
  ).not.toThrow();
  expect(scope.isCurrent()).toBe(false);
});
