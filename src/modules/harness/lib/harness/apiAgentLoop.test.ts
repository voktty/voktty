import { MockLanguageModelV4 } from "ai/test";
import { tool } from "ai";
import { z } from "zod";
import { expect, it, vi } from "vitest";
import { runApiAgentLoop } from "./apiAgentLoop";
import type { HarnessEvent } from "./types";

it("streams tool calls and retains their results in the response history", async () => {
  let step = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          if (step++ === 0) {
            controller.enqueue({ type: "tool-input-start", id: "call-1", toolName: "lookup" });
            controller.enqueue({ type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: "{}" });
          } else {
            controller.enqueue({ type: "text-start", id: "text-1" });
            controller.enqueue({ type: "text-delta", id: "text-1", delta: "Done" });
            controller.enqueue({ type: "text-end", id: "text-1" });
          }
          controller.enqueue({
            type: "finish",
            usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
            finishReason: { unified: step === 1 ? "tool-calls" : "stop", raw: undefined },
          });
          controller.close();
        },
      }),
    }),
  });
  const events: HarnessEvent[] = [];
  const execute = vi.fn(async () => "result");
  const messages = await runApiAgentLoop({
    model,
    messages: [{ role: "user", content: "Look up" }],
    tools: { lookup: tool({ inputSchema: z.object({}), execute }) },
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  });
  expect(execute).toHaveBeenCalledOnce();
  expect(events).toContainEqual(expect.objectContaining({ type: "tool.started", callId: "call-1" }));
  expect(events).toContainEqual(expect.objectContaining({ type: "tool.updated", callId: "call-1", status: "completed" }));
  expect(events).toContainEqual({ type: "message.delta", text: "Done" });
  expect(messages.some((message) => message.role === "tool")).toBe(true);
});

it.each([true, false])("resumes a tool approval with decision %s", async (approved) => {
  let step = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          if (step++ === 0) {
            controller.enqueue({ type: "tool-input-start", id: "write-1", toolName: "write" });
            controller.enqueue({ type: "tool-call", toolCallId: "write-1", toolName: "write", input: "{}" });
          }
          controller.enqueue({ type: "finish", usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 0, reasoning: 0 } }, finishReason: { unified: step === 1 ? "tool-calls" : "stop", raw: undefined } });
          controller.close();
        },
      }),
    }),
  });
  const execute = vi.fn(async () => "written");
  const onApproval = vi.fn(async () => approved);
  const events: HarnessEvent[] = [];
  const messages = await runApiAgentLoop({
    model,
    messages: [{ role: "user", content: "Write" }],
    tools: { write: tool({ inputSchema: z.object({}), needsApproval: true, execute }) },
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    onApproval,
  });
  expect(onApproval).toHaveBeenCalledOnce();
  expect(events).toContainEqual(expect.objectContaining({ type: "approval.requested", callId: "write-1" }));
  expect(events).toContainEqual(expect.objectContaining({ type: "approval.resolved", decision: approved ? "allow" : "deny" }));
  expect(execute).toHaveBeenCalledTimes(approved ? 1 : 0);
  expect(messages.some((message) => message.role === "tool" && message.content.some((part) => part.type === "tool-approval-response" && part.approved === approved))).toBe(true);
  expect(events).toContainEqual(expect.objectContaining({ type: "tool.updated", callId: "write-1", status: approved ? "completed" : "failed" }));
});

it("stops while an approval is pending without executing the tool", async () => {
  const model = new MockLanguageModelV4({
    doStream: { stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "tool-input-start", id: "write-1", toolName: "write" });
        controller.enqueue({ type: "tool-call", toolCallId: "write-1", toolName: "write", input: "{}" });
        controller.enqueue({ type: "finish", usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 0, reasoning: 0 } }, finishReason: { unified: "tool-calls", raw: undefined } });
        controller.close();
      },
    }) },
  });
  const controller = new AbortController();
  const execute = vi.fn(async () => "written");
  const onApproval = vi.fn(() => new Promise<boolean>(() => {}));
  const result = runApiAgentLoop({ model, messages: [{ role: "user", content: "Write" }], tools: { write: tool({ inputSchema: z.object({}), needsApproval: true, execute }) }, signal: controller.signal, onEvent: () => {}, onApproval });
  await vi.waitFor(() => expect(onApproval).toHaveBeenCalledOnce());
  controller.abort();
  expect(await result).toEqual([]);
  expect(execute).not.toHaveBeenCalled();
});
