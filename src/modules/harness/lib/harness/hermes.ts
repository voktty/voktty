import { nativeModelId } from "../models";
import type { Attachment } from "../session";
import {
  killChild,
  resolveHermesBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "./child";
import type {
  ApprovalDecision,
  HarnessEvent,
  SendTurnInput,
  SteerTurnInput,
} from "./types";

/**
 * Lightweight local-CLI mode for Hermes Agent: detect and spawn a `hermes`
 * binary one-shot per turn, same as the other CLI agents. This is not the
 * full Hermes Gateway integration (HTTP API, persistent session continuity)
 * proposed separately in PLAN_PROVIDER_HERMES_GATEWAY.md - the CLI's wire
 * format is not publicly documented, so output is decoded with a best-effort
 * plain-text line parser (reasoning inside `<think>` tags, everything else as
 * assistant text) rather than a structured tool-call protocol.
 */
type Live = {
  onEvent: (event: HarnessEvent) => void;
  cancelled: boolean;
  thinking: boolean;
};

const liveBySession = new Map<string, Live>();

function feedHermesLine(live: Live, rawLine: string): void {
  const line = rawLine.trim();
  if (!line) return;

  const lower = line.toLowerCase();
  if (lower.includes("<think>") || lower.includes("<reasoning>")) {
    live.thinking = true;
    const rest = line.replace(/<\/?(think|reasoning)>/gi, "").trim();
    if (rest) live.onEvent({ type: "reasoning.delta", text: `${rest}\n` });
    return;
  }
  if (lower.includes("</think>") || lower.includes("</reasoning>")) {
    const rest = line.replace(/<\/?(think|reasoning)>/gi, "").trim();
    if (rest) live.onEvent({ type: "reasoning.delta", text: `${rest}\n` });
    live.thinking = false;
    live.onEvent({ type: "reasoning.completed" });
    return;
  }

  if (live.thinking) {
    live.onEvent({ type: "reasoning.delta", text: `${line}\n` });
  } else {
    live.onEvent({ type: "message.delta", text: `${line}\n` });
  }
}

let resolveHermesBinaryImpl: () => Promise<{ path: string }> =
  resolveHermesBinary;

/** Test seam. */
export function setHermesBinaryResolver(
  fn: () => Promise<{ path: string }>,
): void {
  resolveHermesBinaryImpl = fn;
}

export async function sendHermesTurn(input: SendTurnInput): Promise<void> {
  if (liveBySession.has(input.sessionId)) {
    await stopHermesSession(input.sessionId);
  }

  const { path } = await resolveHermesBinaryImpl();
  const live: Live = {
    onEvent: input.onEvent,
    cancelled: false,
    thinking: false,
  };
  liveBySession.set(input.sessionId, live);

  watchChild(
    input.sessionId,
    (line) => {
      if (!live.cancelled) feedHermesLine(live, line);
    },
    (code) => {
      if (liveBySession.get(input.sessionId) !== live) return;
      liveBySession.delete(input.sessionId);
      unwatchChild(input.sessionId);
      if (!live.cancelled) {
        live.onEvent({ type: "message.completed" });
        live.onEvent({ type: "session.ended", code: code ?? 0 });
      }
    },
    (line) => {
      const trimmed = line.trim();
      if (trimmed.toLowerCase().includes("error")) {
        live.onEvent({ type: "session.error", message: trimmed });
      }
    },
  );

  live.onEvent({ type: "session.started" });
  try {
    await spawnChild(
      input.sessionId,
      path,
      buildHermesSpawnArgs(input),
      input.cwd,
    );
  } catch (error) {
    liveBySession.delete(input.sessionId);
    unwatchChild(input.sessionId);
    throw error;
  }
}

export async function steerHermesTurn(_input: SteerTurnInput): Promise<void> {
  throw new Error("Hermes Agent does not support steering an in-flight turn");
}

export function respondHermesApproval(
  _sessionId: string,
  _requestId: number,
  _decision: ApprovalDecision,
): void {}

export async function cancelHermesTurn(sessionId: string): Promise<void> {
  await stopHermesSession(sessionId);
}

export async function stopHermesSession(sessionId: string): Promise<void> {
  const live = liveBySession.get(sessionId);
  liveBySession.delete(sessionId);
  if (live) live.cancelled = true;
  unwatchChild(sessionId);
  await killChild(sessionId).catch(() => undefined);
}

export async function forgetHermesSession(sessionId: string): Promise<void> {
  await stopHermesSession(sessionId);
}

/** The Hermes CLI has no known resumable session id; every turn is a fresh
 * one-shot invocation, so there is nothing to seed from a restored session. */
export function bindHermesSession(): void {}

export function buildHermesSpawnArgs(
  input: Pick<SendTurnInput, "text" | "model" | "attachments">,
): string[] {
  const args = ["run", "-p", hermesPrompt(input.text, input.attachments ?? [])];
  const model = nativeModelId(input.model);
  if (model) args.push("--model", model);
  return args;
}

function hermesPrompt(text: string, attachments: Attachment[]): string {
  const paths = attachments
    .map((attachment) => attachment.path?.trim())
    .filter((path): path is string => Boolean(path));
  if (paths.length === 0) return text;
  const files = paths.map((path) => `- ${path}`).join("\n");
  return `${text.trim()}\n\nAttached files:\n${files}`.trim();
}

/** Exported for tests. */
export function __hermesTestReset(): void {
  liveBySession.clear();
  resolveHermesBinaryImpl = resolveHermesBinary;
}
