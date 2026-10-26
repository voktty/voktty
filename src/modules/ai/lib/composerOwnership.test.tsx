// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Chat, type UIMessage } from "@ai-sdk/react";
import { AiComposerProvider, useComposer } from "@/modules/ai/lib/composer";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";

const fixture = vi.hoisted(() => ({ createChat: vi.fn(), present: vi.fn() }));
vi.mock("@/modules/ai/store/chatRuntime", () => ({
  getOrCreateChat: fixture.createChat,
}));
vi.mock("@/modules/ai/hooks/useWhisperRecording", () => ({
  useWhisperRecording: () => ({}),
}));
vi.mock("@/modules/ai/lib/slashCommands", () => ({
  tryRunSlashCommand: () => ({ kind: "unhandled" }),
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
vi.mock("@/modules/ai/store/todoStore", () => ({
  useTodosStore: { getState: () => ({ clearSession: vi.fn() }) },
}));

let composer: ReturnType<typeof useComposer>;
let root: Root | null;
let node: HTMLDivElement;
function Probe() {
  composer = useComposer();
  return null;
}
function makeChat(id: string) {
  const chat = new Chat<UIMessage>({
    id,
    transport: {
      sendMessages: async () => new ReadableStream({ start: (c) => c.close() }),
      reconnectToStream: async () => null,
    },
  });
  chats.set(id, chat);
  vi.spyOn(chat, "sendMessage").mockResolvedValue(undefined);
  vi.spyOn(chat, "stop").mockResolvedValue(undefined);
  return chat;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.createChat
    .mockReset()
    .mockImplementation((id: string) => chats.get(id) ?? makeChat(id));
  fixture.present.mockReset();
  chats.clear();
  useChatStore.setState({
    activeSessionId: "original",
    sessions: ["original", "selected"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
    })),
    presentChat: fixture.present,
    pendingSelections: [],
    focusSignal: 0,
    pendingPrefill: null,
  });
  useChatStore.getState().resetAgentMeta();
  node = document.createElement("div");
  root = createRoot(node);
  await act(async () => {
    root?.render(createElement(AiComposerProvider, null, createElement(Probe)));
  });
  await act(async () => composer.setValue("original prompt"));
});
afterEach(async () => {
  await act(async () => {
    root?.unmount();
    root = null;
  });
  chats.clear();
  useChatStore.setState({ activeSessionId: null, sessions: [] });
  vi.unstubAllGlobals();
});

it.each(["delete", "unmount", "switch", "roundtrip"])(
  "does not create or send a late Chat after %s while runtime loads",
  async (mode) => {
    const original = makeChat("original");
    makeChat("selected");
    await act(async () => {
      composer.submit();
      if (mode === "delete") useChatStore.getState().deleteSession("original");
      else if (mode === "unmount") {
        root?.unmount();
        root = null;
      } else {
        useChatStore.getState().switchSession("selected");
        if (mode === "roundtrip")
          useChatStore.getState().switchSession("original");
      }
    });
    expect(fixture.createChat).not.toHaveBeenCalled();
    expect(original.sendMessage).not.toHaveBeenCalled();
  },
);

it("ignores a cached submit and Stop after selection changes before React commits", async () => {
  const original = makeChat("original");
  const selected = makeChat("selected");
  const submit = composer.submit;
  const stop = composer.stop;
  await act(async () => {
    useChatStore.getState().switchSession("selected");
    submit();
    stop();
  });
  expect(fixture.createChat).not.toHaveBeenCalled();
  expect(original.sendMessage).not.toHaveBeenCalled();
  expect(original.stop).not.toHaveBeenCalled();
  expect(selected.stop).not.toHaveBeenCalled();
});

it("coalesces duplicate submits while the runtime import is pending", async () => {
  const original = makeChat("original");
  await act(async () => {
    composer.submit();
    composer.submit();
  });
  expect(original.sendMessage).toHaveBeenCalledTimes(1);
  expect(original.sendMessage).toHaveBeenCalledWith({
    role: "user",
    parts: [{ type: "text", text: "original prompt" }],
  });
});

