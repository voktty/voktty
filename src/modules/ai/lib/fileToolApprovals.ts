import type { ModelMessage, StreamTextTransform, ToolSet } from "ai";
import type { FileToolCalls } from "@/modules/ai/lib/fileToolCalls";

type Receipt = { retire: () => void; bindApproval: (id: string) => void };
const pending = new WeakMap<object, Map<string, Receipt>>();
const running = new WeakMap<object, Set<{ retire: () => void }>>();
const registries = new WeakMap<object, FileToolCalls>();
const retired = new WeakSet<object>();
let runGuards: WeakMap<object, () => boolean> | undefined;

export function isFileToolRunCurrent(tool: object): boolean {
  if (retired.has(tool)) return false;
  try {
    return runGuards?.get(tool)?.() !== false && !retired.has(tool);
  } catch {
    return false;
  }
}

export function bindFileToolRunGuard(
  tools: ToolSet,
  isCurrent: () => boolean,
): void {
  const captured = Object.values(tools).filter((tool) => registries.has(tool));
  for (const tool of captured) {
    const existing = runGuards?.get(tool);
    if (existing && existing !== isCurrent)
      throw new Error("The file tool run already has an owner.");
  }
  if (!captured.length) return;
  runGuards ??= new WeakMap();
  for (const tool of captured) runGuards.set(tool, isCurrent);
}

export function registerFileToolRegistry(
  tool: object,
  calls: FileToolCalls,
): void {
  registries.set(tool, calls);
}

export function registerFileToolReceipt(
  tool: object,
  id: string,
  receipt: Receipt,
) {
  let calls = pending.get(tool);
  if (!calls) {
    calls = new Map();
    pending.set(tool, calls);
  }
  calls.set(id, receipt);
  return () => {
    if (calls.get(id) === receipt) calls.delete(id);
  };
}

export function trackFileToolExecution(
  tool: object,
  execution: { retire: () => void },
) {
  let executions = running.get(tool);
  if (!executions) {
    executions = new Set();
    running.set(tool, executions);
  }
  executions.add(execution);
  return () => {
    executions.delete(execution);
  };
}

export function captureFileApproval(
  tools: ToolSet,
  request: {
    approvalId: string;
    toolCall: { toolName: string; toolCallId: string };
  },
): void {
  const tool = tools[request.toolCall.toolName];
  if (tool)
    pending
      .get(tool)
      ?.get(request.toolCall.toolCallId)
      ?.bindApproval(request.approvalId);
}

export function fileToolApprovalTransform<Tools extends ToolSet>(
  tools: Tools,
  messages: readonly ModelMessage[] = [],
): StreamTextTransform<Tools> {
  return () =>
    new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === "tool-approval-request")
          captureFileApproval(tools, chunk);
        if (chunk.type === "tool-approval-response" && !chunk.approved) {
          const tool = tools[chunk.toolCall.toolName];
          if (tool)
            registries
              .get(tool)
              ?.retireApproval(chunk.toolCall.toolCallId, chunk.approvalId);
        }
        if (chunk.type === "tool-output-denied") {
          const approvalId = fileToolResponseId(
            messages,
            chunk.toolCallId,
            false,
          );
          const tool = tools[chunk.toolName];
          if (tool && approvalId)
            registries.get(tool)?.retireApproval(chunk.toolCallId, approvalId);
        }
        controller.enqueue(chunk);
      },
    });
}

export function retireFileToolRun(tools: ToolSet): void {
  for (const tool of Object.values(tools)) retired.add(tool);
  for (const tool of Object.values(tools)) {
    for (const receipt of pending.get(tool)?.values() ?? []) receipt.retire();
    for (const execution of running.get(tool) ?? []) execution.retire();
  }
}

function fileToolResponseId(
  messages: readonly ModelMessage[],
  id: string,
  expected: boolean,
): string | null {
  let approvalId: string | undefined;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "tool-approval-request" && part.toolCallId === id) {
        if (approvalId !== undefined) return null;
        approvalId = part.approvalId;
      }
    }
  }
  let responses = 0;
  let approved = false;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        part.type === "tool-approval-response" &&
        part.approvalId === approvalId
      ) {
        responses++;
        approved = part.approved;
      }
    }
  }
  if (approvalId === undefined || responses !== 1 || approved !== expected)
    return null;
  return approvalId;
}

export function approvedFileToolId(
  messages: readonly ModelMessage[],
  id: string,
): string {
  const approvalId = fileToolResponseId(messages, id, true);
  if (!approvalId)
    throw new Error("The original file approval is missing or ambiguous.");
  return approvalId;
}
