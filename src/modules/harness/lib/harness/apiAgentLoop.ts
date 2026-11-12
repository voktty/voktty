import { stepCountIs, streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { MAX_AGENT_STEPS } from "@/modules/ai/config";
import { fileToolApprovalTransform } from "@/modules/ai/lib/fileToolApprovals";
import { t } from "@/modules/i18n";
import type { HarnessEvent } from "./types";
import type { ToolPreview } from "../session";

export type ApiApproval = { approvalId: string; callId: string; title: string; requestId: number; preview?: ToolPreview };
let nextRequestId = 0;

function approvalPreview(name: string, input: unknown): ToolPreview | undefined {
  if (!input || typeof input !== "object") return undefined;
  const fields = input as Record<string, unknown>;
  const path = typeof fields.path === "string" ? fields.path : undefined;
  if (name === "bash_run" && typeof fields.command === "string") {
    if (fields.command.length > 16_384) throw new Error("The command is too long to review.");
    return { kind: "shell", output: fields.command };
  }
  if (!path) return undefined;
  const edits = name === "edit" ? [fields] : Array.isArray(fields.edits) ? fields.edits : [];
  if (edits.length) {
    const lines: NonNullable<ToolPreview["lines"]> = [];
    let truncated = edits.length > 15;
    for (const edit of edits.slice(0, 15)) {
      if (!edit || typeof edit !== "object") continue;
      const change = edit as Record<string, unknown>;
      if (change.replace_all === true) lines.push({ kind: "context", text: "Replace all matches" });
      for (const [key, kind] of [["old_string", "del"], ["new_string", "add"]] as const) {
        const value = change[key];
        if (typeof value !== "string") continue;
        const parts = value.slice(0, 6001).split("\n");
        for (const text of parts) {
          if (lines.length >= 30) { truncated = true; break; }
          if (text.length > 200) truncated = true;
          lines.push({ kind, text: text.slice(0, 200) });
        }
        if (value.length > 6000) truncated = true;
      }
    }
    if (truncated) lines.push({ kind: "context", text: "[Preview truncated]" });
    return { kind: "write", path, lines };
  }
  const content = typeof fields.content === "string" ? fields.content : typeof fields.new_string === "string" ? fields.new_string : undefined;
  if (content === undefined) return { kind: "write", path };
  const source = content.slice(0, 6001).split("\n");
  const lines: NonNullable<ToolPreview["lines"]> = source.slice(0, 30).map((text) => ({ kind: "add", text: text.slice(0, 200) }));
  if (content.length > 6000 || source.length > 30 || source.some((line) => line.length > 200)) lines.push({ kind: "context", text: "[Preview truncated]" });
  return { kind: "write", path, contentOnly: true, lines };
}

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
  showApprovals?: boolean;
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
          requests.push({ approvalId: part.approvalId, callId: part.toolCall.toolCallId, title: part.toolCall.toolName, requestId: ++nextRequestId, preview: approvalPreview(part.toolCall.toolName, part.toolCall.input) });
          break;
        case "tool-result":
          if (resumedCalls.has(part.toolCallId)) {
            resumedResults.push({ type: "tool-result", toolCallId: part.toolCallId, toolName: part.toolName, output: { type: "json", value: JSON.parse(JSON.stringify(part.output ?? null)) } });
          }
          {
            const failed = typeof part.output === "object" && part.output !== null && "error" in part.output;
            input.onEvent({ type: "tool.updated", callId: part.toolCallId, status: failed ? "failed" : "completed", detail: t(failed ? "harness.apiToolFailed" : "harness.apiToolCompleted") });
          }
          break;
        case "tool-error":
          if (resumedCalls.has(part.toolCallId)) resumedResults.push({ type: "tool-result", toolCallId: part.toolCallId, toolName: part.toolName, output: { type: "error-text", value: "Tool execution failed." } });
          input.onEvent({ type: "tool.updated", callId: part.toolCallId, status: "failed", detail: t("harness.apiToolFailed") });
          break;
        case "tool-output-denied":
          if (resumedCalls.has(part.toolCallId)) resumedResults.push({ type: "tool-result", toolCallId: part.toolCallId, toolName: part.toolName, output: { type: "execution-denied" } });
          input.onEvent({ type: "tool.updated", callId: part.toolCallId, status: "failed", detail: t("harness.apiToolDenied") });
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
      if (input.showApprovals !== false) input.onEvent({ type: "approval.requested", requestId: request.requestId, callId: request.callId, title: request.title, kind: request.title, preview: request.preview });
      const approved = await awaitApproval(pending, input.signal);
      if (input.showApprovals !== false) input.onEvent({ type: "approval.resolved", requestId: request.requestId, decision: input.signal.aborted ? "cancelled" : approved ? "allow" : "deny" });
      if (input.signal.aborted) return [];
      approvals.push({ type: "tool-approval-response", approvalId: request.approvalId, approved });
    }
    const approvalMessage: ModelMessage = { role: "tool", content: approvals };
    resumedCalls = new Set(requests.map((request) => request.callId));
    messages.push(approvalMessage);
    response.push(approvalMessage);
  }
  return response;
}
