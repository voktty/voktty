import { stepCountIs, streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { MAX_AGENT_STEPS } from "@/modules/ai/config";
import { fileToolApprovalTransform } from "@/modules/ai/lib/fileToolApprovals";
import type { HarnessEvent } from "./types";

export type ApiApproval = { approvalId: string; callId: string; title: string; requestId: number };
let nextRequestId = 0;

async function awaitApproval(request: Promise<boolean>, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); resolve(false); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    request.then((decision) => { cleanup(); resolve(decision); }, (error) => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}

export async function runApiAgentLoop(input: {
  model: LanguageModel;
  messages: ModelMessage[];
  tools?: ToolSet;
  system?: string;
  signal: AbortSignal;
  onEvent: (event: HarnessEvent) => void;
  onApproval?: (request: ApiApproval) => Promise<boolean>;
}): Promise<ModelMessage[]> {
  const tools = input.tools ?? {};
  const messages = [...input.messages];
  const response: ModelMessage[] = [];
  let remaining = MAX_AGENT_STEPS;
  let resumedCalls = new Set<string>();
  while (remaining > 0 && !input.signal.aborted) {
    const requests: ApiApproval[] = [];
    const resumedResults: Extract<ModelMessage, { role: "tool" }>["content"] = [];
    const result = streamText({
      model: input.model,
      system: input.system,
      messages,
      tools,
      abortSignal: input.signal,
      stopWhen: stepCountIs(remaining),
      experimental_transform: fileToolApprovalTransform(tools, messages),
    });
    for await (const part of result.fullStream) {
      if (input.signal.aborted) break;
      switch (part.type) {
        case "text-delta":
          input.onEvent({ type: "message.delta", text: part.text });
          break;
        case "reasoning-delta":
          input.onEvent({ type: "reasoning.delta", text: part.text });
          break;
        case "tool-call":
          input.onEvent({ type: "tool.started", callId: part.toolCallId, title: part.toolName, kind: part.toolName, status: "running" });
          break;
        case "tool-approval-request":
          requests.push({ approvalId: part.approvalId, callId: part.toolCall.toolCallId, title: part.toolCall.toolName, requestId: ++nextRequestId });
          break;
        case "tool-result":
          if (resumedCalls.has(part.toolCallId)) {
            resumedResults.push({ type: "tool-result", toolCallId: part.toolCallId, toolName: part.toolName, output: { type: "json", value: JSON.parse(JSON.stringify(part.output ?? null)) } });
          }
          input.onEvent({ type: "tool.updated", callId: part.toolCallId, status: typeof part.output === "object" && part.output !== null && "error" in part.output ? "failed" : "completed" });
          break;
        case "tool-error":
        case "tool-output-denied":
          input.onEvent({ type: "tool.updated", callId: part.toolCallId, status: "failed" });
          break;
        case "error":
          throw part.error;
      }
    }
    if (input.signal.aborted) return [];
    const steps = await result.steps;
    remaining -= Math.max(1, steps.length);
    if (resumedResults.length) {
      const results: ModelMessage = { role: "tool", content: resumedResults };
      response.push(results);
      messages.push(results);
    }
    const next = steps.flatMap((step) => step.response.messages);
    response.push(...next);
    messages.push(...next);
    if (!requests.length) break;
    if (remaining <= 0) throw new Error("The API agent reached its step limit while awaiting approval.");
    if (!input.onApproval) throw new Error("Tool approval handler is unavailable.");
    const approvals: Array<{ type: "tool-approval-response"; approvalId: string; approved: boolean }> = [];
    for (const request of requests) {
      const pending = input.onApproval(request);
      input.onEvent({ type: "approval.requested", requestId: request.requestId, callId: request.callId, title: request.title, kind: request.title });
      const approved = await awaitApproval(pending, input.signal);
      input.onEvent({ type: "approval.resolved", requestId: request.requestId, decision: input.signal.aborted ? "cancelled" : approved ? "allow" : "deny" });
      if (input.signal.aborted) return [];
      approvals.push({ type: "tool-approval-response", approvalId: request.approvalId, approved });
    }
    const approvalMessage: ModelMessage = { role: "tool", content: approvals };
    resumedCalls = new Set(requests.filter((_, index) => approvals[index].approved).map((request) => request.callId));
    messages.push(approvalMessage);
    response.push(approvalMessage);
  }
  return response;
}
