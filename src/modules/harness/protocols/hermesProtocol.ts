import { harnessClient } from "../harnessClient";
import type { HarnessEvent, SendTurnParams } from "../types";
import { UniversalStreamParser } from "./universalStreamParser";

export class HermesProtocolRunner {
  private sessionId: string;
  private onEvent: (event: HarnessEvent) => void;
  private parser: UniversalStreamParser;

  constructor(sessionId: string, onEvent: (event: HarnessEvent) => void) {
    this.sessionId = sessionId;
    this.onEvent = onEvent;
    this.parser = new UniversalStreamParser(onEvent);
  }

  async run(params: SendTurnParams): Promise<void> {
    this.onEvent({ type: "session.started" });
    this.onEvent({ type: "status", text: "Launching Hermes Agent..." });

    try {
      await harnessClient.initCheckpoint(this.sessionId, params.cwd);
    } catch {}

    const args: string[] = ["run", "-p", params.text];
    if (params.model) {
      args.push("--model", params.model);
    }

    try {
      await harnessClient.spawn(
        this.sessionId,
        params.cwd,
        "hermes",
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
    this.parser.feedLine(line);
  }

  handleStderrLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().includes("error:")) {
      this.onEvent({ type: "session.error", message: trimmed });
    }
  }

  handleExit(code: number | null | undefined): void {
    this.onEvent({ type: "message.completed" });
    this.onEvent({ type: "session.ended", code: code ?? 0 });
  }
}
