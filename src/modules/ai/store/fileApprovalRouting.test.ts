import { Chat, type UIMessage } from "@ai-sdk/react";
import { afterEach, expect, it, vi } from "vitest";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

function chat(id: string) {
  return new Chat<UIMessage>({
    id,
    messages: [
      {
        id: "message",
        role: "assistant",
        parts: [
          {
            type: "tool-write_file",
            toolCallId: "call",
            input: { path: "file.ts", content: "fixture" },
            state: "approval-requested",
            approval: { id: "same-approval" },
          },
        ],
      },
    ],
    transport: {
      sendMessages: vi.fn(
        async () =>
          new ReadableStream({ start: (controller) => controller.close() }),
      ),
      reconnectToStream: async () => null,
    },
  });
}

afterEach(() => {
  chats.clear();
  useChatStore.setState({ approvalResponder: null, activeSessionId: null });
});

it("responds to the diff's original Chat instead of the selected session", async () => {
  const original = chat("original");
  const selected = chat("selected");
  chats.set("original", original);
  chats.set("selected", selected);
  const originalResponse = vi.spyOn(original, "addToolApprovalResponse");
  const selectedResponse = vi.spyOn(selected, "addToolApprovalResponse");
  const ambient = vi.fn();
  useChatStore.setState({
    activeSessionId: "selected",
    approvalResponder: ambient,
  });
  useChatStore.getState().respondToApproval("same-approval", true, "original");
  expect(originalResponse).toHaveBeenCalledExactlyOnceWith({
    id: "same-approval",
    approved: true,
  });
  expect(selectedResponse).not.toHaveBeenCalled();
  expect(ambient).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(original.messages[0].parts[0]).toMatchObject({
      state: "approval-responded",
      approval: { approved: true },
    }),
  );
  expect(selected.messages[0].parts[0]).toMatchObject({
    state: "approval-requested",
  });
});

it("does not fall back to the active responder after the original runtime disappears", () => {
  const ambient = vi.fn();
  useChatStore.setState({
    activeSessionId: "selected",
    approvalResponder: ambient,
  });
  useChatStore.getState().respondToApproval("same-approval", true, "missing");
  expect(ambient).not.toHaveBeenCalled();
  expect(chats.size).toBe(0);
});
