import { nativeModelId } from "../models";
import type { Attachment, RuntimeMode, ToolPreview } from "../session";
import { supportsAgyStreamInput } from "./agyProtocol";
import {
  closeRetiredRawChildren,
  execChild,
  type RawChildHandle,
  reserveRawChild,
  resolveGeminiBinary,
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

type Admission = {
  sessionId: string;
  cwd: string;
  settingsKey: string;
  handle?: RawChildHandle;
  retired: boolean;
  cancelled: boolean;
  opening?: Promise<Live>;
  live?: Live;
};

type Live = {
  admission: Admission;
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
const admissionBySession = new Map<string, Admission>();

function isCurrent(admission: Admission): boolean {
  return (
    !admission.retired &&
    !admission.handle?.retired &&
    admissionBySession.get(admission.sessionId) === admission
  );
}

function guardCurrent(admission: Admission): void {
  if (!isCurrent(admission)) throw new Error("Antigravity session was retired");
}

function closeAdmission(admission: Admission, cancelled = true): Promise<void> {
  admission.retired = true;
  const id = admission.sessionId;
  if (admissionBySession.get(id) === admission) admissionBySession.delete(id);
  const live = admission.live;
  if (liveBySession.get(id) === live) liveBySession.delete(id);
  if (live) {
    if (cancelled) live.cancelled = true;
    live.muteUpdates = true;
  }
  const closing =
    admission.handle?.close().catch(() => undefined) ?? Promise.resolve();
  if (live) {
    const done = live.turnDone;
    live.turnDone = null;
    live.turnFailed = null;
    done?.();
  }
  return closing;
}

function snapshotInput(input: SendTurnInput): SendTurnInput {
  return {
    ...input,
    modelSettings: input.modelSettings
      ? { ...input.modelSettings }
      : input.modelSettings,
    networkAllowlist: input.networkAllowlist
      ? [...input.networkAllowlist]
      : input.networkAllowlist,
    attachments: input.attachments?.map((attachment) => ({ ...attachment })),
  };
}
const resumeBySession = new Map<string, Resume>();
const cancelledSessions = new Set<string>();

let resolveAgyBinaryImpl: () => Promise<{ path: string }> = resolveGeminiBinary;

/** Test seam. */
export function setAgyBinaryResolver(
  fn: () => Promise<{ path: string }>,
): void {
  resolveAgyBinaryImpl = fn;
}

export async function sendAgyTurn(request: SendTurnInput): Promise<void> {
  const input = snapshotInput(request);
  const live = await ensureLive(input);
  guardCurrent(live.admission);
  if (live.admission.cancelled) {
    live.admission.cancelled = false;
    return;
  }
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      if (!isCurrent(live.admission)) return;
      live.onEvent = input.onEvent;
      live.cancelled = false;
      live.muteUpdates = false;
      await runTurn(live, input);
    });

  try {
    await live.turns;
  } catch (error) {
    if (live.cancelled) return;
    if (isCurrent(live.admission)) {
      await closeAdmission(live.admission);
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
    const admission = admissionBySession.get(sessionId);
    if (admission) admission.cancelled = true;
    else cancelledSessions.add(sessionId);
    return;
  }
  live.cancelled = true;
  live.muteUpdates = true;
  await stopAgySession(sessionId);
}

export async function stopAgySession(sessionId: string): Promise<void> {
  cancelledSessions.delete(sessionId);
  const current = admissionBySession.get(sessionId);
  if (current) {
    current.retired = true;
    admissionBySession.delete(sessionId);
    if (liveBySession.get(sessionId) === current.live)
      liveBySession.delete(sessionId);
    if (current.live) {
      current.live.cancelled = true;
      current.live.muteUpdates = true;
    }
  }
  const retired = closeRetiredRawChildren(sessionId).catch(() => undefined);
  const closing = current ? closeAdmission(current) : Promise.resolve();
  await Promise.all([retired, closing]);
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

function ensureLive(input: SendTurnInput): Promise<Live> {
  const settingsKey = agySettingsKey(input);
  const existing = admissionBySession.get(input.sessionId);
  if (
    existing &&
    isCurrent(existing) &&
    existing.cwd === input.cwd &&
    existing.settingsKey === settingsKey
  ) {
    if (existing.opening) return existing.opening;
    if (existing.live) return Promise.resolve(existing.live);
  }
  const admission: Admission = {
    sessionId: input.sessionId,
    cwd: input.cwd,
    settingsKey,
    retired: false,
    cancelled: cancelledSessions.delete(input.sessionId),
  };
  admissionBySession.set(input.sessionId, admission);
  try {
    admission.handle = reserveRawChild(input.sessionId);
    guardCurrent(admission);
    if (existing) void closeAdmission(existing);
    admission.opening = Promise.resolve().then(() =>
      startLive(input, admission),
    );
    return admission.opening;
  } catch (error) {
    const restore =
      admissionBySession.get(input.sessionId) === admission &&
      existing &&
      !existing.retired &&
      !existing.handle?.retired;
    void closeAdmission(admission);
    if (restore) admissionBySession.set(input.sessionId, existing);
    throw error;
  }
}

async function startLive(
  input: SendTurnInput,
  admission: Admission,
): Promise<Live> {
  try {
    guardCurrent(admission);
    const resume = resumeBySession.get(input.sessionId);
    const canResume = resume != null && resume.cwd === input.cwd;
    if (resume && !canResume) resumeBySession.delete(input.sessionId);
    const { path } = await resolveAgyBinaryImpl();
    guardCurrent(admission);
    let version: string;
    try {
      version = await execChild(path, ["--version"]);
    } catch {
      guardCurrent(admission);
      throw new Error(
        "Unable to verify the Antigravity CLI version. Retry after checking the CLI installation.",
      );
    }
    guardCurrent(admission);
    if (!supportsAgyStreamInput(version)) {
      throw new Error(
        "Antigravity CLI 1.1.15 or newer with stream-json input is required. Update the CLI and retry.",
      );
    }
    const handle = admission.handle;
    if (!handle) throw new Error("Antigravity session was retired");
    const live: Live = {
      admission,
      cwd: input.cwd,
      settingsKey: admission.settingsKey,
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
    admission.live = live;
    const stderr: string[] = [];
    handle.watch(
      (line) => handleAgyLine(input.sessionId, live, line),
      (code) => {
        if (!isCurrent(admission)) return;
        const detail = stderr[stderr.length - 1]?.trim();
        const error = new Error(
          detail ? `Antigravity exited: ${detail}` : "Antigravity exited",
        );
        const failed = live.turnFailed;
        const emit = live.onEvent;
        const deliver = !live.muteUpdates;
        live.turnDone = null;
        live.turnFailed = null;
        void closeAdmission(admission, false);
        failed?.(error);
        if (deliver && !admissionBySession.has(input.sessionId))
          emit({ type: "session.ended", code });
      },
      (line) => {
        if (!isCurrent(admission)) return;
        const trimmed = line.trim();
        if (!trimmed) return;
        stderr.push(trimmed);
        if (stderr.length > 8) stderr.shift();
      },
    );
    guardCurrent(admission);
    liveBySession.set(input.sessionId, live);
    await handle.spawn(
      path,
      buildAgySpawnArgs(input, canResume ? resume?.conversationId : undefined),
      input.cwd,
      input.networkAllowlist,
    );
    guardCurrent(admission);
    emitEvent(live, { type: "session.started" });
    guardCurrent(admission);
    emitEvent(live, { type: "status", text: "Antigravity active" });
    guardCurrent(admission);
    return live;
  } catch (error) {
    void closeAdmission(admission);
    throw error;
  }
}

async function runTurn(live: Live, input: SendTurnInput): Promise<void> {
  guardCurrent(live.admission);
  const handle = live.admission.handle;
  if (!handle) throw new Error("Antigravity session was retired");
  const content = agyPrompt(input.text, input.attachments ?? []);
  if (!content.trim()) return;

  live.emittedAssistant = "";
  const turn = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  void turn.catch(() => undefined);
  settlePendingTurn(live);

  try {
    await handle.write(JSON.stringify({ event: "user", message: { content } }));
    if (live.cancelled) return;
    guardCurrent(live.admission);
    settlePendingTurn(live);
    await turn;
    if (!live.cancelled) guardCurrent(live.admission);
  } catch (error) {
    if (live.cancelled) return;
    const failure = error instanceof Error ? error : new Error(String(error));
    emitEvent(live, { type: "session.error", message: failure.message });
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
  if (!isCurrent(live.admission)) return;
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

  if (thought) emitEvent(live, { type: "reasoning.delta", text: thought });
  if (assistant && type === "thought") {
    emitEvent(live, { type: "reasoning.delta", text: assistant });
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
  emitEvent(live, {
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
    emitEvent(live, { type: "session.error", message });
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
  if (!isCurrent(live.admission) || live.muteUpdates) return;
  const id = conversationId?.trim();
  if (!id || id === live.conversationId) return;
  live.conversationId = id;
  resumeBySession.set(sessionId, { conversationId: id, cwd: live.cwd });
  emitEvent(live, { type: "session.providerBound", providerSessionId: id });
}

function emitEvent(live: Live, event: HarnessEvent): void {
  if (isCurrent(live.admission) && !live.muteUpdates) live.onEvent(event);
}
function emitAssistant(live: Live, text: string): void {
  if (!text) return;
  live.emittedAssistant += text;
  emitEvent(live, { type: "message.delta", text });
}

function emitUsage(live: Live, usage: Record<string, unknown> | null): void {
  if (!usage) return;
  const used =
    numberField(usage, "total_tokens") ??
    numberField(usage, "input_tokens") ??
    numberField(usage, "totalTokens") ??
    numberField(usage, "inputTokens");
  if (used !== undefined) {
    emitEvent(live, { type: "context", used, window: 1_000_000 });
  }
}

function finishTurn(live: Live, events: HarnessEvent[] = []): void {
  live.turnEndPending = false;
  for (const event of events) emitEvent(live, event);
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
  admissionBySession.clear();
  resumeBySession.clear();
  cancelledSessions.clear();
  resolveAgyBinaryImpl = resolveGeminiBinary;
}
