// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { registerEmbeddedChat } from "@/modules/ai/lib/embeddedChat";
import { useChatStore } from "./chatStore";

vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  isAiRuntimeAvailable: () => true,
}));
afterEach(() => {
  useChatStore.getState().closeMini();
  useChatStore.setState({ unreadCount: 0, panelOpen: false });
});
it("keeps responses in the embedded chat and restores floating presentation after release", () => {
  const release = registerEmbeddedChat();
  try {
    useChatStore.getState().presentChat();
    useChatStore.getState().noteUnreadMessage();
    expect(useChatStore.getState().mini.open).toBe(false);
    expect(useChatStore.getState().unreadCount).toBe(0);
  } finally {
    release();
  }
  useChatStore.getState().noteUnreadMessage();
  expect(useChatStore.getState().unreadCount).toBe(1);
  useChatStore.getState().presentChat();
  expect(useChatStore.getState().mini.open).toBe(true);
});
