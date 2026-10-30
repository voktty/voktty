import { nativeModelId } from "../models";
import { sameProviderAccountId } from "../providerAccounts";
import type { RuntimeMode, TaskListItem, TaskListMeta } from "../session";
import { isRemoteProjectPath } from "@/modules/harness/lib/recents";
import { loadClaudeHooks } from "../settings";
import {
  closeRetiredRawChildren,
  type RawChildHandle,
  reserveRawChild,
  resolveClaudeBinary,
} from "./child";
import {
  askUserQuestionAllowInput,
  asRecord,
  assistantMessageId,
  assistantTextBlocks,
  assistantThinkingBlocks,
  assistantToolUses,
  contextFromResult,
  contextUsedFromAssistant,
  buildClaudeSpawnArgs,
  buildClaudeUserMessage,
  buildControlRequest,
  buildControlResponse,
  claudeSettingsKey,
  extractAskUserQuestionTitle,
  extractExitPlanModePlan,
  inputJsonDeltaFromEvent,
  isAgentTaskType,
  isClaudeUltracodeEffort,
  isSubagentMessage,
  isTerminalAgentTaskStatus,
  isTodoTool,
  applyClaudeTaskTool,
  normalizeClaudeCliEffort,
  parseBackgroundAgentTasks,
  parseControlCancelId,
  parseControlRequest,
  parseJsonLine,
  parseTaskNotification,
  parseTaskProgress,
  parseTaskStarted,
  parseTaskUpdated,
  parseToolProgress,
  taskListFromTodos,
  previewFromTool,
  resolveClaudeApiModelId,
  runtimeModeToPermission,
  sessionIdFromMessage,
  statusTextFromSystem,
  streamDeltaFromEvent,
  stringField,
  summarizeToolRequest,
  toClaudePermissionResult,
  toolKindFromName,
  toolResultsFromUserMessage,
  toolStartFromEvent,
  toolTitle,
  tryParseJsonRecord,
  turnStatusFromResult,
  type ClaudeCliSettings,
  type ClaudeControlRequest,
} from "./claudeProtocol";
import { isAgentToolName } from "./preview";
import { joinStreamText, snapshotRemainder } from "./streamText";
import {
  questionPromptTitle,
  questionsFromUnknown,
  type UserQuestionReply,
} from "../userQuestion";
import type {
  ApprovalDecision,
  CompactContextInput,
  HarnessEvent,
  HarnessSessionInput,
  SendTurnInput,
  SteerTurnInput,
} from "./types";

/**
 * A PermissionRequest hook can decide before the user touches the prompt; Claude
 * then cancels the control request out from under us. That is not a rejection,
 * so it gets its own outcome instead of being folded into "deny".
 */
type ApprovalOutcome = ApprovalDecision | "cancelled";

type PendingApproval = {
  requestId: string;
  input: Record<string, unknown>;
  resolve: (decision: ApprovalOutcome) => void;
};

type PendingQuestion = {
  requestId: string;
  resolve: (reply: UserQuestionReply | "cancelled") => void;
};

type InFlightTool = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  partialJson: string;
  title: string;
};

type LiveAgentTask = {
  taskId: string;
  toolUseId?: string;
  description: string;
  backgrounded: boolean;
};

type Live = {
  admission: Admission;
  cwd: string;
  claudeSessionId: string;
  providerAccountId?: string;
  runtimeMode: RuntimeMode;
  planning: boolean;
  settingsKey: string;
  onEvent: (event: HarnessEvent) => void;
  eventSink: (event: HarnessEvent) => void;
  approvals: Map<number, PendingApproval>;
  questions: Map<number, PendingQuestion>;
  nextControlId: number;
  toolsByIndex: Map<number, InFlightTool>;
  toolsById: Map<string, InFlightTool>;
  agentTasks: Map<string, LiveAgentTask>;
  /** TaskCreate/TaskUpdate items, keyed by Claude's task id. */
  claudeTasks: Map<string, TaskListItem>;
  turnResultSeen: boolean;
  cancelled: boolean;
  muteUpdates: boolean;
  turns: Promise<void>;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  turnEndPending: boolean;
  activeTurn: boolean;
  initDone: (() => void) | null;
  initialized: boolean;
  emittedAssistant: string;
  emittedReasoning: string;
  manualCompaction: boolean;
  compactionConfirmed: boolean;
};

type Admission = {
  sessionId: string;
  cwd: string;
  providerAccountId?: string;
  planning: boolean;
  settingsKey: string;
  retired: boolean;
  openingComplete: boolean;
  generation: object;
  handle?: RawChildHandle;
  opening?: Promise<Live>;
  live?: Live;
  interrupt?: Promise<void>;
  failure?: Error;
};

type Resume = {
  sessionId: string;
  cwd: string;
  providerAccountId?: string;
};

const INIT_TIMEOUT_MS = 8_000;
const MAX_PENDING_WRITES = 256;
let pendingWrites = 0;

const liveByThread = new Map<string, Live>();
const admissions = new Map<string, Admission>();
let nextApprovalUiId = 1;
const resumeByThread = new Map<string, Resume>();
/**
 * Claude task lists outlive a Live: a restart that resumes the conversation
 * keeps its task ids, so later TaskUpdate calls must find earlier tasks. Task
 * ids belong to one Claude conversation, so each map records which one.
 */
const tasksByThread = new Map<
  string,
  { providerSessionId: string; tasks: Map<string, TaskListItem> }
>();
/** Task-list block key for TaskCreate/TaskUpdate items. */
const CLAUDE_TASKS_KEY = "claude-tasks";
const cancelledThreads = new Set<string>();

let resolveClaudeBinaryImpl: () => Promise<{ path: string }> =
  resolveClaudeBinary;

/** Test seam. */
export function setClaudeBinaryResolver(
  fn: () => Promise<{ path: string }>,
): void {
  resolveClaudeBinaryImpl = fn;
}

function isCurrent(admission: Admission): boolean {
  return (
    !admission.retired &&
    !admission.handle?.retired &&
    admissions.get(admission.sessionId) === admission
  );
}

function guardCurrent(admission: Admission): void {
  if (!isCurrent(admission)) throw new Error("Claude session was retired");
}

function guardOperation(live: Live, generation: object): void {
  guardUsable(live.admission);
  if (live.admission.generation !== generation)
    throw new Error("Claude turn was cancelled");
}