it("admits fresh callbacks after a selection round trip without reviving old ones", async () => {
  const original = makeChat("original");
  makeChat("selected");
  const previous = composer.submit;
  await act(async () => {
    useChatStore.getState().switchSession("selected");
    useChatStore.getState().switchSession("original");
  });
  await act(async () => previous());
  expect(original.sendMessage).not.toHaveBeenCalled();
  await act(async () => composer.submit());
  expect(original.sendMessage).toHaveBeenCalledTimes(1);
});

it("keeps text typed while the runtime import is pending", async () => {
  const original = makeChat("original");
  await act(async () => {
    composer.submit();
    composer.setValue("new draft");
  });
  expect(original.sendMessage).toHaveBeenCalledWith({
    role: "user",
    parts: [{ type: "text", text: "original prompt" }],
  });
  expect(composer.value).toBe("new draft");
});

it("preserves attachments added while its original message is waiting to send", async () => {
  const first = { id: "first", name: "first.txt", text: "original", size: 8 };
  const second = { id: "second", name: "second.txt", text: "new", size: 3 };
  const focus = useChatStore.getState().focusInput;
  useChatStore.setState({ focusInput: vi.fn() });
  try {
    await act(async () => composer.attachTextFile(first));
    const original = makeChat("original");
    await act(async () => {
      composer.submit();
      composer.attachTextFile(second);
    });
    expect(original.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          expect.objectContaining({
            text: expect.stringContaining("first.txt"),
          }),
        ],
      }),
    );
    expect(composer.files.map((file) => file.id)).toEqual(["first", "second"]);
  } finally {
    useChatStore.setState({ focusInput: focus });
  }
});

it("Stop cancels a pending lazy submit and a fresh submit can retry", async () => {
  await act(async () => {
    composer.submit();
    composer.stop();
  });
  expect(fixture.createChat).not.toHaveBeenCalled();
  expect(composer.value).toBe("original prompt");
  await act(async () => composer.submit());
  expect(fixture.createChat).toHaveBeenCalledExactlyOnceWith("original");
  expect(chats.get("original")?.sendMessage).toHaveBeenCalledTimes(1);
});

it("does not send through a replacement that appears while the import is pending", async () => {
  const original = makeChat("original");
  let replacement: typeof original | undefined;
  await act(async () => {
    composer.submit();
    replacement = makeChat("original");
  });
  expect(original.sendMessage).not.toHaveBeenCalled();
  expect(replacement?.sendMessage).not.toHaveBeenCalled();
  expect(fixture.createChat).not.toHaveBeenCalled();
});

it("preserves the draft when Chat creation fails and releases admission for retry", async () => {
  fixture.createChat.mockImplementationOnce(() => {
    throw new Error("fixture");
  });
  await act(async () => composer.submit());
  expect(composer.value).toBe("original prompt");
  await act(async () => composer.submit());
  expect(chats.get("original")?.sendMessage).toHaveBeenCalledTimes(1);
});

it("admits exactly one live submit under StrictMode", async () => {
  await act(async () => {
    root?.render(
      createElement(
        StrictMode,
        null,
        createElement(AiComposerProvider, null, createElement(Probe)),
      ),
    );
  });
  await act(async () => composer.setValue("strict prompt"));
  const original = makeChat("original");
  await act(async () => composer.submit());
  expect(original.sendMessage).toHaveBeenCalledExactlyOnceWith({
    role: "user",
    parts: [{ type: "text", text: "strict prompt" }],
  });
});

it.each(["switch", "unmount", "stop"])(
  "cancels its own deferred focus after %s",
  async (mode) => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 42;
    });
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    makeChat("original");
    makeChat("selected");
    const input = document.createElement("textarea");
    const focus = vi.spyOn(input, "focus");
    composer.textareaRef.current = input;
    await act(async () => composer.submit());
    expect(frame).toBeDefined();
    await act(async () => {
      if (mode === "switch") useChatStore.getState().switchSession("selected");
      else if (mode === "unmount") {
        root?.unmount();
        root = null;
      } else composer.stop();
    });
    expect(cancel).toHaveBeenCalledWith(42);
    frame?.(0);
    expect(focus).not.toHaveBeenCalled();
  },
);
