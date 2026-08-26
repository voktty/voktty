import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  clearConversationScrollForTests,
  estimatedTokens,
  estimateMessageHeight,
  loadConversationScroll,
  saveConversationScroll,
  shouldVirtualizeConversation,
  updateConversationEstimate,
} from "./conversationPerformance";

function message(
  id: string,
  text: string,
  role: "user" | "assistant" = "assistant",
): UIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

describe("conversation performance model", () => {
  it("updates only the trailing message during streaming", () => {
    const first = message("one", "stable");
    const trailing = message("two", "a");
    const estimate = vi.fn((entry: UIMessage) =>
      entry.parts[0]?.type === "text" ? entry.parts[0].text.length : 0,
    );
    const baseline = updateConversationEstimate(
      null,
      "session",
      [first, trailing],
      estimate,
    );
    estimate.mockClear();

    const streamed = updateConversationEstimate(
      baseline,
      "session",
      [first, message("two", "abcd")],
      estimate,
    );

    expect(estimate).toHaveBeenCalledTimes(1);
    expect(streamed.totalChars).toBe(10);
    expect(estimatedTokens(streamed)).toBe(3);
  });

  it("recounts a trailing object mutated in place without scanning history", () => {
    const first = message("one", "stable");
    const trailing = message("two", "a");
    const estimate = vi.fn((entry: UIMessage) =>
      entry.parts[0]?.type === "text" ? entry.parts[0].text.length : 0,
    );
    const baseline = updateConversationEstimate(
      null,
      "session",
      [first, trailing],
      estimate,
    );
    (trailing.parts[0] as { type: "text"; text: string }).text = "abcdef";
    estimate.mockClear();

    const streamed = updateConversationEstimate(
      baseline,
      "session",
      [first, trailing],
      estimate,
    );

    expect(estimate).toHaveBeenCalledTimes(1);
    expect(streamed.totalChars).toBe(12);
  });

  it("uses a full rebuild after structural history changes", () => {
    const baseline = updateConversationEstimate(null, "session", [
      message("one", "a"),
      message("two", "bb"),
    ]);
    const estimate = vi.fn(() => 5);

    const rebuilt = updateConversationEstimate(
      baseline,
      "session",
      [message("replacement", "x")],
      estimate,
    );

    expect(estimate).toHaveBeenCalledTimes(1);
    expect(rebuilt.totalChars).toBe(5);
  });

  it("enables windowing only for histories large enough to benefit", () => {
    expect(shouldVirtualizeConversation(8, 4_000)).toBe(false);
    expect(shouldVirtualizeConversation(25, 4_000)).toBe(true);
    expect(shouldVirtualizeConversation(6, 60_001)).toBe(true);
    expect(estimateMessageHeight(message("one", "a\nb\nc"), 3)).toBeGreaterThan(
      100,
    );
  });

  it("keeps only the most recent twenty session scroll positions", () => {
    clearConversationScrollForTests();
    for (let index = 0; index < 21; index += 1) {
      saveConversationScroll(`session-${index}`, {
        scrollTop: index * 10,
        atBottom: false,
      });
    }

    expect(loadConversationScroll("session-0")).toBeNull();
    expect(loadConversationScroll("session-20")).toEqual({
      scrollTop: 200,
      atBottom: false,
    });
  });
});