function guardUsable(admission: Admission): void {
  guardCurrent(admission);
  if (admission.failure) throw admission.failure;
}

function recordWriterFailure(admission: Admission, error: Error): void {
  if (!isCurrent(admission) || admission.failure) return;
  admission.failure = error;
  const live = admission.live;
  if (!live) return;
  live.muteUpdates = true;
  live.activeTurn = false;
  const failed = live.turnFailed;
  const initialized = live.initDone;
  live.turnDone = null;
  live.turnFailed = null;
  live.initDone = null;
  for (const pending of live.approvals.values()) pending.resolve("cancelled");
  live.approvals.clear();
  for (const pending of live.questions.values()) pending.resolve("cancelled");
  live.questions.clear();
  failed?.(error);
  initialized?.();
}

function setEventSink(live: Live, sink: (event: HarnessEvent) => void): void {
  live.eventSink = sink;
  const generation = live.admission.generation;
  live.onEvent = (event) => {
    if (
      isCurrent(live.admission) &&
      !live.admission.failure &&
      live.admission.generation === generation &&
      !live.muteUpdates
    )
      sink(event);
  };
}

function retireAdmission(admission: Admission): void {
  admission.retired = true;
  const id = admission.sessionId;
  if (admissions.get(id) === admission) admissions.delete(id);
  const live = admission.live;
  if (liveByThread.get(id) === live) liveByThread.delete(id);
}

function closeAdmission(admission: Admission, cancelled = true): Promise<void> {
  retireAdmission(admission);
  const live = admission.live;
  if (live) {
    if (cancelled) live.cancelled = true;
    live.muteUpdates = true;
    for (const pending of live.approvals.values()) pending.resolve("deny");
    live.approvals.clear();
    for (const pending of live.questions.values())
      pending.resolve({ kind: "skipped" });
    live.questions.clear();
    live.activeTurn = false;
    const done = live.turnDone;
    const initialized = live.initDone;
    live.turnDone = null;
    live.turnFailed = null;
    live.initDone = null;
    done?.();
    initialized?.();
  }
  return admission.handle?.close().catch(() => undefined) ?? Promise.resolve();
}

function snapshotSession<T extends HarnessSessionInput>(input: T): T {
  return {
    ...input,
    modelSettings: input.modelSettings ? { ...input.modelSettings } : undefined,
    networkAllowlist: input.networkAllowlist
      ? [...input.networkAllowlist]
      : input.networkAllowlist,
  };
}

export async function sendClaudeTurn(request: SendTurnInput): Promise<void> {
  const input = snapshotSession({
    ...request,
    attachments: request.attachments?.map((attachment) => ({ ...attachment })),
  });
  if (cancelledThreads.delete(input.sessionId)) return;
  const admission = ensureLive(input);
  const generation = admission.generation;
  const opening = admission.opening;
  if (!opening) throw new Error("Claude session was retired");
  const live = await opening;
  guardUsable(admission);
  if (admission.generation !== generation) return;
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      if (!isCurrent(admission) || admission.generation !== generation) return;
      if (admission.interrupt) await admission.interrupt;
      guardOperation(live, generation);
      setEventSink(live, input.onEvent);
      live.runtimeMode = input.runtimeMode;
      live.cancelled = false;
      live.muteUpdates = false;
      try {
        await runTurn(live, input, generation);
      } catch (error) {
        if (live.cancelled) return;
        throw error;
      }
    });
  await live.turns;
}

export async function compactClaudeContext(
  request: CompactContextInput,
): Promise<void> {
  const input = snapshotSession(request);
  if (cancelledThreads.delete(input.sessionId)) return;
  const admission = ensureLive(input, true);
  const generation = admission.generation;
  const opening = admission.opening;
  if (!opening) throw new Error("Claude session was retired");
  const live = await opening;
  guardUsable(admission);
  if (admission.generation !== generation) return;
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      if (!isCurrent(admission) || admission.generation !== generation) return;
      if (admission.interrupt) await admission.interrupt;
      guardOperation(live, generation);
      setEventSink(live, input.onEvent);
      live.runtimeMode = input.runtimeMode;
      live.cancelled = false;
      live.muteUpdates = false;
      live.manualCompaction = true;
      live.compactionConfirmed = false;
      try {
        await runTurn(
          live,
          {
            ...input,
            modelSettings: undefined,
            text: "/compact",
            attachments: [],
          },
          generation,
        );
        guardOperation(live, generation);
        if (!live.compactionConfirmed) {
          throw new Error("Claude Code did not confirm context compaction");
        }
      } catch (error) {
        if (live.cancelled) return;
        throw error;
      } finally {
        live.manualCompaction = false;
      }
    });
  await live.turns;
}

export async function steerClaudeTurn(input: SteerTurnInput): Promise<void> {
  const live = liveByThread.get(input.sessionId);
  if (live) guardUsable(live.admission);
  if (!live?.activeTurn) throw new Error("No active turn to steer");
  const generation = live.admission.generation;
  guardOperation(live, generation);

  const message = buildClaudeUserMessage({
    text: input.text,
    attachments: input.attachments,
    effort: input.modelSettings?.effort,
  });
  const content = (message.message as { content: unknown[] }).content;
  if (content.length === 0) return;

  await writeJson(live, message);
  guardOperation(live, generation);
}

export function respondClaudeApproval(
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  const live = liveByThread.get(sessionId);
  const pending = live?.approvals.get(requestId);
  if (!pending) return;
  pending.resolve(decision);
}

export function respondClaudeQuestion(
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  const live = liveByThread.get(sessionId);
  const pending = live?.questions.get(requestId);
  if (!pending) return;
  pending.resolve(reply);
}

