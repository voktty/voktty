import { stepCountIs, streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { MAX_AGENT_STEPS } from "@/modules/ai/config";
import type { HarnessEvent } from "./types";

export async function runApiAgentLoop(input: {
  model: LanguageModel;
  messages: ModelMessage[];
  tools?: ToolSet;
  signal: AbortSignal;
  onEvent: (event: HarnessEvent) => void;
}): Promise<ModelMessage[]> {
  const result = streamText({
    model: input.model,
    messages: input.messages,
    tools: input.tools,
    abortSignal: input.signal,
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
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
      case "tool-result":
        input.onEvent({ type: "tool.updated", callId: part.toolCallId, status: "completed" });
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
  return (await result.steps).flatMap((step) => step.response.messages);
}
