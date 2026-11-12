import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, expect, it, vi } from "vitest";
import type { HarnessEvent } from "./types";

const fixture = vi.hoisted(() => ({ model: null as unknown, writeFile: vi.fn(async () => undefined) }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: () => () => fixture.model }));
vi.mock("@/modules/ai/lib/native", () => ({ native: {
  canonicalize: async (path: string) => path,
  writeFile: fixture.writeFile,
} }));

import { forgetApiSession, respondApiApproval, sendApiTurn, cancelApiTurn, steerApiTurn, stopApiSession } from "./apiAdapter";
import { IS_WINDOWS as IS_WIN } from "@/lib/platform";

// Same platform check as isLocalPath: drive-letter project folders on Windows.
const ROOT = IS_WIN ? "c:/project" : "/project";

// Warming the whole chat agent graph is slow while the full suite runs in
// parallel, so this cold import gets more than the default hook timeout.
beforeAll(async () => {
  await import("@/modules/ai/lib/agent");
  await import("./apiTools");
  await import("./apiAgentLoop");
}, 60_000);

function model() {
  let step = 0;
  return new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      if (step++ === 0) {
        controller.enqueue({ type: "tool-input-start", id: "write-call", toolName: "write_file" });
        controller.enqueue({ type: "tool-call", toolCallId: "write-call", toolName: "write_file", input: JSON.stringify({ path: "file.ts", content: "hello" }) });
      }
      controller.enqueue({ type: "finish", usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 0, reasoning: 0 } }, finishReason: { unified: step === 1 ? "tool-calls" : "stop", raw: undefined } });
      controller.close();
    },
  }) }) });
}

it.each(["allow", "deny", "cancel", "full-access"] as const)("handles %s for a session-owned write", async (decision) => {
  fixture.writeFile.mockClear();
  fixture.model = model();
  const sessionId = `approval-${decision}`;
  const events: HarnessEvent[] = [];
  const pending = sendApiTurn({ sessionId, cwd: ROOT, model: "fixture", runtimeMode: decision === "full-access" ? "full-access" : "supervised", text: "Write", onEvent: (event) => {
    events.push(event);
    if (event.type !== "approval.requested") return;
    if (decision === "cancel") void cancelApiTurn(sessionId);
    else respondApiApproval(sessionId, event.requestId, decision === "allow" ? "allow" : "deny");
  } });
  await pending;
  expect(fixture.writeFile).toHaveBeenCalledTimes(decision === "allow" || decision === "full-access" ? 1 : 0);
  expect(events.some((event) => event.type === "approval.requested")).toBe(decision !== "full-access");
  if (decision === "cancel") expect(events).toContainEqual(expect.objectContaining({ type: "approval.resolved", decision: "cancelled" }));
  await forgetApiSession(sessionId);
});

it("ignores responses for other sessions and cancels on close", async () => {
  fixture.writeFile.mockClear();
  fixture.model = model();
  const sessionId = "approval-owner";
  let requestId = 0;
  const events: HarnessEvent[] = [];
  const pending = sendApiTurn({ sessionId, cwd: ROOT, model: "fixture", runtimeMode: "supervised", text: "Write", onEvent: (event) => {
    events.push(event);
    if (event.type === "approval.requested") requestId = event.requestId;
  } });
  await vi.waitFor(() => expect(requestId).not.toBe(0));
  respondApiApproval("another-session", requestId, "allow");
  respondApiApproval(sessionId, requestId + 1, "allow");
  expect(fixture.writeFile).not.toHaveBeenCalled();
  await stopApiSession(sessionId);
  await pending;
  expect(events).toContainEqual(expect.objectContaining({ type: "approval.resolved", decision: "cancelled" }));
  expect(fixture.writeFile).not.toHaveBeenCalled();
  await forgetApiSession(sessionId);
});

it("keeps supervised mode when steering", async () => {
  fixture.writeFile.mockClear();
  fixture.model = model();
  const sessionId = "approval-steer";
  const events: HarnessEvent[] = [];
  const onEvent = (event: HarnessEvent) => {
    events.push(event);
    if (event.type === "approval.requested") respondApiApproval(sessionId, event.requestId, "deny");
  };
  await sendApiTurn({ sessionId, cwd: ROOT, model: "fixture", runtimeMode: "supervised", text: "First", onEvent });
  fixture.model = model();
  await steerApiTurn({ sessionId, cwd: ROOT, model: "fixture", text: "Next" });
  expect(events.filter((event) => event.type === "approval.requested")).toHaveLength(2);
  expect(fixture.writeFile).not.toHaveBeenCalled();
  await forgetApiSession(sessionId);
});
