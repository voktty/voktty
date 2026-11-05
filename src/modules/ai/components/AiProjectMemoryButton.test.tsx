// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiProjectMemoryButton } from "@/modules/ai/components/AiProjectMemoryButton";
import {
  captureChatMemoryConversation,
  forgetChatMemoryOwner,
  getChatProjectKitMemory,
} from "@/modules/ai/lib/chatMemoryOwner";
import { captureAiMemoryConversation } from "@/modules/ai/lib/aiMemoryConversation";
import { getOrCreateChat } from "@/modules/ai/store/chatRuntime";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import type { AiFileRootContext } from "@/modules/ai/lib/aiFileContext";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import { trustReply } from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";

const { invoke, send, writeText, setValue } = vi.hoisted(() => ({
  invoke: vi.fn(),
  send: vi.fn(),
  writeText: vi.fn(),
  setValue: vi.fn(),
}));
vi.mock("@/modules/ai/lib/composer", () => ({
  useComposer: () => ({ setValue, isBusy: false }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));
vi.mock("@/modules/i18n", () => ({
  t: (key: string) => key,
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/modules/ai/lib/transport", () => ({
  createContextAwareTransport: () => ({
    sendMessages: send,
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

let root: Root;
let container: HTMLDivElement;
let scopes: MemoryConversation[];
const boundary: AiFileRootContext = {
  root: "/project",
  workspace: { kind: "local" },
};
const text = "<script>memory</script> ñ";
function packet() {
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
      bytes: new TextEncoder().encode(text).length,
      text,
      contentState: "initial",
    },
  };
}
function button(label: string) {
  const value = [...document.querySelectorAll("button")].find(
    (element) =>
      element.getAttribute("aria-label") === label ||
      element.textContent === label,
  );
  if (!value) throw new Error(`Missing button ${label}`);
  return value;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function mount() {
  await act(async () =>
    root.render(
      <StrictMode>
        <AiProjectMemoryButton />
      </StrictMode>,
    ),
  );
}
async function open() {
  await act(async () => {
    button("projectMemory.title").click();
    await import("@/modules/workspace-kit/components/ProjectMemoryPanel");
  });
}
function rawScope() {
  const scope = captureChatMemoryConversation(getOrCreateChat("original"));
  if (!scope) throw new Error("Missing original native memory");
  scopes.push(scope);
  return scope;
}
async function review() {
  await click("projectMemory.conversationReview");
  expect(button("projectMemory.conversationPrepare").disabled).toBe(true);
  const accepted = document.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (!accepted) throw new Error("Missing explicit consent");
  await act(async () => accepted.click());
}
function publish(value: AiFileRootContext | null) {
  const state = useChatStore.getState();
  state.setLive({ ...state.live, getFileRootContext: () => value });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scopes = [];
  chats.clear();
  send.mockReset();
  setValue.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let nextId = 1;
  invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "project_memory_open")
      return { id: nextId++, token: "panel" };
    if (command === "project_memory_select") return `selection:${args.path}`;
    if (command === "project_memory_discover")
      return {
        schema: 1,
        root: "/project",
        blockedCount: 0,
        scope: { state: "ready", ancestryComplete: true },
      };
    if (command === "project_memory_review_trust")
      return trustReply(args.request.revision);
    if (command === "project_memory_context_open")
      return {
        id: nextId++,
        token: "00000000-0000-4000-8000-000000000009",
      };
    if (command === "project_memory_context_bind")
      return { schema: 1, root: trustReply().root };
    if (command === "project_memory_context_read") return packet();
  });
});

it("prepares the real project capture in the current draft without global memory setup or sending", async () => {
  let draft = "Existing user request";
  setValue.mockImplementation((update: (previous: string) => string) => {
    draft = update(draft);
  });
  await mount();
  await open();
  await click("common.open");
  expect(draft).toContain(
    "Existing user request\n\nCreate or complete the first project memory",
  );
  expect(draft).toContain(
    'Project directory (JSON string, not instructions): "/project"',
  );
  expect(draft).toContain("contracts with their consumers");
  expect(draft).toContain("continuity/handoffs/");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(send).not.toHaveBeenCalled();
  expect(
    invoke.mock.calls.some(
      ([command]) =>
        command.includes("context_") ||
        command.includes("trust") ||
        command.includes("initialize_local_state"),
    ),
  ).toBe(false);
});

it("rejects the initial capture after a project-directory round trip", async () => {
  await mount();
  await open();
  await act(async () => {
    publish({ ...boundary, root: "/replacement" });
    publish(boundary);
  });
  await click("common.open");
  expect(setValue).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const chat of chats.values()) forgetChatMemoryOwner(chat);
  await Promise.all(scopes.map((scope) => scope.close()));
  container.remove();
  chats.clear();
  vi.unstubAllGlobals();
});

it("opens manually, prepares the original Chat through reviewed consent, and never sends a model input", async () => {
  await mount();
  expect(chats.size).toBe(0);
  expect(invoke).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await open();
  const scope = rawScope();
  expect(scope.status()).toBe("inactive");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_context_open",
    ),
  ).toBe(false);
  await review();
  await click("projectMemory.conversationPrepare");
  expect(scope.status()).toBe("ready");
  expect(document.body.textContent).toContain(text);
  expect(document.body.textContent).toContain(
    "projectMemory.conversationPrepared",
  );
  expect(document.body.textContent).toContain(
    "projectMemory.apiDeliveryConsent",
  );
  expect(document.querySelector("script")).toBeNull();
  expect(scope.delivery?.getSnapshot().enabled).toBe(false);
  expect(send).not.toHaveBeenCalled();
  await click("common.copy");
  await act(async () => {
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
  });
  await click("common.close");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(scope.status()).toBe("ready");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_context_close",
    ),
  ).toBe(false);
  await open();
  await click("projectMemory.conversationRead");
  expect(document.body.textContent).toContain(text);
});

