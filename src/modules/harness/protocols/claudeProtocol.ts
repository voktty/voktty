import { harnessClient } from "../harnessClient";
import type { HarnessEvent, SendTurnParams } from "../types";

export class ClaudeProtocolRunner {
  private sessionId: string;
  private onEvent: (event: HarnessEvent) => void;

  constructor(sessionId: string, onEvent: (event: HarnessEvent) => void) {
    this.sessionId = sessionId;
    this.onEvent = onEvent;
  }

  async run(params: SendTurnParams): Promise<void> {
    this.onEvent({ type: "session.started" });
    this.onEvent({ type: "status", text: "Launching Claude Code..." });

    try {
      await harnessClient.initCheckpoint(this.sessionId, params.cwd);
    } catch {}

    const args = ["--output-format=stream-json"];
    if (params.model) {
      args.push("--model", params.model);
    }
    args.push("-p", params.text);

    try {
      await harnessClient.spawn(
        this.sessionId,
        params.cwd,
        "claude",
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

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const msg = JSON.parse(trimmed);

        if (msg.type === "assistant_response" || msg.type === "content_block_delta") {
          const text = msg.delta?.text || msg.text || msg.content || "";
          if (text) {
            this.onEvent({ type: "message.delta", text });
          }
          return;
        }

        if (msg.type === "tool_use" || msg.type === "tool_call") {
          this.onEvent({
            type: "tool.started",
            callId: msg.id || `claude-tool-${Date.now()}`,
            title: `${msg.name || "Tool"} (${msg.input?.path || msg.input?.command || ""})`,
            kind: msg.name?.includes("Bash") ? "command" : "write",
            preview: {
              kind: msg.name?.includes("Bash") ? "command" : "write",
              target: msg.input?.path || msg.input?.file_path,
              command: msg.input?.command,
            },
          });
          return;
        }

        if (msg.type === "tool_result") {
          this.onEvent({
            type: "tool.updated",
            callId: msg.tool_use_id || "",
            status: msg.is_error ? "failed" : "completed",
            detail: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          });
          return;
        }

        if (msg.type === "permission_request") {
          this.onEvent({
            type: "approval.requested",
            requestId: msg.request_id || Date.now(),
            title: `Approve: ${msg.tool || "Command execution"}`,
            callId: msg.tool_use_id,
          });
          return;
        }

        if (msg.type === "usage" || msg.usage) {
          const u = msg.usage || msg;
          this.onEvent({
            type: "context",
            used: (u.input_tokens || 0) + (u.output_tokens || 0),
            window: 200_000,
          });
          return;
        }
      } catch {}
    }

    this.onEvent({ type: "message.delta", text: line + "\n" });
  }

  handleStderrLine(line: string): void {
    if (line.includes("Error:") || line.includes("error:")) {
      this.onEvent({ type: "session.error", message: line });
    }
  }

  handleExit(code: number | null | undefined): void {
    this.onEvent({ type: "message.completed" });
    this.onEvent({ type: "session.ended", code: code ?? 0 });
  }
}
