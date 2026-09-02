import { harnessClient } from "../harnessClient";
import type { HarnessEvent, SendTurnParams } from "../types";

export class CursorProtocolRunner {
  private sessionId: string;
  private onEvent: (event: HarnessEvent) => void;

  constructor(sessionId: string, onEvent: (event: HarnessEvent) => void) {
    this.sessionId = sessionId;
    this.onEvent = onEvent;
  }

  async run(params: SendTurnParams): Promise<void> {
    this.onEvent({ type: "session.started" });
    this.onEvent({ type: "status", text: "Starting Cursor Agent..." });

    try {
      await harnessClient.initCheckpoint(this.sessionId, params.cwd);
    } catch {}

    const args = ["--json", params.text];

    try {
      await harnessClient.spawn(
        this.sessionId,
        params.cwd,
        "agent",
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
        const parsed = JSON.parse(trimmed);
        if (parsed.text) {
          this.onEvent({ type: "message.delta", text: parsed.text });
          return;
        }
      } catch {}
    }

    this.onEvent({ type: "message.delta", text: line + "\n" });
  }

  handleStderrLine(line: string): void {
    if (line.includes("error:")) {
      this.onEvent({ type: "session.error", message: line });
    }
  }

  handleExit(code: number | null | undefined): void {
    this.onEvent({ type: "message.completed" });
    this.onEvent({ type: "session.ended", code: code ?? 0 });
  }
}
