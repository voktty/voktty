import { harnessClient } from "../../harnessClient";
import type { HarnessEvent as RootHarnessEvent, ReasoningEffort } from "../../types";
import { AgyProtocolRunner } from "../../protocols/agyProtocol";
import { refreshAgyCatalog } from "./agyCatalog";
import { registerHarness, type HarnessAdapter } from "./registry";
import type { SendTurnInput, SteerTurnInput } from "./types";

const runners = new Map<string, AgyProtocolRunner>();

function resolveReasoningEffort(
  settings?: Record<string, string>,
): ReasoningEffort | undefined {
  const v = settings?.effort;
  if (v === "high" || v === "medium" || v === "low" || v === "max" || v === "off") return v;
  return undefined;
}

async function runAgyTurn(
  sessionId: string,
  cwd: string,
  model: string,
  text: string,
  runtimeMode: "plan" | "act" | "review",
  reasoningEffort: ReasoningEffort | undefined,
  onEvent: (event: RootHarnessEvent) => void,
): Promise<void> {
  const runner = new AgyProtocolRunner(sessionId, onEvent);
  runners.set(sessionId, runner);

  const unlistenStdout = await harnessClient.onStdout((payload) => {
    if (payload.sessionId === sessionId) runner.handleStdoutLine(payload.line);
  });
  const unlistenStderr = await harnessClient.onStderr((payload) => {
    if (payload.sessionId === sessionId) runner.handleStderrLine(payload.line);
  });
  const unlistenExit = await harnessClient.onExit((payload) => {
    if (payload.sessionId === sessionId) {
      runner.handleExit(payload.code);
      unlistenStdout();
      unlistenStderr();
      unlistenExit();
      runners.delete(sessionId);
    }
  });

  await runner.run({ sessionId, cwd, model, text, runtimeMode, reasoningEffort, onEvent });
}

export async function sendAgyTurn(input: SendTurnInput): Promise<void> {
  return runAgyTurn(
    input.sessionId,
    input.cwd,
    input.model,
    input.text,
    input.runtimeMode as "plan" | "act" | "review",
    resolveReasoningEffort(input.modelSettings),
    input.onEvent as unknown as (event: RootHarnessEvent) => void,
  );
}

export async function steerAgyTurn(input: SteerTurnInput): Promise<void> {
  return runAgyTurn(
    input.sessionId,
    input.cwd,
    input.model,
    input.text,
    "act",
    resolveReasoningEffort(input.modelSettings),
    () => {},
  );
}

async function cancelAgyTurn(sessionId: string): Promise<void> {
  await harnessClient.kill(sessionId);
  runners.delete(sessionId);
}

export const agyAdapter: HarnessAdapter = {
  id: "gemini",
  live: true,
  sendTurn: sendAgyTurn,
  steerTurn: steerAgyTurn,
  cancelTurn: cancelAgyTurn,
  respondApproval: () => {},
  stopSession: cancelAgyTurn,
  forgetSession: cancelAgyTurn,
  bindSession: () => {},
  refreshCatalog: refreshAgyCatalog,
};

let registered = false;

export function ensureGeminiRegistered(): void {
  if (registered) return;
  registerHarness(agyAdapter);
  registered = true;
}