export async function cancelClaudeTurn(sessionId: string): Promise<void> {
  const opening = admissions.get(sessionId);
  if (opening && !opening.openingComplete) {
    await closeAdmission(opening);
    return;
  }
  const live = liveByThread.get(sessionId);
  if (!live) {
    const admission = admissions.get(sessionId);
    if (admission) await closeAdmission(admission);
    else cancelledThreads.add(sessionId);
    return;
  }
  const admission = live.admission;
  if (!admission.interrupt) {
    const interrupt = Promise.resolve().then(() =>
      writeJson(
        live,
        buildControlRequest(nextControlId(live), { subtype: "interrupt" }),
      ),
    );
    admission.interrupt = interrupt;
    void interrupt.then(
      () => {
        if (admission.interrupt === interrupt) admission.interrupt = undefined;
      },
      () => {},
    );
  }
  const interrupt = admission.interrupt;
  admission.generation = {};
  live.cancelled = true;
  live.muteUpdates = true;
  for (const [, pending] of live.approvals) pending.resolve("deny");
  live.approvals.clear();
  for (const [, pending] of live.questions)
    pending.resolve({ kind: "skipped" });
  live.questions.clear();
  finishActiveTurn(live, [
    { type: "message.completed" },
    { type: "reasoning.completed" },
  ]);
  await interrupt.catch(() => undefined);
}

export async function stopClaudeSession(sessionId: string): Promise<void> {
  cancelledThreads.delete(sessionId);
  const admission = admissions.get(sessionId);
  if (admission) retireAdmission(admission);
  const retired = closeRetiredRawChildren(sessionId).catch(() => undefined);
  const closing = admission ? closeAdmission(admission) : Promise.resolve();
  await Promise.all([retired, closing]);
}

export async function forgetClaudeSession(sessionId: string): Promise<void> {
  resumeByThread.delete(sessionId);
  tasksByThread.delete(sessionId);
  await stopClaudeSession(sessionId);
}

export function bindClaudeSession(
  threadId: string,
  providerSessionId: string,
  cwd: string,
  providerAccountId?: string,
): void {
  const sessionId = providerSessionId.trim();
  if (!threadId || !sessionId || !cwd.trim()) return;
  resumeByThread.set(threadId, { sessionId, cwd, providerAccountId });
  // Task ids from another conversation mean nothing in this one.
  if (tasksByThread.get(threadId)?.providerSessionId !== sessionId) {
    tasksByThread.delete(threadId);
  }
}

/**
 * Seed the task map from a restored session's persisted panel. After an app
 * restart only the transcript survives, and a resumed conversation still
 * refers to its earlier task ids.
 */
export function restoreClaudeTaskLists(
  threadId: string,
  lists: TaskListMeta[],
): void {
  if (!threadId || tasksByThread.has(threadId)) return;
  // Only a list produced by the conversation bound to this thread applies.
  const providerSessionId = resumeByThread.get(threadId)?.sessionId;
  if (!providerSessionId) return;
  let items: TaskListItem[] = [];
  for (const entry of lists) {
    if (entry.key !== CLAUDE_TASKS_KEY) continue;
    if (entry.providerSessionId !== providerSessionId) continue;
    items = entry.items.filter((item) => item.id);
  }
  if (items.length === 0) return;
  tasksByThread.set(threadId, {
    providerSessionId,
    tasks: new Map(items.map((item) => [item.id!, { ...item }])),
  });
}

function ensureLive(
  input: HarnessSessionInput,
  preservePlanning = false,
): Admission {
  const settingsKey = settingsKeyFor(input);
  const planning = input.intent === "plan";
  const existing = admissions.get(input.sessionId);
  if (existing && isCurrent(existing) && existing.failure)
    throw existing.failure;
  if (
    existing &&
    isCurrent(existing) &&
    existing.cwd === input.cwd &&
    sameProviderAccountId(
      existing.providerAccountId,
      input.providerAccountId,
    ) &&
    existing.settingsKey === settingsKey &&
    (preservePlanning || existing.planning === planning) &&
    existing.opening
  ) {
    return existing;
  }
  const admission: Admission = {
    sessionId: input.sessionId,
    cwd: input.cwd,
    providerAccountId: input.providerAccountId,
    planning,
    settingsKey,
    retired: false,
    openingComplete: false,
    generation: {},
  };
  const launch = launchOptions(input, undefined, "");
  admissions.set(input.sessionId, admission);
  try {
    admission.handle = reserveRawChild(input.sessionId);
    guardCurrent(admission);
    if (existing) void closeAdmission(existing);
    guardCurrent(admission);
    admission.opening = Promise.resolve().then(() =>
      startLive(input, admission, launch),
    );
    return admission;
  } catch (error) {
    const restore =
      admissions.get(input.sessionId) === admission &&
      existing &&
      !existing.retired &&
      !existing.handle?.retired;
    void closeAdmission(admission);
    if (restore) admissions.set(input.sessionId, existing);
    throw error;
  }
}

