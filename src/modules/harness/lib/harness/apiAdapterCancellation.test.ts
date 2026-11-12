import { expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";

const fixture = vi.hoisted(() => ({ histories: [] as ModelMessage[][], tools: [] as unknown[] }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: () => () => ({}) }));
vi.mock("@/modules/ai/lib/agent", () => ({ buildStableSystem: () => "system" }));
vi.mock("@/modules/harness/lib/harness/apiTools", () => ({
  apiToolContext: () => null,
  forgetApiTools: async () => {},
}));
vi.mock("@/modules/harness/lib/harness/apiAgentLoop", () => ({
  runApiAgentLoop: async (input: { messages: ModelMessage[]; signal: AbortSignal; tools?: unknown }) => {
    fixture.histories.push(input.messages);
    fixture.tools.push(input.tools);
    if (fixture.histories.length === 2) {
      await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }));
      return [];
    }
    return [{ role: "assistant", content: "answer" }];
  },
}));

import { cancelApiTurn, ensureApiRegistered, forgetApiSession, sendApiTurn } from "./apiAdapter";
import { sendHarnessTurn } from "./registry";
import type { HarnessEvent } from "./types";

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

it("allows an SSH conversation without exposing local tools and warns the user", async () => {
  ensureApiRegistered();
  const events: HarnessEvent[] = [];
  await sendHarnessTurn({ harness: "api", sessionId: "remote-conversation", cwd: "remote://ssh-host/srv/project", model: "fixture", runtimeMode: "supervised", text: "Hello", onEvent: (event) => events.push(event) });
  expect(fixture.tools[fixture.tools.length - 1]).toBeUndefined();
  expect(events).toContainEqual(expect.objectContaining({ type: "status", text: expect.stringContaining("SSH") }));
  await forgetApiSession("remote-conversation");
});
