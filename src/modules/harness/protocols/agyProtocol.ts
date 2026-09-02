import { harnessClient } from "../harnessClient";
import type { HarnessEvent, SendTurnParams } from "../types";

export type { SendTurnParams };

export class AgyProtocolRunner {
  private sessionId: string;
  private onEvent: (event: HarnessEvent) => void;

  constructor(sessionId: string, onEvent: (event: HarnessEvent) => void) {
    this.sessionId = sessionId;
    this.onEvent = onEvent;
  }

  async run(params: SendTurnParams): Promise<void> {
    this.onEvent({ type: "session.started" });
    this.onEvent({ type: "status", text: "Starting Antigravity agent..." });

    // Ensure checkpoint tracking is active for this turn
    try {
      await harnessClient.initCheckpoint(this.sessionId, params.cwd);
    } catch {
      // Non-fatal if checkpoint initialization fails
    }

    const args: string[] = [
      "-p",
      params.text,
      "--output-format",
      "stream-json",
    ];

    if (params.model) {
      args.push("--model", params.model);
    } else {
      args.push("--model", "gemini-3.7-flash-high");
    }

    if (params.reasoningEffort && params.reasoningEffort !== "off") {
      args.push("--effort", params.reasoningEffort);
    }

    if (params.runtimeMode === "plan") {
      args.push("--mode", "plan");
    } else {
      args.push("--dangerously-skip-permissions");
    }

    try {
      await harnessClient.spawn(
        this.sessionId,
        params.cwd,
        "agy",
        args,
      );
    } catch (err: any) {
      this.onEvent({
        type: "session.error",
        message: err?.message || String(err),
      });
      this.onEvent({ type: "session.ended", code: 1 });
    }
  }

  handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Try parsing as JSONL stream event
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);

        // Standard Antigravity CLI events:
        if (parsed.event === "init") {
          this.onEvent({ type: "status", text: "Antigravity active" });
          if (parsed.conversation_id) {
            this.onEvent({
              type: "session.providerBound",
              providerSessionId: parsed.conversation_id,
            });
          }
          return;
        }

        if (parsed.event === "step_update" && parsed.step_update) {
          const step = parsed.step_update;

          if (step.text_delta) {
            this.onEvent({
              type: "message.delta",
              text: step.text_delta,
            });
          }

          if (step.thought_delta || (step.step_type === "thought" && step.text_delta)) {
            this.onEvent({
              type: "reasoning.delta",
              text: step.thought_delta || step.text_delta || "",
            });
          }

          if (step.step_type === "tool_call" || step.tool_name) {
            const toolId = step.tool_id || `tool-${step.step_index || Date.now()}`;
            this.onEvent({
              type: "tool.started",
              callId: toolId,
              title: step.tool_name || "Executing tool",
              kind: detectToolKind(step.tool_name),
              preview: {
                kind: detectToolKind(step.tool_name),
                target: step.parameters?.TargetFile || step.parameters?.path,
                command: step.parameters?.CommandLine || step.parameters?.command,
              },
            });
          }

          if (step.usage) {
            this.onEvent({
              type: "context",
              used: step.usage.total_tokens || step.usage.input_tokens,
              window: 1_000_000,
            });
          }
          return;
        }

        if (parsed.event === "result" && parsed.result) {
          if (parsed.result.usage) {
            this.onEvent({
              type: "context",
              used: parsed.result.usage.total_tokens,
              window: 1_000_000,
            });
          }
          this.onEvent({ type: "message.completed" });
          this.onEvent({
            type: "session.ended",
            code: parsed.result.status === "SUCCESS" ? 0 : 1,
          });
          return;
        }

        // Generic fallback parsing:
        if (parsed.type === "message" || parsed.type === "text_delta") {
          this.onEvent({
            type: "message.delta",
            text: parsed.content || parsed.text || "",
          });
          return;
        }

        if (parsed.type === "tool_call" || parsed.type === "tool_use") {
          this.onEvent({
            type: "tool.started",
            callId: parsed.id || `tool-${Date.now()}`,
            title: parsed.name || "Tool execution",
            kind: detectToolKind(parsed.name),
            preview: {
              kind: detectToolKind(parsed.name),
              target: parsed.parameters?.TargetFile || parsed.parameters?.path,
              command: parsed.parameters?.CommandLine || parsed.parameters?.command,
            },
          });
          return;
        }

        if (parsed.type === "tool_result") {
          this.onEvent({
            type: "tool.updated",
            callId: parsed.id || "",
            status: parsed.status === "error" ? "failed" : "completed",
            detail: parsed.output || parsed.result,
          });
          return;
        }
      } catch {
        // Fallback to text line
      }
    }

    // Fallback: emit plain text delta
    this.onEvent({ type: "message.delta", text: line + "\n" });
  }

  handleStderrLine(line: string): void {
    if (line.includes("error") || line.includes("FATAL")) {
      this.onEvent({ type: "session.error", message: line });
    }
  }

  handleExit(code: number | null | undefined): void {
    this.onEvent({ type: "message.completed" });
    this.onEvent({ type: "session.ended", code: code ?? 0 });
  }
}

function detectToolKind(
  name?: string,
): "command" | "read" | "write" | "search" | "patch" | "other" {
  if (!name) return "other";
  const lower = name.toLowerCase();
  if (lower.includes("command") || lower.includes("bash") || lower.includes("exec")) {
    return "command";
  }
  if (lower.includes("view") || lower.includes("read")) {
    return "read";
  }
  if (lower.includes("write") || lower.includes("create")) {
    return "write";
  }
  if (lower.includes("replace") || lower.includes("edit") || lower.includes("patch")) {
    return "patch";
  }
  if (lower.includes("search") || lower.includes("grep") || lower.includes("find")) {
    return "search";
  }
  return "other";
}