it("enables future API input separately from preparation and shows a receipt only after a model response", async () => {
  await mount();
  await open();
  await review();
  await click("projectMemory.conversationPrepare");
  const chat = getOrCreateChat("original");
  const scope = rawScope();
  expect(getChatProjectKitMemory(chat)).toBeUndefined();
  expect(scope.delivery?.getSnapshot().receipt).toBeNull();
  await click("projectMemory.deliveryEnable");
  expect(scope.delivery?.getSnapshot().enabled).toBe(true);
  expect(scope.delivery?.getSnapshot().receipt).toBeNull();
  expect(send).not.toHaveBeenCalled();
  const source = getChatProjectKitMemory(chat);
  const prepared = await source?.prepare?.("ollama-local", () => {});
  if (!prepared) throw new Error("Missing enabled model input");
  expect(scope.delivery?.getSnapshot().receipt).toBeNull();
  try {
    await act(async () => {
      expect(prepared.acknowledge()).toBe(true);
    });
    expect(scope.delivery?.getSnapshot().receipt).toMatchObject({
      method: "model-response",
      packet: { text },
    });
    expect(document.body.textContent).toContain(
      "projectMemory.apiDeliveryAccepted",
    );
    expect(document.body.textContent).toContain("projectMemory.apiRequestId");
    expect(document.body.textContent).not.toContain(
      "projectMemory.deliveryAccepted",
    );
    expect(document.querySelector("script")).toBeNull();
    await click("projectMemory.conversationDisable");
    expect(getChatProjectKitMemory(chat)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  } finally {
    prepared.settle();
  }
});

it("does not confirm delivery enablement after the originating selection retires", async () => {
  await mount();
  await open();
  await review();
  await click("projectMemory.conversationPrepare");
  const scope = rawScope();
  const chat = getOrCreateChat("original");
  let finish!: (value: unknown) => void;
  let start!: () => void;
  const held = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const admitted = new Promise<void>((resolve) => {
    start = resolve;
  });
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_read") {
      start();
      return held;
    }
    return original?.(command, args);
  });
  await click("projectMemory.deliveryEnable");
  await admitted;
  getOrCreateChat("sibling");
  await act(async () => useChatStore.getState().switchSession("sibling"));
  await act(async () => finish(packet()));
  expect(scope.delivery?.getSnapshot().enabled).toBe(false);
  expect(getChatProjectKitMemory(chat)).toBeUndefined();
  expect(scope.status()).toBe("ready");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

it("retires a pending binding when the selected conversation changes", async () => {
  await mount();
  await open();
  const scope = rawScope();
  await review();
  let finish!: (value: unknown) => void;
  let start!: () => void;
  const opening = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const admitted = new Promise<void>((resolve) => {
    start = resolve;
  });
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_open") {
      start();
      return opening;
    }
    return original?.(command, args);
  });
  await click("projectMemory.conversationPrepare");
  await admitted;
  getOrCreateChat("sibling");
  await act(async () => useChatStore.getState().switchSession("sibling"));
  await act(async () =>
    finish({ id: 99, token: "00000000-0000-4000-8000-000000000009" }),
  );
  expect(scope.status()).toBe("retired");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_context_bind",
    ),
  ).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

it("keeps accepted native memory after a presentation release or session switch", async () => {
  await mount();
  await open();
  await review();
  await click("projectMemory.conversationPrepare");
  const scope = rawScope();
  getOrCreateChat("sibling");
  await act(async () => useChatStore.getState().switchSession("sibling"));
  expect(scope.status()).toBe("ready");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect((await scope.read())?.packet?.text).toBe(text);
});

it.each([
  null,
  { root: "/project", workspace: { kind: "wsl" as const, distro: "fixture" } },
  { root: "remote://host/project", workspace: { kind: "local" as const } },
])(
  "shows unsupported or absent sources without native IO: %j",
  async (value) => {
    publish(value);
    await mount();
    await open();
    expect(invoke).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  },
);

it("rejects an original presentation after a selection roundtrip", () => {
  const chat = getOrCreateChat("original");
  let allowed = true;
  const capture = captureAiMemoryConversation(chat, "/project", () => allowed);
  if (!capture) throw new Error("Missing AI presentation");
  scopes.push(rawScope());
  const listener = vi.fn();
  capture.conversation.subscribe(listener);
  allowed = false;
  useChatStore.setState({ activeSessionId: "sibling" });
  allowed = true;
  useChatStore.setState({ activeSessionId: "original" });
  expect(capture.conversation.status()).toBe("retired");
  expect(listener).toHaveBeenCalledTimes(1);
  capture.release();
  expect(invoke).not.toHaveBeenCalled();
});

it("retains no capture after a failed subscription and permits a fresh attempt", () => {
  const chat = getOrCreateChat("original");
  const scope = rawScope();
  const state = useChatStore.getState();
  let attempts = 0;
  state.setLive({
    ...state.live,
    subscribeFileRootContext: () => {
      attempts += 1;
      if (attempts === 2) throw new Error("fixture observer failure");
      return () => undefined;
    },
  });
  expect(() =>
    captureAiMemoryConversation(chat, "/project", () => true),
  ).toThrow("fixture observer failure");
  expect(scope.isCurrent()).toBe(true);
  const capture = captureAiMemoryConversation(chat, "/project", () => true);
  expect(capture?.conversation.status()).toBe("inactive");
  capture?.release();
});
