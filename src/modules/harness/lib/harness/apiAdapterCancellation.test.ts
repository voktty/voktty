import { expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";

const fixture = vi.hoisted(() => ({ histories: [] as ModelMessage[][] }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: () => () => ({}) }));
vi.mock("@/modules/harness/lib/harness/apiAgentLoop", () => ({
  runApiAgentLoop: async (input: { messages: ModelMessage[]; signal: AbortSignal }) => {
    fixture.histories.push(input.messages);
    if (fixture.histories.length === 2) {
      await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }));
      return [];
    }
    return [{ role: "assistant", content: "answer" }];
  },
}));

import { cancelApiTurn, forgetApiSession, sendApiTurn } from "./apiAdapter";

it("does not keep a cancelled user turn in the next request", async () => {
  const input = { sessionId: "history-cancel", cwd: "/project", model: "fixture", runtimeMode: "supervised" as const, onEvent: () => {} };
  await sendApiTurn({ ...input, text: "first" });
  const pending = sendApiTurn({ ...input, text: "cancelled" });
  await vi.waitFor(() => expect(fixture.histories).toHaveLength(2));
  await cancelApiTurn(input.sessionId);
  await pending;
  await sendApiTurn({ ...input, text: "next" });
  expect(fixture.histories[2]).toEqual([
    { role: "user", content: "first" },
    { role: "assistant", content: "answer" },
    { role: "user", content: "next" },
  ]);
  await forgetApiSession(input.sessionId);
});
