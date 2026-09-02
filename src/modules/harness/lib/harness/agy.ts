import { nativeModelId } from "../models";
import type { Attachment, RuntimeMode, ToolPreview } from "../session";
import {
  killChild,
  resolveGeminiBinary,
  spawnChild,
  unwatchChild,
  watchChild,
  writeChild,
} from "./child";
import { snapshotRemainder } from "./streamText";
import type {
  ApprovalDecision,
  HarnessEvent,
  SendTurnInput,
  SteerTurnInput,
} from "./types";

type Resume = {
  conversationId: string;
  cwd: string;
};

type Live = {
  cwd: string;
  settingsKey: string;
  conversationId?: string;
  onEvent: (event: HarnessEvent) => void;
  cancelled: boolean;
  muteUpdates: boolean;
  turns: Promise<void>;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  turnEndPending: boolean;
  emittedAssistant: string;
};

const liveBySession = new Map<string, Live>();
const resumeBySession = new Map<string, Resume>();
const cancelledSessions = new Set<string>();

let resolveAgyBinaryImpl: () => Promise<{ path: string }> = resolveGeminiBinary;

/** Test seam. */
export function setAgyBinaryResolver(
  fn: () => Promise<{ path: string }>,
): void {
  resolveAgyBinaryImpl = fn;
}

export async function sendAgyTurn(input: SendTurnInput): Promise<void> {
  let live: Live;
  try {
    live = await ensureLive(input);
  } catch (error) {
    cancelledSessions.delete(input.sessionId);
    throw error;
  }
  if (cancelledSessions.delete(input.sessionId)) return;

  live.onEvent = input.onEvent;
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      live.cancelled = false;
      live.muteUpdates = false;
      await runTurn(input.sessionId, live, input);
    });

  try {
    await live.turns;
  } catch (error) {
    if (live.cancelled) return;
    if (liveBySession.get(input.sessionId) === live) {
      await stopAgySession(input.sessionId);
    }
    throw error;
  }
}

export async function steerAgyTurn(_input: SteerTurnInput): Promise<void> {
  throw new Error("Antigravity does not support steering an in-flight turn");
}

export function respondAgyApproval(
  _sessionId: string,
  _requestId: number,
  _decision: ApprovalDecision,
): void {}

export async function cancelAgyTurn(sessionId: string): Promise<void> {
  const live = liveBySession.get(sessionId);
  if (!live) {
    cancelledSessions.add(sessionId);
    return;
  }
  live.cancelled = true;
  live.muteUpdates = true;
  finishTurn(live);
  await stopAgySession(sessionId);
}

export async function stopAgySession(sessionId: string): Promise<void> {
  cancelledSessions.delete(sessionId);
  const live = liveBySession.get(sessionId);
  liveBySession.delete(sessionId);
  if (live) {
    live.muteUpdates = true;
    live.turnDone?.();
    live.turnDone = null;
    live.turnFailed = null;
  }
  unwatchChild(sessionId);
  await killChild(sessionId).catch(() => undefined);
}

export async function forgetAgySession(sessionId: string): Promise<void> {
  resumeBySession.delete(sessionId);
  await stopAgySession(sessionId);
}

export function bindAgySession(
  threadId: string,
  providerSessionId: string,
  cwd: string,
): void {
  const conversationId = providerSessionId.trim();
  if (!threadId || !conversationId || !cwd.trim()) return;
  resumeBySession.set(threadId, { conversationId, cwd });
}

