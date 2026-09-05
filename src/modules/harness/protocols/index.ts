import {
  harnessClient,
  type HarnessExitPayload,
  type HarnessStderrPayload,
  type HarnessStdoutPayload,
} from "../harnessClient";
import type { HarnessAgentId, SendTurnParams } from "../types";
import { AgyProtocolRunner } from "./agyProtocol";
import { ClaudeProtocolRunner } from "./claudeProtocol";
import { CodexProtocolRunner } from "./codexProtocol";
import { CursorProtocolRunner } from "./cursorProtocol";
import { GenericProtocolRunner } from "./genericProtocol";
import { HermesProtocolRunner } from "./hermesProtocol";
import { UniversalStreamParser } from "./universalStreamParser";

export {
  AgyProtocolRunner,
  ClaudeProtocolRunner,
  CodexProtocolRunner,
  CursorProtocolRunner,
  GenericProtocolRunner,
  HermesProtocolRunner,
  UniversalStreamParser,
};

type ActiveRunner = {
  sessionId: string;
  harness: HarnessAgentId;
  runner: any;
  cleanup: () => void;
};

const activeRunners = new Map<string, ActiveRunner>();

export async function sendAgentTurn(
  params: SendTurnParams & { harness: HarnessAgentId },
): Promise<void> {
  const { sessionId, harness, onEvent } = params;

  // Cleanup existing runner if any
  if (activeRunners.has(sessionId)) {
    await cancelAgentTurn(sessionId);
  }

  let runner: any;
  switch (harness) {
    case "antigravity":
      runner = new AgyProtocolRunner(sessionId, onEvent);
      break;
    case "claude":
      runner = new ClaudeProtocolRunner(sessionId, onEvent);
      break;
    case "codex":
      runner = new CodexProtocolRunner(sessionId, onEvent);
      break;
    case "cursor":
      runner = new CursorProtocolRunner(sessionId, onEvent);
      break;
    case "hermes":
      runner = new HermesProtocolRunner(sessionId, onEvent);
      break;
    case "gemini":
      runner = new GenericProtocolRunner(sessionId, "gemini", onEvent);
      break;
    case "opencode":
    case "grok":
    case "pi":
      runner = new GenericProtocolRunner(sessionId, harness, onEvent);
      break;
    default:
      runner = new GenericProtocolRunner(sessionId, String(harness), onEvent);
      break;
  }

  const unlistenStdout = await harnessClient.onStdout((payload: HarnessStdoutPayload) => {
    if (payload.sessionId === sessionId) {
      runner.handleStdoutLine(payload.line);
    }
  });

  const unlistenStderr = await harnessClient.onStderr((payload: HarnessStderrPayload) => {
    if (payload.sessionId === sessionId) {
      runner.handleStderrLine(payload.line);
    }
  });

  const unlistenExit = await harnessClient.onExit((payload: HarnessExitPayload) => {
    if (payload.sessionId === sessionId) {
      runner.handleExit(payload.code);
      const active = activeRunners.get(sessionId);
      if (active) {
        active.cleanup();
        activeRunners.delete(sessionId);
      }
    }
  });

  const cleanup = () => {
    unlistenStdout();
    unlistenStderr();
    unlistenExit();
  };

  activeRunners.set(sessionId, {
    sessionId,
    harness,
    runner,
    cleanup,
  });

  await runner.run(params);
}

export async function cancelAgentTurn(sessionId: string): Promise<boolean> {
  const active = activeRunners.get(sessionId);
  if (active) {
    active.cleanup();
    activeRunners.delete(sessionId);
  }
  return harnessClient.kill(sessionId);
}

export async function respondAgentApproval(
  sessionId: string,
  decision: "allow" | "deny",
): Promise<void> {
  const input = decision === "allow" ? "y\n" : "n\n";
  await harnessClient.stdin(sessionId, input);
}
