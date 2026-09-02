import { buildOutgoingHandoffPrompt } from "./handoff";
import {
  cancelHarnessTurn,
  respondHarnessApproval,
  sendHarnessTurn,
} from "./harness/registry";
import { mergeStream } from "./harness/streamText";
import type { HarnessId } from "./session";

const HANDOFF_TIMEOUT_MS = 45_000;

export async function requestOutgoingHandoff(input: {
  harness: HarnessId;
  sessionId: string;
  cwd: string;
  model: string;
  modelSettings?: Record<string, string>;
  userRequest: string;
  timeoutMs?: number;
}): Promise<string> {
  let brief = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const turn = sendHarnessTurn({
      harness: input.harness,
      sessionId: input.sessionId,
      cwd: input.cwd,
      model: input.model,
      modelSettings: input.modelSettings,
      runtimeMode: "supervised",
      text: buildOutgoingHandoffPrompt(input.userRequest),
      onEvent: (event) => {
        if (event.type === "message.delta") {
          brief = mergeStream(brief, event.text);
        }
        if (event.type === "approval.requested") {
          respondHarnessApproval(
            input.harness,
            input.sessionId,
            event.requestId,
            "deny",
          );
        }
      },
    });
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        void cancelHarnessTurn(input.harness, input.sessionId);
        reject(new Error("Outgoing handoff timed out"));
      }, input.timeoutMs ?? HANDOFF_TIMEOUT_MS);
    });
    await Promise.race([turn, timeout]);
  } catch {
    // Caller falls back to the deterministic packet.
  } finally {
    if (timer) clearTimeout(timer);
  }
  return brief.trim();
}