async function ensureLive(input: SendTurnInput): Promise<Live> {
  const settingsKey = agySettingsKey(input);
  const existing = liveBySession.get(input.sessionId);
  if (
    existing &&
    existing.cwd === input.cwd &&
    existing.settingsKey === settingsKey
  ) {
    existing.onEvent = input.onEvent;
    return existing;
  }
  if (existing) await stopAgySession(input.sessionId);

  const resume = resumeBySession.get(input.sessionId);
  const canResume = resume != null && resume.cwd === input.cwd;
  if (resume && !canResume) resumeBySession.delete(input.sessionId);

  const { path } = await resolveAgyBinaryImpl();
  const live: Live = {
    cwd: input.cwd,
    settingsKey,
    conversationId: canResume ? resume?.conversationId : undefined,
    onEvent: input.onEvent,
    cancelled: false,
    muteUpdates: false,
    turns: Promise.resolve(),
    turnDone: null,
    turnFailed: null,
    turnEndPending: false,
    emittedAssistant: "",
  };
  const stderr: string[] = [];

  watchChild(
    input.sessionId,
    (line) => handleAgyLine(input.sessionId, live, line),
    (code) => {
      if (liveBySession.get(input.sessionId) !== live) return;
      liveBySession.delete(input.sessionId);
      const detail = stderr[stderr.length - 1]?.trim();
      const error = new Error(
        detail ? `Antigravity exited: ${detail}` : "Antigravity exited",
      );
      if (!live.cancelled) live.turnFailed?.(error);
      live.turnDone = null;
      live.turnFailed = null;
      if (!live.muteUpdates) {
        live.onEvent({ type: "session.ended", code });
      }
      unwatchChild(input.sessionId);
    },
    (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      stderr.push(trimmed);
      if (stderr.length > 8) stderr.shift();
    },
  );

  liveBySession.set(input.sessionId, live);
  try {
    await spawnChild(
      input.sessionId,
      path,
      buildAgySpawnArgs(input, canResume ? resume?.conversationId : undefined),
      input.cwd,
    );
  } catch (error) {
    liveBySession.delete(input.sessionId);
    unwatchChild(input.sessionId);
    throw error;
  }

  live.onEvent({ type: "session.started" });
  live.onEvent({ type: "status", text: "Antigravity active" });
  return live;
}

async function runTurn(
  sessionId: string,
  live: Live,
  input: SendTurnInput,
): Promise<void> {
  const content = agyPrompt(input.text, input.attachments ?? []);
  if (!content.trim()) return;

  live.emittedAssistant = "";
  const turn = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  settlePendingTurn(live);

  try {
    await writeChild(
      sessionId,
      JSON.stringify({ event: "user", message: { content } }),
    );
    settlePendingTurn(live);
    await turn;
  } catch (error) {
    if (live.cancelled) return;
    const failure = error instanceof Error ? error : new Error(String(error));
    live.onEvent({ type: "session.error", message: failure.message });
    throw failure;
  } finally {
    live.turnDone = null;
    live.turnFailed = null;
  }
}

export function buildAgySpawnArgs(
  input: Pick<SendTurnInput, "model" | "modelSettings" | "runtimeMode">,
  conversationId?: string,
): string[] {
  const args = [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
  ];
  const model = nativeModelId(input.model);
  if (model) args.push("--model", model);

  const effort = input.modelSettings?.effort;
  if (effort && effort !== "off") args.push("--effort", effort);
  if (conversationId) args.push("--conversation", conversationId);

  if (input.runtimeMode === "full-access") {
    args.push("--dangerously-skip-permissions");
  } else if (isPlanOnlyMode(input.runtimeMode)) {
    args.push("--mode", "plan");
  } else {
    args.push("--mode", "accept-edits");
  }
  return args;
}

function isPlanOnlyMode(mode: RuntimeMode): boolean {
  return mode === "plan" || mode === "review";
}

function agySettingsKey(input: SendTurnInput): string {
  return JSON.stringify({
    model: nativeModelId(input.model),
    effort: input.modelSettings?.effort ?? "",
    runtimeMode: input.runtimeMode,
  });
}

function agyPrompt(text: string, attachments: Attachment[]): string {
  const paths = attachments
    .map((attachment) => attachment.path?.trim())
    .filter((path): path is string => Boolean(path));
  if (paths.length === 0) return text;
  const files = paths.map((path) => `- ${path}`).join("\n");
  return `${text.trim()}\n\nAttached files:\n${files}`.trim();
}

export function parseAgyLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return asRecord(value);
  } catch {
    return null;
  }
}

function handleAgyLine(sessionId: string, live: Live, line: string): void {
  const event = parseAgyLine(line);
  if (!event || live.muteUpdates) return;

  const eventName = stringField(event, "event") ?? stringField(event, "type");
  if (eventName === "init") {
    bindConversation(sessionId, live, stringField(event, "conversation_id"));
    return;
  }
  if (eventName === "step_update") {
    handleStepUpdate(live, asRecord(event.step_update));
    return;
  }
  if (eventName === "result") {
    handleResult(sessionId, live, event);
    return;
  }

  const text = stringField(event, "text") ?? stringField(event, "content");
  if (text && (eventName === "message" || eventName === "text_delta")) {
    emitAssistant(live, text);
  }
}

