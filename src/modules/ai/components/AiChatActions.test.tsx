// @vitest-environment happy-dom
import {
  act,
  Children,
  createElement,
  isValidElement,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Chat, type UIMessage } from "@ai-sdk/react";
import { AiChatView } from "@/modules/ai/components/AiChat";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";

const fixture = vi.hoisted(() => ({
  actions: {} as { onContinue?: () => void; onDismiss?: () => void },
  send: vi.fn(),
}));
vi.mock("@/modules/ai/store/chatRuntime", () => ({
  sendMessage: fixture.send,
}));
vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: ReactNode }) => children,
  ConversationContent: ({ children }: { children: ReactNode }) => {
    for (const child of Children.toArray(children)) {
      if (
        !isValidElement<{ onContinue?: () => void; onDismiss?: () => void }>(
          child,
        )
      )
        continue;
      if (child.props.onContinue)
        fixture.actions.onContinue = child.props.onContinue;
      if (child.props.onDismiss)
        fixture.actions.onDismiss = child.props.onDismiss;
    }
    return children;
  },
  ConversationEmptyState: () => null,
  ConversationScrollButton: () => null,
}));
vi.mock("use-stick-to-bottom", () => ({
  useStickToBottomContext: () => ({
    isAtBottom: true,
    scrollRef: { current: null },
    scrollToBottom: vi.fn(),
  }),
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

let root: Root | null;
const messages: UIMessage[] = [
  { id: "assistant", role: "assistant", parts: [] },
];
function makeChat(id: string) {
  const chat = new Chat<UIMessage>({ id });
  chats.set(id, chat);
  return chat;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.actions = {};
  fixture.send.mockReset().mockResolvedValue(true);
  chats.clear();
  const original = makeChat("original");
  makeChat("selected");
  useChatStore.setState({
    activeSessionId: "original",
    sessions: ["original", "selected"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
    })),
  });
  useChatStore.getState().patchAgentMeta(
    {
      hitStepCap: true,
      compactionNotice: { droppedCount: 3, at: 1 },
    },
    original,
  );
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root?.render(
      createElement(AiChatView, {
        sessionId: "original",
        messages,
        status: "ready",
        error: undefined,
        clearError: vi.fn(),
        addToolApprovalResponse: vi.fn(),
        stop: vi.fn(),
      }),
    );
  });
  expect(fixture.actions.onContinue).toBeDefined();
  expect(fixture.actions.onDismiss).toBeDefined();
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

it.each(["switch", "roundtrip", "unmount", "replacement"])(
  "rejects cached Continue and notice dismissal after %s",
  async (mode) => {
    const { onContinue, onDismiss } = fixture.actions;
    await act(async () => {
      if (mode === "unmount") {
        root?.unmount();
        root = null;
      } else if (mode === "replacement") makeChat("original");
      else {
        useChatStore.getState().switchSession("selected");
        if (mode === "roundtrip")
          useChatStore.getState().switchSession("original");
      }
      useChatStore.getState().patchAgentMeta({
        hitStepCap: true,
        compactionNotice: { droppedCount: 8, at: 2 },
      });
      onDismiss?.();
      onContinue?.();
    });
    expect(fixture.send).not.toHaveBeenCalled();
    expect(useChatStore.getState().agentMeta).toMatchObject({
      hitStepCap: true,
      compactionNotice: { droppedCount: 8, at: 2 },
    });
  },
);

it("keeps a newer compaction notice when an older dismissal arrives", async () => {
  const dismiss = fixture.actions.onDismiss;
  await act(async () => {
    useChatStore
      .getState()
      .patchAgentMeta({ compactionNotice: { droppedCount: 9, at: 3 } });
  });
  await act(async () => dismiss?.());
  expect(useChatStore.getState().agentMeta.compactionNotice).toEqual({
    droppedCount: 9,
    at: 3,
  });
});

it("consumes Continue once and sends through the original runtime", async () => {
  const proceed = fixture.actions.onContinue;
  await act(async () => {
    proceed?.();
    proceed?.();
  });
  expect(fixture.send).toHaveBeenCalledExactlyOnceWith(
    expect.any(String),
    chats.get("original"),
  );
  expect(useChatStore.getState().agentMeta.hitStepCap).toBe(false);
});

it("revalidates Continue after metadata observers change the selection", async () => {
  const proceed = fixture.actions.onContinue;
  const release = useChatStore.subscribe((state) => {
    if (state.activeSessionId === "original" && !state.agentMeta.hitStepCap)
      state.switchSession("selected");
  });
  try {
    await act(async () => proceed?.());
    expect(fixture.send).not.toHaveBeenCalled();
  } finally {
    release();
  }
});