async function startLive(
  input: HarnessSessionInput,
  admission: Admission,
  launch: ReturnType<typeof launchOptions>,
): Promise<Live> {
  try {
    guardUsable(admission);
    const resume = resumeByThread.get(input.sessionId);
    const canResume =
      resume != null &&
      resume.cwd === input.cwd &&
      sameProviderAccountId(resume.providerAccountId, input.providerAccountId);
    if (
      resume &&
      (resume.cwd !== input.cwd ||
        !sameProviderAccountId(
          resume.providerAccountId,
          input.providerAccountId,
        ))
    ) {
      resumeByThread.delete(input.sessionId);
    }

    const isRemote = isRemoteProjectPath(input.cwd);
    const { path } = isRemote
      ? { path: "claude" }
      : await resolveClaudeBinaryImpl();
    guardUsable(admission);
    const handle = admission.handle;
    if (!handle) throw new Error("Claude session was retired");
    const claudeSessionId =
      canResume && resume ? resume.sessionId : crypto.randomUUID();
    const retained = tasksByThread.get(input.sessionId);
    const claudeTasks =
      retained?.providerSessionId === claudeSessionId
        ? new Map([...retained.tasks].map(([id, item]) => [id, { ...item }]))
        : new Map<string, TaskListItem>();
    tasksByThread.set(input.sessionId, {
      providerSessionId: claudeSessionId,
      tasks: claudeTasks,
    });
    const resumeId = canResume ? resume?.sessionId : undefined;

    const live: Live = {
      admission,
      cwd: input.cwd,
      claudeSessionId,
      providerAccountId: input.providerAccountId,
      runtimeMode: input.runtimeMode,
      planning: admission.planning,
      settingsKey: admission.settingsKey,
      onEvent: input.onEvent,
      eventSink: input.onEvent,
      approvals: new Map(),
      questions: new Map(),
      nextControlId: 1,
      toolsByIndex: new Map(),
      toolsById: new Map(),
      agentTasks: new Map(),
      claudeTasks,
      turnResultSeen: false,
      cancelled: false,
      muteUpdates: false,
      turns: Promise.resolve(),
      turnDone: null,
      turnFailed: null,
      turnEndPending: false,
      activeTurn: false,
      initDone: null,
      initialized: false,
      emittedAssistant: "",
      emittedReasoning: "",
      manualCompaction: false,
      compactionConfirmed: false,
    };
    admission.live = live;
    setEventSink(live, input.onEvent);

    let lastStderr = "";
    handle.watch(
      (line) => {
        if (isCurrent(admission)) handleLine(input.sessionId, live, line);
      },
      (code) => {
        if (!isCurrent(admission)) return;
        const failed = live.turnFailed;
        const sink = live.eventSink;
        const deliver = !live.muteUpdates;
        const exitError = lastStderr.trim() || "Claude Code exited";
        live.turnDone = null;
        live.turnFailed = null;
        void closeAdmission(admission, false);
        failed?.(new Error(exitError));
        if (deliver && !admissions.has(input.sessionId))
          sink({ type: "session.ended", code });
      },
      (stderrLine) => {
        if (isCurrent(admission)) lastStderr = stderrLine;
      },
    );

    guardUsable(admission);
    liveByThread.set(input.sessionId, live);
    await handle.spawn(
      path,
      buildClaudeSpawnArgs({
        ...launch,
        resume: resumeId,
        sessionId: resumeId ? undefined : claudeSessionId,
      }),
      input.cwd,
      input.networkAllowlist,
      { provider: "claude", id: input.providerAccountId ?? "default" },
    );
    guardUsable(admission);
    resumeByThread.set(input.sessionId, {
      sessionId: live.claudeSessionId,
      cwd: input.cwd,
      providerAccountId: input.providerAccountId,
    });

    await writeJson(
      live,
      buildControlRequest(nextControlId(live), { subtype: "initialize" }),
    );
    guardUsable(admission);
    await waitForInit(live, INIT_TIMEOUT_MS);
    guardUsable(admission);
    live.onEvent({
      type: "session.providerBound",
      providerSessionId: live.claudeSessionId,
    });
    guardUsable(admission);
    live.onEvent({ type: "session.started" });
    guardUsable(admission);
    admission.openingComplete = true;
    return live;
  } catch (error) {
    if (!admission.failure || !isCurrent(admission))
      void closeAdmission(admission);
    throw error;
  }
}