function handleStepUpdate(
  live: Live,
  step: Record<string, unknown> | null,
): void {
  if (!step) return;
  const type = stringField(step, "step_type") ?? "";
  const assistant = stringField(step, "text_delta");
  const thought = stringField(step, "thought_delta");

  if (thought) live.onEvent({ type: "reasoning.delta", text: thought });
  if (assistant && type === "thought") {
    live.onEvent({ type: "reasoning.delta", text: assistant });
  } else if (assistant) {
    emitAssistant(live, assistant);
  }

  emitUsage(live, asRecord(step.usage));

  const toolName = stringField(step, "tool_name");
  if (type !== "tool_call" && !toolName) return;
  const parameters = asRecord(step.parameters);
  const callId =
    stringField(step, "tool_id") ??
    `agy-tool-${numberField(step, "step_index") ?? Date.now()}`;
  live.onEvent({
    type: "tool.started",
    callId,
    title: toolName ?? "Tool execution",
    kind: toolKind(toolName),
    status: "pending",
    preview: toolPreview(toolName, parameters),
  });
}

function handleResult(
  sessionId: string,
  live: Live,
  event: Record<string, unknown>,
): void {
  const result = asRecord(event.result) ?? event;
  bindConversation(
    sessionId,
    live,
    stringField(result, "conversation_id") ??
      stringField(event, "conversation_id"),
  );

  const response =
    stringField(result, "response") ?? stringField(result, "text");
  if (response) {
    const remainder = snapshotRemainder(live.emittedAssistant, response);
    if (remainder) emitAssistant(live, remainder);
  }
  emitUsage(live, asRecord(result.usage) ?? asRecord(event.usage));

  const status = (stringField(result, "status") ?? "SUCCESS").toUpperCase();
  if (status !== "SUCCESS" && !live.cancelled) {
    const message =
      stringField(result, "error") ??
      stringField(result, "message") ??
      `Antigravity turn failed with status ${status}`;
    live.onEvent({ type: "session.error", message });
  }
  finishTurn(live, [
    { type: "message.completed" },
    { type: "reasoning.completed" },
  ]);
}

function bindConversation(
  sessionId: string,
  live: Live,
  conversationId: string | undefined,
): void {
  const id = conversationId?.trim();
  if (!id || id === live.conversationId) return;
  live.conversationId = id;
  resumeBySession.set(sessionId, { conversationId: id, cwd: live.cwd });
  live.onEvent({ type: "session.providerBound", providerSessionId: id });
}

function emitAssistant(live: Live, text: string): void {
  if (!text) return;
  live.emittedAssistant += text;
  live.onEvent({ type: "message.delta", text });
}

function emitUsage(live: Live, usage: Record<string, unknown> | null): void {
  if (!usage) return;
  const used =
    numberField(usage, "total_tokens") ??
    numberField(usage, "input_tokens") ??
    numberField(usage, "totalTokens") ??
    numberField(usage, "inputTokens");
  if (used !== undefined) {
    live.onEvent({ type: "context", used, window: 1_000_000 });
  }
}

function finishTurn(live: Live, events: HarnessEvent[] = []): void {
  live.turnEndPending = false;
  for (const event of events) live.onEvent(event);
  const done = live.turnDone;
  const failed = live.turnFailed;
  live.turnDone = null;
  live.turnFailed = null;
  if (done) done();
  else if (!failed) live.turnEndPending = true;
}

function settlePendingTurn(live: Live): void {
  if (!live.turnEndPending || !live.turnDone) return;
  finishTurn(live);
}

function toolKind(name?: string): string {
  const lower = name?.toLowerCase() ?? "";
  if (/command|bash|exec|shell/.test(lower)) return "command";
  if (/view|read/.test(lower)) return "read";
  if (/write|create/.test(lower)) return "write";
  if (/replace|edit|patch/.test(lower)) return "patch";
  if (/search|grep|find/.test(lower)) return "search";
  return "other";
}

function toolPreview(
  name: string | undefined,
  parameters: Record<string, unknown> | null,
): ToolPreview | undefined {
  if (!parameters) return undefined;
  const path =
    stringField(parameters, "TargetFile") ??
    stringField(parameters, "path") ??
    stringField(parameters, "file_path");
  const command =
    stringField(parameters, "CommandLine") ??
    stringField(parameters, "command");
  const kind = toolKind(name);
  if (command) return { kind: "shell", output: command };
  if (path && kind === "write") return { kind: "write", path };
  if (path) return { kind: "read", path };
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Exported for tests. */
export function __agyTestReset(): void {
  liveBySession.clear();
  resumeBySession.clear();
  cancelledSessions.clear();
  resolveAgyBinaryImpl = resolveGeminiBinary;
}
