import type { UIMessage } from "ai";
import type { ToolContext } from "@/modules/ai/tools/context";
import {
  fileToolCallsFor,
  type FileToolName,
} from "@/modules/ai/lib/fileToolCalls";

const contexts = new WeakMap<object, ToolContext>();

export function registerChatFileTools(
  chat: object,
  context: ToolContext,
): void {
  contexts.set(chat, context);
}

export function previewChatFileTool(
  chat: object,
  id: string,
  tool: FileToolName,
  input: unknown,
  approvalId: string,
) {
  const context = contexts.get(chat);
  if (!context)
    throw new Error("The original file tool capture is unavailable.");
  return fileToolCallsFor(context).observe(id, tool, input, approvalId);
}

export function retireChatFileTools(chat: object): void {
  const context = contexts.get(chat);
  if (context) fileToolCallsFor(context).retireAll();
}

export function forgetChatFileTools(chat: object): void {
  retireChatFileTools(chat);
  contexts.delete(chat);
}

export function reconcileChatFileTools(
  chat: object,
  messages: readonly UIMessage[],
): void {
  const context = contexts.get(chat);
  if (context) reconcileFileToolCalls(context, messages);
}

export function reconcileFileToolCalls(
  context: ToolContext,
  messages: readonly UIMessage[],
): void {
  const calls = fileToolCallsFor(context);
  for (const message of messages) {
    for (const part of message.parts) {
      if (!("toolCallId" in part)) continue;
      if (
        part.state === "output-available" ||
        part.state === "output-error" ||
        part.state === "output-denied" ||
        (part.state === "approval-responded" && !part.approval.approved)
      ) {
        if (part.approval)
          calls.retireApproval(part.toolCallId, part.approval.id);
      }
    }
  }
}