async function runTurn(
  live: Live,
  input: SendTurnInput,
  generation: object,
): Promise<void> {
  guardOperation(live, generation);
  const effort = input.modelSettings?.effort;
  const message = buildClaudeUserMessage({
    text: input.text,
    attachments: input.attachments,
    effort,
  });
  const content = (message.message as { content: unknown[] }).content;
  if (content.length === 0) return;

  live.emittedAssistant = "";
  live.emittedReasoning = "";
  live.toolsByIndex.clear();
  live.toolsById.clear();
  live.agentTasks.clear();
  live.turnResultSeen = false;

  const turnPromise = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  void turnPromise.catch(() => undefined);
  live.activeTurn = true;
  settlePendingTurn(live);

  try {
    await writeJson(live, message);
    if (live.cancelled || live.admission.generation !== generation) return;
    guardOperation(live, generation);
    settlePendingTurn(live);
    await turnPromise;
    if (!live.cancelled) guardOperation(live, generation);
  } catch (error) {
    if (live.cancelled) return;
    live.onEvent({
      type: "session.error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    live.turnDone = null;
    live.turnFailed = null;
  }
}

function handleLine(sessionId: string, live: Live, line: string): void {
  if (!isCurrent(live.admission) || live.admission.failure) return;
  const rec = parseJsonLine(line);
  if (!rec) return;

  const type = stringField(rec, "type");
  if (type === "keep_alive") return;

  const cancelId = parseControlCancelId(rec);
  if (cancelId) {
    for (const [uiId, pending] of live.approvals) {
      if (pending.requestId === cancelId) {
        pending.resolve("cancelled");
        live.approvals.delete(uiId);
      }
    }
    for (const [uiId, pending] of live.questions) {
      if (pending.requestId === cancelId) {
        pending.resolve("cancelled");
        live.questions.delete(uiId);
      }
    }
    return;
  }

  const control = parseControlRequest(rec);
  if (control) {
    void handleControlRequest(live, control).catch(() => undefined);
    return;
  }

  if (live.muteUpdates) return;

  const sessionIdFromLine = sessionIdFromMessage(rec);
  if (sessionIdFromLine && sessionIdFromLine !== live.claudeSessionId) {
    live.claudeSessionId = sessionIdFromLine;
    // A different conversation starts with its own task ids.
    live.claudeTasks = new Map();
    tasksByThread.set(sessionId, {
      providerSessionId: sessionIdFromLine,
      tasks: live.claudeTasks,
    });
    resumeByThread.set(sessionId, {
      sessionId: sessionIdFromLine,
      cwd: live.cwd,
      providerAccountId: live.providerAccountId,
    });
    live.onEvent({
      type: "session.providerBound",
      providerSessionId: sessionIdFromLine,
    });
    if (!isCurrent(live.admission) || live.muteUpdates) return;
  }

  if (
    type === "system" &&
    (stringField(rec, "subtype") === "init" ||
      stringField(rec, "subtype") === "initialized")
  ) {
    markInitialized(live);
  }

  if (type === "control_response") {
    markInitialized(live);
    return;
  }

  if (live.manualCompaction && type !== "system" && type !== "result") {
    return;
  }

  if (handleAgentLifecycle(live, rec)) return;
  if (type === "tool_progress") {
    handleToolProgress(live, rec);
    return;
  }
  if (type === "stream_event") {
    handleStreamEvent(live, rec);
    return;
  }
  if (type === "assistant") {
    handleAssistant(live, rec);
    return;
  }
  if (type === "user") {
    handleUser(live, rec);
    return;
  }
  if (type === "result") {
    handleResult(live, rec);
    return;
  }
  if (type === "system") {
    const text = statusTextFromSystem(rec);
    if (text) {
      if ((stringField(rec, "subtype") ?? "").startsWith("compact")) {
        live.compactionConfirmed = true;
      }
      live.onEvent({ type: "status", text });
    }
  }
}

function handleStreamEvent(live: Live, rec: Record<string, unknown>): void {
  const subagent = isSubagentMessage(rec);
  const delta = streamDeltaFromEvent(rec);
  if (delta) {
    if (subagent) return;
    if (delta.kind === "assistant") {
      live.emittedAssistant = joinStreamText(live.emittedAssistant, delta.text);
      live.onEvent({ type: "message.delta", text: delta.text });
    } else {
      live.emittedReasoning = joinStreamText(live.emittedReasoning, delta.text);
      live.onEvent({ type: "reasoning.delta", text: delta.text });
    }
    return;
  }

  const started = toolStartFromEvent(rec);
  if (started) {
    if (subagent) {
      noteSubagentTool(live, rec, started.id, started.name, started.input);
      return;
    }
    const tool: InFlightTool = {
      id: started.id,
      name: started.name,
      input: started.input,
      partialJson: "",
      title: toolTitle(started.name, started.input),
    };
    if (started.index >= 0) live.toolsByIndex.set(started.index, tool);
    live.toolsById.set(started.id, tool);
    live.onEvent({
      type: "tool.started",
      callId: tool.id,
      title: tool.title,
      kind: toolKindFromName(tool.name),
      status: isAgentToolName(tool.name) ? "in_progress" : "pending",
      preview: previewFromTool(tool.name, tool.input),
    });
    emitTaskListIfNeeded(live, tool.name, tool.input);
    return;
  }

  const jsonDelta = inputJsonDeltaFromEvent(rec);
  if (jsonDelta) {
    if (subagent) return;
    const tool = live.toolsByIndex.get(jsonDelta.index);
    if (!tool) return;
    tool.partialJson += jsonDelta.partial;
    const parsed = tryParseJsonRecord(tool.partialJson);
    if (!parsed) return;
    tool.input = parsed;
    tool.title = toolTitle(tool.name, parsed);
    live.onEvent({
      type: "tool.updated",
      callId: tool.id,
      title: tool.title,
      kind: toolKindFromName(tool.name),
      ...(isAgentToolName(tool.name) && stringField(tool.input, "model")
        ? { agentModel: stringField(tool.input, "model") }
        : {}),
      status: "pending",
      detail: summarizeToolRequest(tool.name, parsed),
      preview: previewFromTool(tool.name, parsed),
    });
    emitTaskListIfNeeded(live, tool.name, parsed);
    return;
  }
}

function handleAssistant(live: Live, rec: Record<string, unknown>): void {
  if (isSubagentMessage(rec)) {
    noteSubagentNarration(live, rec);
    for (const use of assistantToolUses(rec)) {
      noteSubagentTool(live, rec, use.id, use.name, use.input);
    }
    return;
  }

  const used = contextUsedFromAssistant(rec);
  if (used !== undefined) live.onEvent({ type: "context", used });

  const snapshot = assistantTextBlocks(rec).join("");
  const extra = snapshotRemainder(live.emittedAssistant, snapshot);
  if (extra) {
    live.emittedAssistant = joinStreamText(live.emittedAssistant, extra);
    live.onEvent({ type: "message.delta", text: extra });
  }

  for (const use of assistantToolUses(rec)) {
    if (live.toolsById.has(use.id)) continue;
    const tool: InFlightTool = {
      id: use.id,
      name: use.name,
      input: use.input,
      partialJson: "",
      title: toolTitle(use.name, use.input),
    };
    live.toolsById.set(use.id, tool);
    live.onEvent({
      type: "tool.started",
      callId: tool.id,
      title: tool.title,
      kind: toolKindFromName(tool.name),
      ...(isAgentToolName(tool.name) && stringField(tool.input, "model")
        ? { agentModel: stringField(tool.input, "model") }
        : {}),
      status: isAgentToolName(tool.name) ? "in_progress" : "pending",
      preview: previewFromTool(tool.name, tool.input),
    });
    if (use.name === "ExitPlanMode") {
      const plan = extractExitPlanModePlan(use.input);
      if (plan) live.onEvent({ type: "plan", text: plan });
    }
    emitTaskListIfNeeded(live, tool.name, tool.input);
  }
}

function handleUser(live: Live, rec: Record<string, unknown>): void {
  if (isSubagentMessage(rec)) {
    noteSubagentResults(live, rec);
    return;
  }
  for (const result of toolResultsFromUserMessage(rec)) {
    const tool = live.toolsById.get(result.toolUseId);
    if (!tool) continue;
    if (isAgentToolName(tool.name) && isBackgroundedAgentTool(live, tool.id)) {
      continue;
    }
    live.onEvent({
      type: "tool.updated",
      callId: tool.id,
      title: tool.title,
      kind: toolKindFromName(tool.name),
      status: result.isError ? "failed" : "completed",
      detail: result.text || undefined,
      preview: previewFromTool(tool.name, tool.input, result.text),
    });
    if (!isCurrent(live.admission) || live.muteUpdates) return;
    if (
      !result.isError &&
      applyClaudeTaskTool(live.claudeTasks, tool.name, tool.input, result.text)
    ) {
      live.onEvent({
        type: "tasks.updated",
        key: CLAUDE_TASKS_KEY,
        // The map is the source of truth, so a TaskUpdate subject is a rename.
        authoritative: true,
        providerSessionId: live.claudeSessionId,
        items: [...live.claudeTasks.values()],
      });
    }
    // What a subagent hands back is the last thing it said, so it closes out
    // that agent's own trail rather than sitting on the parent row as detail.
    if (isAgentToolName(tool.name) && result.text.trim() && !result.isError) {
      live.onEvent({
        type: "agent.step",
        callId: tool.id,
        stepId: `${tool.id}:report`,
        kind: "message",
        text: result.text,
      });
    }
  }
}

function handleResult(live: Live, rec: Record<string, unknown>): void {
  if (isSubagentMessage(rec)) return;
  // A /compact result reports the summarizer call's usage, not the rebuilt
  // conversation level. The next real turn will provide the fresh reading.
  if (!live.manualCompaction) {
    const context = contextFromResult(rec);
    if (context) live.onEvent({ type: "context", ...context });
  }

  const result = turnStatusFromResult(rec);
  if (result.status === "failed" && result.error && !live.cancelled) {
    live.onEvent({ type: "session.error", message: result.error });
  }
  live.turnResultSeen = true;
  maybeFinishTurn(live);
}

async function handleControlRequest(
  live: Live,
  control: ClaudeControlRequest,
): Promise<void> {
  if (!isCurrent(live.admission)) return;
  const emit = live.onEvent;
  const generation = live.admission.generation;
  if (control.subtype !== "can_use_tool" && control.subtype !== "permission") {
    await writeJson(live, buildControlResponse(control.requestId, {})).catch(
      () => undefined,
    );
    return;
  }

  const toolName = control.toolName ?? "tool";
  const input = control.input ?? {};

  if (live.cancelled || live.muteUpdates) {
    await writeJson(
      live,
      buildControlResponse(
        control.requestId,
        toClaudePermissionResult("deny", input),
      ),
    ).catch(() => undefined);
    return;
  }

  if (toolName === "AskUserQuestion") {
    const questions = questionsFromUnknown(input);
    const uiId = allocateApprovalUiId();
    const pending = waitQuestion(live, uiId, control.requestId);
    emit({
      type: "question.asked",
      requestId: uiId,
      title:
        questionPromptTitle(questions) || extractAskUserQuestionTitle(input),
      questions,
      callId: control.toolUseId,
    });
    const outcome = await pending;
    live.questions.delete(uiId);
    if (!isCurrent(live.admission)) return;
    const decision =
      outcome === "cancelled"
        ? "cancelled"
        : outcome.kind === "answered"
          ? "answered"
          : "skipped";
    emit({ type: "question.resolved", requestId: uiId, decision });
    if (outcome === "cancelled") return;
    const cancelled =
      live.cancelled ||
      live.muteUpdates ||
      live.admission.generation !== generation;
    const response =
      !cancelled && outcome.kind === "answered"
        ? {
            behavior: "allow",
            updatedInput: askUserQuestionAllowInput(input, outcome),
          }
        : {
            behavior: "deny",
            message: "User cancelled tool execution.",
          };
    await writeJson(
      live,
      buildControlResponse(control.requestId, response),
    ).catch(() => undefined);
    return;
  }

  if (toolName === "ExitPlanMode") {
    const plan = extractExitPlanModePlan(input);
    if (plan) emit({ type: "plan", text: plan });
    await writeJson(
      live,
      buildControlResponse(control.requestId, {
        behavior: "deny",
        message:
          "The client captured your proposed plan. Stop here and wait for the user's feedback or implementation request in a later turn.",
      }),
    ).catch(() => undefined);
    return;
  }

  applyKnownToolInput(live, toolName, input, control.toolUseId);
  if (!isCurrent(live.admission)) return;
  if (
    live.cancelled ||
    live.muteUpdates ||
    live.admission.generation !== generation
  ) {
    await writeJson(
      live,
      buildControlResponse(
        control.requestId,
        toClaudePermissionResult("deny", input),
      ),
    ).catch(() => undefined);
    return;
  }

  if (live.planning) {
    const kind = toolKindFromName(toolName);
    const decision = kind === "read" || kind === "search" ? "allow" : "deny";
    await writeJson(
      live,
      buildControlResponse(
        control.requestId,
        toClaudePermissionResult(decision, input),
      ),
    ).catch(() => undefined);
    return;
  }

  if (live.runtimeMode === "full-access") {
    await writeJson(
      live,
      buildControlResponse(
        control.requestId,
        toClaudePermissionResult("allow", input),
      ),
    ).catch(() => undefined);
    return;
  }

  const uiId = allocateApprovalUiId();
  const pending = waitApproval(live, uiId, control.requestId, input);
  emit({
    type: "approval.requested",
    requestId: uiId,
    title: toolTitle(toolName, input),
    kind: toolKindFromName(toolName),
    callId: control.toolUseId,
    preview: previewFromTool(toolName, input),
  });
  const decision = await pending;
  live.approvals.delete(uiId);
  if (!isCurrent(live.admission)) return;
  emit({ type: "approval.resolved", requestId: uiId, decision });
  if (decision === "cancelled") return;
  await writeJson(
    live,
    buildControlResponse(
      control.requestId,
      toClaudePermissionResult(
        live.cancelled ||
          live.muteUpdates ||
          live.admission.generation !== generation
          ? "deny"
          : decision,
        input,
      ),
    ),
  ).catch(() => undefined);
}

function allocateApprovalUiId(): number {
  if (nextApprovalUiId >= Number.MAX_SAFE_INTEGER)
    throw new Error("Claude UI request capacity exceeded");
  return nextApprovalUiId++;
}

function applyKnownToolInput(
  live: Live,
  toolName: string,
  input: Record<string, unknown>,
  callId?: string,
): void {
  if (!callId || Object.keys(input).length === 0) return;
  const existing = live.toolsById.get(callId);
  if (existing) {
    existing.input = input;
    existing.title = toolTitle(toolName, input);
  }
  live.onEvent({
    type: "tool.updated",
    callId,
    title: toolTitle(toolName, input),
    kind: toolKindFromName(toolName),
    status: "pending",
    preview: previewFromTool(toolName, input),
  });
}

function waitApproval(
  live: Live,
  uiId: number,
  requestId: string,
  input: Record<string, unknown>,
): Promise<ApprovalOutcome> {
  return new Promise((resolve) => {
    live.approvals.set(uiId, { requestId, input, resolve });
  });
}

function waitQuestion(
  live: Live,
  uiId: number,
  requestId: string,
): Promise<UserQuestionReply | "cancelled"> {
  return new Promise((resolve) => {
    live.questions.set(uiId, { requestId, resolve });
  });
}

function emitTaskListIfNeeded(
  live: Live,
  toolName: string,
  input: Record<string, unknown>,
): void {
  if (!isTodoTool(toolName)) return;
  const items = taskListFromTodos(input);
  if (items) live.onEvent({ type: "tasks.updated", items });
}

function handleAgentLifecycle(
  live: Live,
  rec: Record<string, unknown>,
): boolean {
  const started = parseTaskStarted(rec);
  if (started) {
    if (started.ambient || !isAgentTaskType(started.taskType)) return true;
    live.agentTasks.set(started.taskId, {
      taskId: started.taskId,
      toolUseId: started.toolUseId,
      description: started.description,
      backgrounded: started.backgrounded,
    });
    upsertAgentTool(
      live,
      started.toolUseId,
      started.description,
      "in_progress",
    );
    return true;
  }

  const progress = parseTaskProgress(rec);
  if (progress) {
    const task = live.agentTasks.get(progress.taskId);
    const title = progress.description || task?.description || "Subagent";
    const detail =
      progress.summary ||
      progress.lastToolName ||
      (progress.subagentType
        ? `${progress.subagentType.replace(/[_-]+/g, " ")} subagent`
        : undefined);
    upsertAgentTool(
      live,
      progress.toolUseId ?? task?.toolUseId,
      title,
      "in_progress",
      detail,
    );
    return true;
  }

  const updated = parseTaskUpdated(rec);
  if (updated) {
    const task = live.agentTasks.get(updated.taskId);
    if (task && updated.backgrounded !== undefined) {
      task.backgrounded = updated.backgrounded;
    }
    if (task && updated.description) task.description = updated.description;
    if (isTerminalAgentTaskStatus(updated.status)) {
      completeAgentTask(
        live,
        updated.taskId,
        updated.status === "completed" ? "completed" : "failed",
        updated.error,
      );
    }
    return true;
  }

  const notice = parseTaskNotification(rec);
  if (notice) {
    if (!notice.ambient) {
      completeAgentTask(
        live,
        notice.taskId,
        notice.status === "completed" ? "completed" : "failed",
        notice.summary || undefined,
      );
    }
    return true;
  }

  const liveTasks = parseBackgroundAgentTasks(rec);
  if (!liveTasks) return false;
  const next = new Set(liveTasks.map((task) => task.taskId));
  for (const id of [...live.agentTasks.keys()]) {
    if (!next.has(id)) completeAgentTask(live, id, "completed");
  }
  for (const row of liveTasks) {
    if (live.agentTasks.has(row.taskId)) continue;
    // The list carries no tool_use_id and often lands before task_started, so
    // find the Agent call that spawned it rather than opening a second row.
    const toolUseId = unclaimedAgentCall(live, row.description);
    live.agentTasks.set(row.taskId, {
      taskId: row.taskId,
      toolUseId,
      description: row.description,
      backgrounded: true,
    });
    upsertAgentTool(live, toolUseId, row.description, "in_progress");
  }
  maybeFinishTurn(live);
  return true;
}

function handleToolProgress(live: Live, rec: Record<string, unknown>): void {
  const progress = parseToolProgress(rec);
  if (!progress) return;
  const tool =
    live.toolsById.get(progress.toolUseId) ??
    (progress.parentToolUseId
      ? live.toolsById.get(progress.parentToolUseId)
      : undefined);
  if (!tool || !isAgentToolName(tool.name)) return;
  live.onEvent({
    type: "tool.updated",
    callId: tool.id,
    title: tool.title,
    kind: "agent",
    status: "in_progress",
  });
  // Progress names the call in flight. That is a step in the run, not the
  // result of it, so it goes to the panel rather than onto the Agent row.
  if (progress.toolName) {
    live.onEvent({
      type: "agent.step",
      callId: tool.id,
      stepId: progress.toolUseId,
      kind: "tool",
      text: progress.toolName,
      status: "in_progress",
      ...(progress.subagentType ? { agentType: progress.subagentType } : {}),
    });
  }
}

/**
 * The Agent call a subagent message belongs to, or nothing when the message
 * came from somewhere the parent transcript has no row for.
 */
function subagentParent(
  live: Live,
  rec: Record<string, unknown>,
): InFlightTool | undefined {
  const parentId = stringField(rec, "parent_tool_use_id");
  if (!parentId) return undefined;
  const parent = live.toolsById.get(parentId);
  if (!parent || !isAgentToolName(parent.name)) return undefined;
  return parent;
}

/**
 * A call a subagent made, mirrored onto the Agent row that spawned it. The
 * parent keeps its own "still running" status; the step is what the panel
 * under that row reads back.
 */
function noteSubagentTool(
  live: Live,
  rec: Record<string, unknown>,
  id: string,
  name: string,
  input: Record<string, unknown>,
): void {
  const parent = subagentParent(live, rec);
  if (!parent) return;
  const title = toolTitle(name, input);
  // No detail: the Agent row's detail is the report the run hands back, and
  // writing the call of the moment there would leave whatever the subagent
  // happened to do last standing in as its result.
  live.onEvent({
    type: "tool.updated",
    callId: parent.id,
    title: parent.title,
    kind: "agent",
    status: "in_progress",
  });
  if (!id) return;
  const preview = previewFromTool(name, input);
  live.onEvent({
    type: "agent.step",
    callId: parent.id,
    stepId: id,
    kind: "tool",
    text: title,
    toolKind: toolKindFromName(name),
    status: "in_progress",
    ...(preview ? { preview } : {}),
  });
}

/**
 * What a subagent said and thought on its way through the work. Its prose
 * never joins the parent transcript — that would read as the main agent
 * talking — but it is the most legible thing in the panel for its own row.
 */
function noteSubagentNarration(live: Live, rec: Record<string, unknown>): void {
  const parent = subagentParent(live, rec);
  if (!parent) return;
  const model = stringField(asRecord(rec.message), "model");
  if (model)
    live.onEvent({
      type: "tool.updated",
      callId: parent.id,
      kind: "agent",
      agentModel: model,
    });
  const messageId = assistantMessageId(rec) ?? crypto.randomUUID();
  const thinking = assistantThinkingBlocks(rec).join("").trim();
  if (thinking) {
    live.onEvent({
      type: "agent.step",
      callId: parent.id,
      stepId: `${messageId}:thinking`,
      kind: "reasoning",
      text: thinking,
    });
  }
  const text = assistantTextBlocks(rec).join("").trim();
  if (text) {
    live.onEvent({
      type: "agent.step",
      callId: parent.id,
      stepId: `${messageId}:text`,
      kind: "message",
      text,
    });
  }
}

/** Settles the subagent's own tool rows once their results come back. */
function noteSubagentResults(live: Live, rec: Record<string, unknown>): void {
  const parent = subagentParent(live, rec);
  if (!parent) return;
  for (const result of toolResultsFromUserMessage(rec)) {
    live.onEvent({
      type: "agent.step",
      callId: parent.id,
      stepId: result.toolUseId,
      kind: "tool",
      text: "",
      status: result.isError ? "failed" : "completed",
      ...(result.isError && result.text ? { detail: result.text } : {}),
    });
  }
}

function isBackgroundedAgentTool(live: Live, toolUseId: string): boolean {
  for (const task of live.agentTasks.values()) {
    if (task.toolUseId === toolUseId && task.backgrounded) return true;
  }
  return false;
}

/** The latest Agent call with this description that no task has claimed yet. */
function unclaimedAgentCall(
  live: Live,
  description: string,
): string | undefined {
  const claimed = new Set(
    [...live.agentTasks.values()].map((task) => task.toolUseId),
  );
  let match: string | undefined;
  for (const tool of live.toolsById.values()) {
    if (!isAgentToolName(tool.name) || claimed.has(tool.id)) continue;
    if (stringField(tool.input, "description") === description) match = tool.id;
  }
  return match;
}

function upsertAgentTool(
  live: Live,
  callId: string | undefined,
  title: string,
  status: string,
  detail?: string,
): void {
  const id = callId ?? `agent:${title}`;
  const existing = live.toolsById.get(id);
  if (!existing) {
    live.toolsById.set(id, {
      id,
      name: "Agent",
      input: {},
      partialJson: "",
      title,
    });
    live.onEvent({
      type: "tool.started",
      callId: id,
      title,
      kind: "agent",
      status,
    });
    if (
      status !== "in_progress" &&
      status !== "pending" &&
      status !== "running"
    ) {
      live.onEvent({
        type: "tool.updated",
        callId: id,
        title,
        kind: "agent",
        status,
        ...(detail ? { detail } : {}),
      });
    }
    return;
  }
  if (title) existing.title = title;
  live.onEvent({
    type: "tool.updated",
    callId: id,
    title: existing.title,
    kind: "agent",
    status,
    ...(detail ? { detail } : {}),
  });
}

function completeAgentTask(
  live: Live,
  taskId: string,
  status: string,
  detail?: string,
): void {
  const task = live.agentTasks.get(taskId);
  live.agentTasks.delete(taskId);
  if (task) {
    upsertAgentTool(live, task.toolUseId, task.description, status, detail);
  }
  maybeFinishTurn(live);
}

function maybeFinishTurn(live: Live): void {
  if (!live.turnResultSeen) return;
  if (live.agentTasks.size > 0) return;
  if (!live.activeTurn && !live.turnDone) return;
  finishActiveTurn(live, [
    { type: "message.completed" },
    { type: "reasoning.completed" },
  ]);
}

function finishActiveTurn(live: Live, extraEvents: HarnessEvent[] = []): void {
  const generation = live.admission.generation;
  const wasActive = live.activeTurn;
  live.turnEndPending = false;
  live.activeTurn = false;
  const done = live.turnDone;
  const failed = live.turnFailed;
  live.turnDone = null;
  live.turnFailed = null;
  try {
    for (const event of extraEvents) live.onEvent(event);
  } finally {
    if (done) done();
    else if (
      !failed &&
      wasActive &&
      isCurrent(live.admission) &&
      live.admission.generation === generation
    )
      live.turnEndPending = true;
  }
}

function settlePendingTurn(live: Live): void {
  if (!live.turnEndPending || !live.turnDone) return;
  finishActiveTurn(live);
}

function markInitialized(live: Live): void {
  if (live.initialized) return;
  live.initialized = true;
  live.initDone?.();
  live.initDone = null;
}

function waitForInit(live: Live, timeoutMs: number): Promise<void> {
  if (live.initialized) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      live.initDone = null;
      resolve();
    }, timeoutMs);
    live.initDone = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function nextControlId(live: Live): string {
  live.nextControlId += 1;
  return `monocode_${live.nextControlId}`;
}

async function writeJson(
  live: Live,
  payload: Record<string, unknown>,
): Promise<void> {
  const admission = live.admission;
  guardUsable(admission);
  const line = JSON.stringify(payload);
  guardUsable(admission);
  const handle = live.admission.handle;
  if (!handle) throw new Error("Claude session was retired");
  if (pendingWrites >= MAX_PENDING_WRITES) {
    const error = new Error(
      "Claude write capacity exceeded. Stop this session before retrying.",
    );
    recordWriterFailure(admission, error);
    throw error;
  }
  pendingWrites += 1;
  try {
    await handle.write(line);
  } catch (reason) {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    recordWriterFailure(admission, error);
    throw error;
  } finally {
    pendingWrites -= 1;
  }
}

function settingsKeyFor(input: HarnessSessionInput): string {
  return `${input.providerAccountId ?? "default"}:${claudeSettingsKey({
    model: nativeModelId(input.model),
    effort: input.modelSettings?.effort,
    fast: input.modelSettings?.fast,
    thinking: input.modelSettings?.thinking,
    context: input.modelSettings?.context,
    runtimeMode: input.runtimeMode,
    hooks: loadClaudeHooks(),
  })}`;
}

function launchOptions(
  input: HarnessSessionInput,
  resume: string | undefined,
  sessionId: string,
): {
  model?: string;
  effort?: string;
  permissionMode?: ReturnType<typeof runtimeModeToPermission>;
  resume?: string;
  sessionId?: string;
  settings?: ClaudeCliSettings;
} {
  const native = nativeModelId(input.model);
  const effortRaw = input.modelSettings?.effort;
  const context = input.modelSettings?.context;
  const settings: ClaudeCliSettings = {};
  if (input.modelSettings?.thinking === "true") {
    settings.alwaysThinkingEnabled = true;
  }
  if (input.modelSettings?.fast === "true") {
    settings.fastMode = true;
  }
  if (isClaudeUltracodeEffort(effortRaw)) {
    settings.ultracode = true;
  }
  if (!loadClaudeHooks()) {
    settings.disableAllHooks = true;
  }
  return {
    model: resolveClaudeApiModelId(native, context),
    effort: normalizeClaudeCliEffort(effortRaw, native),
    permissionMode:
      input.intent === "plan"
        ? "plan"
        : runtimeModeToPermission(input.runtimeMode),
    resume,
    sessionId: resume ? undefined : sessionId,
    settings: Object.keys(settings).length > 0 ? settings : undefined,
  };
}

/** Exported for tests. */
export function __claudeTestReset(): void {
  admissions.clear();
  nextApprovalUiId = 1;
  liveByThread.clear();
  resumeByThread.clear();
  tasksByThread.clear();
  cancelledThreads.clear();
}
