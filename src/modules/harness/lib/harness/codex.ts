import { deleteGeneratedImages, saveGeneratedImage } from "../fs";
import { nativeModelId } from "../models";
import { sameProviderAccountId } from "../providerAccounts";
import type { RuntimeMode } from "../session";
import { isRemoteProjectPath } from "@/modules/harness/lib/recents";
import { parseRemotePath } from "@/modules/connections/model/remoteProjects";
import {
  assertHarnessMemoryTarget,
  type HarnessMemoryTurnSource,
  type PreparedHarnessMemory,
} from "@/modules/harness/lib/harnessMemoryDelivery";
import { questionPromptTitle, type UserQuestionReply } from "../userQuestion";
import {
  closeRetiredRawChildren,
  reserveRawChild,
  resolveCodexBinary,
  type RawChildHandle,
} from "./child";
import {
  asRecord,
  buildThreadStartParams,
  buildTurnStartParams,
  buildTurnSteerParams,
  codexSubagentStates,
  codexSubagentThreadIds,
  isRecoverableThreadResumeError,
  mapApprovalRequest,
  mapCodexNotification,
  mapCodexSubagentSteps,
  stringField,
  toCodexApprovalDecision,
  type CodexApprovalKind,
} from "./codexProtocol";
import { JsonRpcClient, type JsonRpcId } from "./jsonRpc";
import {
  codexAsyncQuestions,
  codexAsyncQuestionResponse,
  codexQuestions,
  codexQuestionResponse,
} from "./codexQuestions";
import { codexMcpConfirmation } from "./codexElicitation";
import { joinStreamText, snapshotRemainder } from "./streamText";
import type {
  ApprovalDecision,
  CompactContextInput,
  HarnessEvent,
  HarnessSessionInput,
  RewindLastTurnInput,
  RewindLastTurnResult,
  SendTurnInput,
  SteerTurnInput,
} from "./types";

type ApprovalOutcome = ApprovalDecision | "cancelled";

type PendingApproval = {
  rpcId: JsonRpcId;
  kind: CodexApprovalKind;
  resolve: (decision: ApprovalOutcome) => void;
};

type PendingQuestion = {
  rpcId: JsonRpcId | null;
  turnId?: string;
  sending?: boolean;
  event: Extract<HarnessEvent, { type: "question.asked" }>;
  isBlocking: boolean;
  timer?: ReturnType<typeof setTimeout>;
  resolve: (reply: UserQuestionReply | "cancelled") => void;
};

// Match Codex's non-blocking question policy: a minute of grace, then a
// minute of countdown. Interaction keeps the question open for the user.
const QUESTION_AUTO_RESOLVE_MS = 120_000;

type Live = {
  memoryContext: object | null;
  child: CodexChild;
  rpc: JsonRpcClient;
  threadId: string;
  cwd: string;
  providerAccountId?: string;
  runtimeMode: RuntimeMode;
  planning: boolean;
  onEvent: (event: HarnessEvent) => void;
  approvals: Map<number, PendingApproval>;
  questions: Map<number, PendingQuestion>;
  visibleQuestionId: number | null;
  nextApprovalUiId: number;
  cancelled: boolean;
  muteUpdates: boolean;
  activeTurnId: string | null;
  turns: Promise<void>;
  /** Resolves when the current turn completes (or is cancelled). */
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  /** turn/completed arrived before runTurn registered turnDone. */
  turnEndPending: boolean;
  emittedAssistant: string;
  emittedReasoning: string;
  emittedGeneratedImages: Set<string>;
  emittedAsyncQuestions: Set<string>;
  turnGeneration: number;
  notificationQueue: Promise<void> | null;
  subagentThreads: Map<string, string>;
  pendingSubagent: Map<string, Array<{ method: string; params: unknown }>>;
  openAgentRows: Map<string, string>;
};

function trackNotificationQueue(live: Live, queued: Promise<void>): void {
  live.notificationQueue = queued;
  void queued.then(() => {
    if (live.notificationQueue === queued) live.notificationQueue = null;
  });
}

type Resume = {
  threadId: string;
  cwd: string;
  providerAccountId?: string;
};

type CodexChild = {
  handle: RawChildHandle;
  cwd: string;
  providerAccountId?: string;
  rpc: JsonRpcClient | null;
  live: Live | null;
  opening?: Promise<Live>;
  cancelled: boolean;
};

const liveByThread = new Map<string, Live>();
const childByThread = new Map<string, CodexChild>();
const resumeByThread = new Map<string, Resume>();
const cancelledThreads = new Set<string>();

function ownsChild(child: CodexChild): boolean {
  return (
    !child.handle.retired &&
    childByThread.get(child.handle.logicalSessionId) === child
  );
}

function isCurrentLive(live: Live): boolean {
  return (
    ownsChild(live.child) &&
    liveByThread.get(live.child.handle.logicalSessionId) === live
  );
}

function assertChild(child: CodexChild): void {
  if (!ownsChild(child)) throw new Error("Codex session was retired");
}

function canResolveRequest(live: Live): boolean {
  return (
    isCurrentLive(live) ||
    !childByThread.has(live.child.handle.logicalSessionId)
  );
}

function closeChild(child: CodexChild, error?: Error): Promise<void> {
  const id = child.handle.logicalSessionId;
  if (childByThread.get(id) === child) childByThread.delete(id);
  const current = child.live;
  if (current && liveByThread.get(id) === current) liveByThread.delete(id);
  if (current) {
    current.muteUpdates = true;
    if (!error) current.cancelled = true;
    clearServerRequests(current);
    if (error) current.turnFailed?.(error);
    else current.turnDone?.();
    current.turnDone = null;
    current.turnFailed = null;
  }
  child.rpc?.close(error);
  return child.handle.close().catch(() => undefined);
}

let resolveCodexBinaryImpl: () => Promise<{ path: string }> =
  resolveCodexBinary;

/** Test seam. */
export function setCodexBinaryResolver(
  fn: () => Promise<{ path: string }>,
): void {
  resolveCodexBinaryImpl = fn;
}

function snapshotSessionInput<T extends HarnessSessionInput>(input: T): T {
  return {
    ...input,
    networkAllowlist: input.networkAllowlist
      ? [...input.networkAllowlist]
      : input.networkAllowlist,
    modelSettings: input.modelSettings
      ? { ...input.modelSettings }
      : input.modelSettings,
  };
}

export async function sendCodexTurn(request: SendTurnInput): Promise<void> {
  assertHarnessMemoryTarget(request.projectMemory, request.cwd);
  const input = {
    ...snapshotSessionInput(request),
    attachments: request.attachments?.map((attachment) => ({ ...attachment })),
  };
  const live = await ensureLive(input);
  assertChild(live.child);
  if (live.child.cancelled) {
    live.child.cancelled = false;
    return;
  }

  live.onEvent = input.onEvent;
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      if (!isCurrentLive(live)) return;
      live.runtimeMode = input.runtimeMode;
      live.planning = input.intent === "plan";
      live.cancelled = false;
      live.muteUpdates = false;
      try {
        await runTurn(live, input);
      } catch (error) {
        if (live.cancelled) return;
        throw error;
      }
    });
  await live.turns;
}

export async function compactCodexContext(
  request: CompactContextInput,
): Promise<void> {
  const input = snapshotSessionInput(request);
  const live = await ensureLive(input);
  assertChild(live.child);
  if (live.child.cancelled) {
    live.child.cancelled = false;
    return;
  }

  live.onEvent = input.onEvent;
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      if (!isCurrentLive(live)) return;
      live.cancelled = false;
      live.muteUpdates = false;
      try {
        await runCompaction(live);
      } catch (error) {
        if (live.cancelled) return;
        throw error;
      }
    });
  await live.turns;
}

export async function rewindCodexLastTurn(
  request: RewindLastTurnInput,
): Promise<RewindLastTurnResult> {
  const input = snapshotSessionInput(request);
  const live = await ensureLive(input);
  assertChild(live.child);
  if (live.child.cancelled) {
    live.child.cancelled = false;
    return { submitted: false };
  }

  live.onEvent = input.onEvent;
  await live.turns;
  assertChild(live.child);
  if (live.activeTurnId) {
    throw new Error("Stop the current turn before editing the last message");
  }

  const beforeTurnId = await lastUserTurnId(live, input.providerTurnId);
  assertChild(live.child);
  live.memoryContext = null;
  await live.rpc.request("thread/revert", {
    threadId: live.threadId,
    beforeTurnId,
  });
  return { submitted: false };
}

async function lastUserTurnId(
  live: Live,
  providerTurnId?: string,
): Promise<string> {
  const exact = providerTurnId?.trim();
  if (exact) return exact;

  const page = await live.rpc.request<{ data?: unknown[] }>(
    "thread/turns/list",
    {
      threadId: live.threadId,
      limit: 100,
      sortDirection: "desc",
      itemsView: "summary",
    },
  );
  assertChild(live.child);
  const turns = Array.isArray(page.data) ? page.data : [];
  const userTurn = turns.find((candidate) => {
    const turn = asRecord(candidate);
    return (
      Array.isArray(turn?.items) &&
      turn.items.some(
        (item) => stringField(asRecord(item), "type") === "userMessage",
      )
    );
  });
  const latest = asRecord(userTurn);
  const turnId = stringField(latest, "id");
  if (!turnId) throw new Error("Codex did not expose a user turn id to edit");
  return turnId;
}

export async function steerCodexTurn(input: SteerTurnInput): Promise<void> {
  assertHarnessMemoryTarget(input.projectMemory, input.cwd);
  const live = liveByThread.get(input.sessionId);
  if (!live) throw new Error("No active Codex session");
  const turnId = live.activeTurnId;
  if (!turnId) throw new Error("No active turn to steer");

  const params = buildTurnSteerParams({
    threadId: live.threadId,
    expectedTurnId: turnId,
    prompt: input.text.trim() || undefined,
    attachments: input.attachments,
  });
  if (
    !params.input ||
    (Array.isArray(params.input) && params.input.length === 0)
  ) {
    return;
  }

  const memory = input.projectMemory
    ? await prepareCodexMemory(live, input.projectMemory)
    : null;
  if (memory?.prefix && Array.isArray(params.input))
    params.input.unshift({ type: "text", text: memory.prefix });
  try {
    memory?.assertCurrent();
    memory?.issued();
    await live.rpc.request("turn/steer", params);
    memory?.acknowledge();
  } finally {
    memory?.settle();
  }
  assertChild(live.child);
  live.onEvent({ type: "turn.started", providerTurnId: turnId });
}

export function respondCodexApproval(
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  const live = liveByThread.get(sessionId);
  const pending = live?.approvals.get(requestId);
  if (!pending) return;
  pending.resolve(decision);
}

export function respondCodexQuestion(
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  const live = liveByThread.get(sessionId);
  const pending = live?.questions.get(requestId);
  if (!live || !pending || pending.sending) return;
  if (pending.rpcId !== null || reply.kind === "skipped") {
    pending.resolve(reply);
    return;
  }
  const text = codexAsyncQuestionResponse(pending.event.questions, reply);
  if (!text) {
    pending.resolve({ kind: "skipped" });
    return;
  }
  const turnId = pending.turnId;
  if (!turnId || live.activeTurnId !== turnId) {
    pending.resolve("cancelled");
    return;
  }
  pending.sending = true;
  keepCodexQuestionOpen(sessionId, requestId);
  void live.rpc
    .request(
      "turn/steer",
      buildTurnSteerParams({
        threadId: live.threadId,
        expectedTurnId: turnId,
        prompt: text,
      }),
    )
    .then(() => {
      if (isCurrentLive(live) && live.questions.get(requestId) === pending)
        pending.resolve(reply);
    })
    .catch((error: unknown) => {
      if (!isCurrentLive(live)) return;
      pending.sending = false;
      if (live.questions.get(requestId) !== pending) return;
      live.onEvent({
        type: "status",
        text: error instanceof Error ? error.message : String(error),
      });
    });
}

export function keepCodexQuestionOpen(
  sessionId: string,
  requestId: number,
): void {
  const live = liveByThread.get(sessionId);
  const pending = live?.questions.get(requestId);
  if (!live || !pending || pending.timer === undefined) return;
  clearTimeout(pending.timer);
  pending.timer = undefined;
  live.onEvent({ type: "question.updated", requestId });
}

function clearServerRequests(live: Live): void {
  for (const pending of live.approvals.values()) pending.resolve("cancelled");
  for (const pending of live.questions.values()) {
    clearTimeout(pending.timer);
    pending.resolve("cancelled");
  }
  live.approvals.clear();
  live.questions.clear();
  live.visibleQuestionId = null;
}

function showNextQuestion(live: Live): void {
  if (
    live.visibleQuestionId !== null &&
    live.questions.has(live.visibleQuestionId)
  )
    return;
  const next = live.questions.entries().next().value;
  live.visibleQuestionId = next?.[0] ?? null;
  if (next) {
    const pending = next[1];
    if (!pending.isBlocking) {
      pending.event.autoResolveAt = Date.now() + QUESTION_AUTO_RESOLVE_MS;
      pending.timer = setTimeout(
        () => pending.resolve({ kind: "skipped" }),
        QUESTION_AUTO_RESOLVE_MS,
      );
    }
    live.onEvent(pending.event);
  }
}

export async function cancelCodexTurn(sessionId: string): Promise<void> {
  const live = liveByThread.get(sessionId);
  if (!live) {
    const child = childByThread.get(sessionId);
    if (child) child.cancelled = true;
    else cancelledThreads.add(sessionId);
    return;
  }
  if (!isCurrentLive(live)) return;
  live.cancelled = true;
  live.muteUpdates = true;
  clearServerRequests(live);
  const turnId = live.activeTurnId;
  if (turnId) {
    await live.rpc
      .request("turn/interrupt", {
        threadId: live.threadId,
        turnId,
      })
      .catch(() => undefined);
  }
  if (!isCurrentLive(live)) return;
  finishActiveTurn(live, [
    { type: "message.completed" },
    { type: "reasoning.completed" },
  ]);
}

export async function stopCodexSession(sessionId: string): Promise<void> {
  cancelledThreads.delete(sessionId);
  const current = childByThread.get(sessionId);
  const closing = current ? closeChild(current) : Promise.resolve();
  const retired = closeRetiredRawChildren(sessionId).catch(() => undefined);
  await Promise.all([closing, retired]);
}

export function forgetCodexSession(sessionId: string): Promise<void> {
  resumeByThread.delete(sessionId);
  return stopCodexSession(sessionId);
}

export function bindCodexSession(
  threadId: string,
  providerSessionId: string,
  cwd: string,
  providerAccountId?: string,
): void {
  const providerThreadId = providerSessionId.trim();
  if (!threadId || !providerThreadId || !cwd.trim()) return;
  resumeByThread.set(threadId, {
    threadId: providerThreadId,
    cwd,
    providerAccountId,
  });
}

function ensureLive(input: HarnessSessionInput): Promise<Live> {
  const existing = liveByThread.get(input.sessionId);
  const previous = childByThread.get(input.sessionId);
  const matching =
    previous &&
    ownsChild(previous) &&
    previous.cwd === input.cwd &&
    sameProviderAccountId(previous.providerAccountId, input.providerAccountId);
  if (matching && existing && isCurrentLive(existing)) {
    existing.onEvent = input.onEvent;
    return Promise.resolve(existing);
  }
  if (matching && previous.opening) return previous.opening;

  const handle = reserveRawChild(input.sessionId);
  if (handle.retired) throw new Error("Codex session was retired");
  const child: CodexChild = {
    handle,
    cwd: input.cwd,
    providerAccountId: input.providerAccountId,
    rpc: null,
    live: null,
    cancelled: cancelledThreads.delete(input.sessionId),
  };
  childByThread.set(input.sessionId, child);
  if (previous) {
    if (
      previous.cwd !== input.cwd ||
      !sameProviderAccountId(
        previous.providerAccountId,
        input.providerAccountId,
      )
    ) {
      resumeByThread.delete(input.sessionId);
    }
    void closeChild(previous);
  }
  child.opening = startLive(input, child);
  return child.opening;
}

async function startLive(
  input: HarnessSessionInput,
  child: CodexChild,
): Promise<Live> {
  const resume = resumeByThread.get(input.sessionId);
  const canResume =
    resume != null &&
    resume.cwd === input.cwd &&
    sameProviderAccountId(resume.providerAccountId, input.providerAccountId);
  if (
    resume &&
    (resume.cwd !== input.cwd ||
      !sameProviderAccountId(resume.providerAccountId, input.providerAccountId))
  ) {
    resumeByThread.delete(input.sessionId);
  }

  try {
    const isRemote = isRemoteProjectPath(input.cwd);
    const { path } = isRemote
      ? { path: "codex" }
      : await resolveCodexBinaryImpl();
    assertChild(child);
    const liveRef: { current: Live | null } = { current: null };

    const rpc = new JsonRpcClient(
      child.handle.nativeId,
      {
        onNotification: (method, params) => {
          const live = liveRef.current;
          if (!ownsChild(child) || !live || live.muteUpdates) return;
          if (live.notificationQueue) {
            const turnGeneration = live.turnGeneration;
            const queued = live.notificationQueue
              .catch(() => undefined)
              .then(() => {
                if (
                  !ownsChild(child) ||
                  live.muteUpdates ||
                  live.cancelled ||
                  turnGeneration !== live.turnGeneration
                ) {
                  return;
                }
                return handleNotification(live, method, params);
              });
            trackNotificationQueue(
              live,
              queued.catch(() => undefined),
            );
            return;
          }
          const result = handleNotification(live, method, params);
          if (!result) return;
          trackNotificationQueue(
            live,
            result.catch(() => undefined),
          );
        },
        onRequest: (id, method, params) => {
          if (!ownsChild(child)) return;
          const live = liveRef.current;
          // The external clock can be requested before thread/start or resume
          // returns, so it must not depend on the live session being bound.
          const response =
            method === "currentTime/read"
              ? rpc.respond(id, {
                  currentTimeAt: Math.floor(Date.now() / 1000),
                })
              : live
                ? handleServerRequest(live, id, method, params)
                : undefined;
          void response?.catch((error: unknown) => {
            if (ownsChild(child) && !live?.muteUpdates)
              (live?.onEvent ?? input.onEvent)({
                type: "session.error",
                message: error instanceof Error ? error.message : String(error),
              });
          });
        },
      },
      { includeJsonrpc: false, label: "codex", write: child.handle.write },
    );
    child.rpc = rpc;

    let lastStderr = "";
    child.handle.watch(
      (line) => {
        if (ownsChild(child)) rpc.pushLine(line);
      },
      (code) => {
        if (!ownsChild(child)) return;
        const exitError = new Error(
          lastStderr.trim() || "Codex app-server exited",
        );
        const emit = liveRef.current?.onEvent ?? input.onEvent;
        void closeChild(child, exitError);
        emit({ type: "session.ended", code });
      },
      (stderrLine) => {
        if (ownsChild(child)) lastStderr = stderrLine;
      },
    );

    await child.handle.spawn(
      path,
      ["app-server"],
      input.cwd,
      input.networkAllowlist,
      {
        provider: "codex",
        id: input.providerAccountId ?? "default",
      },
    );

    assertChild(child);
    await rpc.request("initialize", {
      clientInfo: {
        name: "voktty",
        title: "Voktty",
        version: "1.0.10",
      },
      capabilities: {
        // Required by collaborationMode (including Plan); currentTime/read is
        // handled above even while the thread is starting or resuming.
        experimentalApi: true,
      },
    });
    assertChild(child);
    await rpc.notify("initialized", undefined);
    assertChild(child);

    const model = nativeModelId(input.model);
    const serviceTier = input.modelSettings?.serviceTier;
    const effort = input.modelSettings?.reasoningEffort;
    const effectiveCwd = parseRemotePath(input.cwd)?.hostPath ?? input.cwd;

    let threadId: string | undefined;
    let didResume = false;

    if (canResume && resume) {
      try {
        const opened = await rpc.request<{ thread?: { id?: string } }>(
          "thread/resume",
          {
            threadId: resume.threadId,
            ...buildThreadStartParams({
              cwd: effectiveCwd,
              runtimeMode: input.runtimeMode,
              model,
              serviceTier,
            }),
          },
        );
        assertChild(child);
        threadId = opened.thread?.id ?? resume.threadId;
        didResume = true;
      } catch (error) {
        assertChild(child);
        if (!isRecoverableThreadResumeError(error)) throw error;
        threadId = undefined;
      }
    }

    if (!threadId) {
      const opened = await rpc.request<{ thread?: { id?: string } }>(
        "thread/start",
        buildThreadStartParams({
          cwd: effectiveCwd,
          runtimeMode: input.runtimeMode,
          model,
          serviceTier,
        }),
      );
      assertChild(child);
      threadId = opened.thread?.id?.trim();
    }

    if (!threadId) throw new Error("Codex did not return a thread id");

    // Suppress unused warning for effort until first turn applies it.
    void effort;

    const live: Live = {
      memoryContext: null,
      child,
      rpc,
      threadId,
      cwd: input.cwd,
      providerAccountId: input.providerAccountId,
      runtimeMode: input.runtimeMode,
      planning: input.intent === "plan",
      onEvent: input.onEvent,
      approvals: new Map(),
      questions: new Map(),
      visibleQuestionId: null,
      nextApprovalUiId: 1,
      cancelled: false,
      muteUpdates: didResume,
      activeTurnId: null,
      turns: Promise.resolve(),
      turnDone: null,
      turnFailed: null,
      turnEndPending: false,
      emittedAssistant: "",
      emittedReasoning: "",
      emittedGeneratedImages: new Set(),
      emittedAsyncQuestions: new Set(),
      turnGeneration: 0,
      notificationQueue: null,
      subagentThreads: new Map(),
      pendingSubagent: new Map(),
      openAgentRows: new Map(),
    };
    assertChild(child);
    child.live = live;
    liveRef.current = live;
    liveByThread.set(input.sessionId, live);
    resumeByThread.set(input.sessionId, {
      threadId,
      cwd: input.cwd,
      providerAccountId: input.providerAccountId,
    });
    live.onEvent({
      type: "session.providerBound",
      providerSessionId: threadId,
    });
    assertChild(child);
    live.onEvent({ type: "session.started" });
    assertChild(child);
    return live;
  } catch (error) {
    await closeChild(
      child,
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
}

async function prepareCodexMemory(
  live: Live,
  source: HarnessMemoryTurnSource,
): Promise<PreparedHarnessMemory & { issued: () => void }> {
  live.memoryContext ??= {};
  const context = live.memoryContext;
  const generation = live.turnGeneration;
  const turnId = live.activeTurnId;
  let issued = false;
  const assertCurrent = () => {
    source.assertCurrent();
    if (
      !isCurrentLive(live) ||
      live.cancelled ||
      live.memoryContext !== context ||
      (!issued &&
        (live.turnGeneration !== generation || live.activeTurnId !== turnId))
    )
      throw new Error("Codex memory delivery was retired");
  };
  assertCurrent();
  const prepared = await source.prepare(context, live.threadId, assertCurrent);
  try {
    assertCurrent();
  } catch (error) {
    prepared?.settle();
    throw error;
  }
  return {
    prefix: prepared?.prefix ?? null,
    assertCurrent: () => {
      prepared?.assertCurrent();
      assertCurrent();
    },
    acknowledge: () => prepared?.acknowledge() ?? false,
    settle: () => prepared?.settle(),
    issued: () => {
      issued = true;
    },
  };
}

async function runTurn(live: Live, input: SendTurnInput): Promise<void> {
  const model = nativeModelId(input.model);
  const effort = input.modelSettings?.reasoningEffort;
  const serviceTier = input.modelSettings?.serviceTier;

  const params = buildTurnStartParams({
    threadId: live.threadId,
    runtimeMode: input.runtimeMode,
    prompt: input.text.trim() || undefined,
    attachments: input.attachments,
    model,
    effort,
    serviceTier,
    intent: input.intent,
  });

  if (Array.isArray(params.input) && params.input.length === 0) {
    return;
  }

  live.emittedAssistant = "";
  live.emittedReasoning = "";
  live.emittedGeneratedImages.clear();
  live.emittedAsyncQuestions.clear();
  live.turnGeneration += 1;

  const memory = input.projectMemory
    ? await prepareCodexMemory(live, input.projectMemory)
    : null;
  if (memory?.prefix && Array.isArray(params.input))
    params.input.unshift({ type: "text", text: memory.prefix });

  const turnPromise = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  void turnPromise.catch(() => undefined);
  settlePendingTurn(live);

  try {
    memory?.assertCurrent();
    memory?.issued();
    const response = await live.rpc.request<{ turn?: { id?: string } }>(
      "turn/start",
      params,
    );
    memory?.acknowledge();
    if (!isCurrentLive(live) || live.cancelled) return;
    input.onAccepted?.();
    if (!isCurrentLive(live)) return;
    const turnId = response.turn?.id ?? live.activeTurnId;
    // turn/completed can arrive before turn/start returns; don't resurrect a
    // finished turn's id after finishActiveTurn cleared activeTurnId.
    if (turnId && live.turnDone) {
      live.activeTurnId = live.activeTurnId ?? turnId;
      live.onEvent({ type: "turn.started", providerTurnId: turnId });
    }
    settlePendingTurn(live);
    await turnPromise;
  } catch (error) {
    if (live.cancelled) return;
    if (!isCurrentLive(live)) throw error;
    live.onEvent({
      type: "session.error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    memory?.settle();
    live.turnDone = null;
    live.turnFailed = null;
  }
}

async function runCompaction(live: Live): Promise<void> {
  live.memoryContext = null;
  live.emittedAssistant = "";
  live.emittedReasoning = "";
  live.emittedGeneratedImages.clear();
  const turnPromise = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  void turnPromise.catch(() => undefined);
  settlePendingTurn(live);

  try {
    await live.rpc.request("thread/compact/start", {
      threadId: live.threadId,
    });
    if (!isCurrentLive(live)) return;
    settlePendingTurn(live);
    await turnPromise;
  } finally {
    live.turnDone = null;
    live.turnFailed = null;
  }
}

function handleNotification(
  live: Live,
  method: string,
  params: unknown,
): void | Promise<void> {
  if (!isCurrentLive(live)) return;
  if (method === "serverRequest/resolved") {
    const rec = asRecord(params);
    if (rec?.threadId !== live.threadId) return;
    for (const pending of live.approvals.values()) {
      if (pending.rpcId === rec.requestId) pending.resolve("cancelled");
    }
    for (const pending of live.questions.values()) {
      if (pending.rpcId === rec.requestId) pending.resolve("cancelled");
    }
    return;
  }
  const rec = asRecord(params);
  if (
    (method === "thread/compacted" && rec?.threadId === live.threadId) ||
    ((method === "item/started" || method === "item/completed") &&
      rec?.threadId === live.threadId &&
      asRecord(rec.item)?.type === "contextCompaction")
  )
    live.memoryContext = null;
  // Child threads share this connection. Their lifecycle must not touch the
  // parent's turn or clear its approvals, but what they do is the inside of a
  // subagent — mirror it onto the row that spawned them.
  const threadId =
    stringField(rec, "threadId") ??
    (method === "thread/started"
      ? stringField(asRecord(rec?.thread), "id")
      : undefined);
  if (threadId && threadId !== live.threadId) {
    return handleSubagentNotification(live, threadId, method, params);
  }
  // A Codex turn is a sequence of items. Completing an agentMessage does not
  // mean the turn is over — more tools and messages can still arrive. Only
  // turn/completed (and turn/aborted) settle sendCodexTurn, which is what the
  // UI uses for busy / stop / "Working for".
  const mapped = mapCodexNotification(method, params);
  if (mapped.diagnostic) {
    console.debug(
      `[voktty] codex ${live.threadId} ${method}`,
      mapped.diagnostic,
    );
  }
  // Codex describes one spawned agent through more than one item type. The
  // first row to name a child thread owns it; a later item for the same thread
  // would otherwise stand up a second agent that never does anything.
  const duplicate = bindSubagentThreads(live, method, rec);
  const snapshot = method === "item/completed";
  let pending: Promise<void> | undefined;
  for (const event of mapped.events) {
    if (duplicate && duplicateAgentRow(event)) continue;
    if (event.type === "image.generated") {
      if (live.emittedGeneratedImages.has(event.itemId)) continue;
      live.emittedGeneratedImages.add(event.itemId);
      if ("data" in event) {
        const save = () => materializeGeneratedImage(live, event);
        pending = pending ? pending.then(save) : save();
        continue;
      }
      live.onEvent(event);
      continue;
    }
    trackAgentRow(live, event);
    if (event.type === "message.delta") {
      publishCodexText(live, "assistant", event.text, snapshot);
      continue;
    }
    if (event.type === "reasoning.delta") {
      publishCodexText(live, "reasoning", event.text, snapshot);
      continue;
    }
    live.onEvent(event);
  }
  if (method === "item/completed") showCodexAsyncQuestion(live, rec);
  // Metadata and steps can arrive before the spawn. Create its row first.
  let replay: Promise<void> | undefined;
  for (const childId of codexSubagentThreadIds(asRecord(rec?.item) ?? {})) {
    const owner = live.subagentThreads.get(childId);
    if (!owner) continue;
    const backlog = live.pendingSubagent.get(childId);
    live.pendingSubagent.delete(childId);
    for (const pendingStep of backlog ?? []) {
      const emit = () =>
        emitSubagentSteps(live, owner, pendingStep.method, pendingStep.params);
      if (replay) {
        replay = replay.then(emit);
      } else {
        const result = emit();
        if (result) replay = result;
      }
    }
  }
  const finish = () => {
    if (!isCurrentLive(live)) return;
    settleSubagentRows(live, rec);
    if (mapped.activeTurnId !== undefined) {
      live.activeTurnId = mapped.activeTurnId;
    }
    if (mapped.turnCompleted) {
      finishActiveTurn(live);
    }
  };
  const afterImages = () => {
    if (live.muteUpdates || live.cancelled) return;
    if (replay) return replay.then(finish);
    finish();
  };
  if (pending) return pending.then(afterImages);
  return afterImages();
}

/**
 * How many notifications a not-yet-identified child thread may bank. Codex can
 * stream a subagent's first calls before the spawn item reports which thread it
 * created, and those calls are the most interesting ones — but an unrecognised
 * thread must not be able to grow this without bound.
 */
const MAX_PENDING_SUBAGENT = 64;

/**
 * Learns which agent row a child thread belongs to.
 * Returns true when every thread this item names already belongs to another
 * row, which makes the item a second description of an agent we already show.
 */
function bindSubagentThreads(
  live: Live,
  method: string,
  rec: Record<string, unknown> | null,
): boolean {
  if (method !== "item/started" && method !== "item/completed") return false;
  const item = asRecord(rec?.item);
  if (!item) return false;
  const itemType = stringField(item, "type") ?? "";
  if (itemType !== "subAgentActivity" && itemType !== "collabAgentToolCall") {
    return false;
  }
  const callId = stringField(item, "id");
  if (!callId) return false;
  const children = codexSubagentThreadIds(item).filter(
    (childId) => childId !== live.threadId,
  );
  let claimed = 0;
  for (const childId of children) {
    const owner = live.subagentThreads.get(childId);
    if (owner) {
      const model = stringField(item, "model");
      if (model && item.tool === "spawnAgent")
        live.onEvent({
          type: "tool.updated",
          callId: owner,
          kind: "agent",
          agentModel: model,
        });
      if (owner !== callId) claimed += 1;
      continue;
    }
    live.subagentThreads.set(childId, callId);
  }
  return children.length > 0 && claimed === children.length;
}

/**
 * An agent row for a child thread another row already owns. A failure still
 * gets its row — the reason a run died is the one thing worth a line of its
 * own — but a duplicate "running" or "done" is just noise.
 */
function duplicateAgentRow(event: HarnessEvent): boolean {
  if (event.type !== "tool.started" && event.type !== "tool.updated") {
    return false;
  }
  return event.kind === "agent" && event.status !== "failed";
}

/**
 * A child thread's notification. Until the spawn item says which row the thread
 * belongs to, keep it: dropping it loses the opening moves of the run.
 */
function handleSubagentNotification(
  live: Live,
  threadId: string,
  method: string,
  params: unknown,
): void | Promise<void> {
  const callId = live.subagentThreads.get(threadId);
  if (callId) {
    return emitSubagentSteps(live, callId, method, params);
  }
  if (
    method !== "item/started" &&
    method !== "item/completed" &&
    method !== "thread/started"
  )
    return;
  const backlog = live.pendingSubagent.get(threadId) ?? [];
  if (backlog.length >= MAX_PENDING_SUBAGENT) return;
  backlog.push({ method, params });
  live.pendingSubagent.set(threadId, backlog);
}

function emitSubagentSteps(
  live: Live,
  callId: string,
  method: string,
  params: unknown,
): void | Promise<void> {
  const image = mapCodexNotification(method, params).events.find(
    (event): event is Extract<HarnessEvent, { type: "image.generated" }> =>
      event.type === "image.generated",
  );
  if (image) {
    if (live.emittedGeneratedImages.has(image.itemId)) return;
    live.emittedGeneratedImages.add(image.itemId);
    if ("data" in image) return materializeGeneratedImage(live, image);
    live.onEvent(image);
    return;
  }
  for (const event of mapCodexSubagentSteps(callId, method, params)) {
    live.onEvent(event);
  }
}

function showCodexAsyncQuestion(
  live: Live,
  rec: Record<string, unknown> | null,
): void {
  const item = asRecord(rec?.item);
  const itemId = stringField(item, "id");
  const turnId = stringField(rec, "turnId") ?? live.activeTurnId;
  if (
    !itemId ||
    !turnId ||
    turnId !== live.activeTurnId ||
    live.emittedAsyncQuestions.has(itemId)
  )
    return;
  let questions: ReturnType<typeof codexAsyncQuestions>;
  try {
    questions = codexAsyncQuestions(item);
  } catch (error) {
    live.onEvent({
      type: "status",
      text: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (!questions.length) return;
  live.emittedAsyncQuestions.add(itemId);
  const uiId = live.nextApprovalUiId++;
  const event: Extract<HarnessEvent, { type: "question.asked" }> = {
    type: "question.asked",
    requestId: uiId,
    title: questionPromptTitle(questions),
    questions,
    callId: itemId,
  };
  const outcome = new Promise<UserQuestionReply | "cancelled">((resolve) => {
    live.questions.set(uiId, {
      rpcId: null,
      turnId,
      event,
      isBlocking: false,
      resolve,
    });
  }).finally(() => {
    clearTimeout(live.questions.get(uiId)?.timer);
    live.questions.delete(uiId);
  });
  showNextQuestion(live);
  void outcome.then((reply) => {
    if (!canResolveRequest(live)) return;
    live.onEvent({
      type: "question.resolved",
      requestId: uiId,
      decision:
        reply === "cancelled"
          ? "cancelled"
          : reply.kind === "answered"
            ? "answered"
            : "skipped",
    });
    showNextQuestion(live);
  });
}

async function materializeGeneratedImage(
  live: Live,
  event: Extract<HarnessEvent, { type: "image.generated"; data: string }>,
): Promise<void> {
  const turnGeneration = live.turnGeneration;
  try {
    const asset = await saveGeneratedImage({
      data: event.data,
      name: event.name,
    });
    if (
      !isCurrentLive(live) ||
      live.cancelled ||
      live.muteUpdates ||
      turnGeneration !== live.turnGeneration
    ) {
      void deleteGeneratedImages([asset.path]).catch(() => undefined);
      return;
    }
    live.onEvent({
      type: "image.generated",
      itemId: event.itemId,
      path: asset.path,
      name: event.name,
      mimeType: asset.mimeType,
      size: asset.size,
      ...(event.alt ? { alt: event.alt } : {}),
    });
  } catch (cause) {
    if (
      !isCurrentLive(live) ||
      live.cancelled ||
      live.muteUpdates ||
      turnGeneration !== live.turnGeneration
    ) {
      return;
    }
    live.onEvent({
      type: "session.error",
      message: `Could not save generated image: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    });
  }
}

/** Remembers an agent row while it runs, so the turn can close it out. */
function trackAgentRow(live: Live, event: HarnessEvent): void {
  if (event.type !== "tool.started" && event.type !== "tool.updated") return;
  if (event.kind !== "agent") return;
  if (event.status === "in_progress" || event.status === "pending") {
    live.openAgentRows.set(event.callId, event.title ?? "Subagent");
    return;
  }
  live.openAgentRows.delete(event.callId);
}

/**
 * Settles spawned agents from the per-agent state a collab item reports. The
 * spawn call returns immediately; this is the first word on whether the agent
 * it started actually finished.
 */
function settleSubagentRows(
  live: Live,
  rec: Record<string, unknown> | null,
): void {
  const item = asRecord(rec?.item);
  if (!item) return;
  for (const state of codexSubagentStates(item)) {
    const callId = live.subagentThreads.get(state.threadId);
    const title = callId ? live.openAgentRows.get(callId) : undefined;
    if (!callId || !title) continue;
    live.openAgentRows.delete(callId);
    live.onEvent({
      type: "tool.updated",
      callId,
      title,
      kind: "agent",
      status: state.status,
      ...(state.message ? { detail: state.message } : {}),
    });
  }
}

/**
 * A turn cannot end with an agent still working. Codex does not always report
 * a closing state for every child, and a row left running would hop forever.
 */
function closeOpenAgentRows(live: Live): void {
  for (const [callId, title] of live.openAgentRows) {
    live.onEvent({
      type: "tool.updated",
      callId,
      title,
      kind: "agent",
      status: "completed",
    });
  }
  live.openAgentRows.clear();
}

function publishCodexText(
  live: Live,
  role: "assistant" | "reasoning",
  text: string,
  snapshot: boolean,
): void {
  const already =
    role === "assistant" ? live.emittedAssistant : live.emittedReasoning;
  const emit = snapshot ? snapshotRemainder(already, text) : text;
  if (!emit) return;
  if (role === "assistant") {
    live.emittedAssistant = joinStreamText(already, emit);
    live.onEvent({ type: "message.delta", text: emit });
    return;
  }
  live.emittedReasoning = joinStreamText(already, emit);
  live.onEvent({ type: "reasoning.delta", text: emit });
}

function finishActiveTurn(live: Live, extraEvents: HarnessEvent[] = []): void {
  clearServerRequests(live);
  closeOpenAgentRows(live);
  live.turnEndPending = false;
  live.activeTurnId = null;
  live.emittedAssistant = "";
  live.emittedReasoning = "";
  live.emittedGeneratedImages.clear();
  live.emittedAsyncQuestions.clear();
  live.turnGeneration += 1;
  for (const event of extraEvents) {
    live.onEvent(event);
  }
  const done = live.turnDone;
  const failed = live.turnFailed;
  live.turnDone = null;
  live.turnFailed = null;
  if (done) {
    done();
    return;
  }
  if (!failed) {
    live.turnEndPending = true;
  }
}

function settlePendingTurn(live: Live): void {
  if (!live.turnEndPending || !live.turnDone) return;
  finishActiveTurn(live);
}

async function handleServerRequest(
  live: Live,
  id: JsonRpcId,
  method: string,
  params: unknown,
): Promise<void> {
  if (method === "item/tool/requestUserInput") {
    if (live.cancelled || live.muteUpdates) {
      await live.rpc.respond(id, { answers: {} });
      return;
    }
    let questions: ReturnType<typeof codexQuestions>;
    try {
      questions = codexQuestions(params);
    } catch (error) {
      live.onEvent({
        type: "status",
        text: error instanceof Error ? error.message : String(error),
      });
      await live.rpc.respond(id, { answers: {} });
      return;
    }
    const uiId = live.nextApprovalUiId++;
    const event: Extract<HarnessEvent, { type: "question.asked" }> = {
      type: "question.asked",
      requestId: uiId,
      title: questionPromptTitle(questions),
      questions,
      callId: stringField(asRecord(params), "itemId"),
    };
    const outcome = new Promise<UserQuestionReply | "cancelled">((resolve) => {
      live.questions.set(uiId, {
        rpcId: id,
        event,
        resolve,
        // Older servers omit this field and must keep their blocking behavior.
        isBlocking: asRecord(params)?.isBlocking !== false,
      });
    }).finally(() => {
      clearTimeout(live.questions.get(uiId)?.timer);
      live.questions.delete(uiId);
    });
    showNextQuestion(live);
    const reply = await outcome;
    if (!canResolveRequest(live)) return;
    live.onEvent({
      type: "question.resolved",
      requestId: uiId,
      decision:
        reply === "cancelled"
          ? "cancelled"
          : reply.kind === "answered"
            ? "answered"
            : "skipped",
    });
    showNextQuestion(live);
    if (reply !== "cancelled")
      await live.rpc.respond(id, codexQuestionResponse(questions, reply));
    return;
  }

  if (method === "mcpServer/elicitation/request") {
    const confirmation = codexMcpConfirmation(params);
    if (!confirmation || live.cancelled || live.muteUpdates) {
      if (!live.cancelled && !live.muteUpdates)
        live.onEvent({
          type: "status",
          text: "This MCP server requested a form or browser sign-in that Voktty does not support yet. Complete it in the server's own interface.",
        });
      await live.rpc.respond(id, {
        action: "cancel",
        content: null,
        _meta: null,
      });
      return;
    }
    const uiId = live.nextApprovalUiId++;
    const pending = waitApproval(live, uiId, id, "permissions");
    // MCP consent must carry the user's decision, including in Full Access.
    live.onEvent({
      type: "approval.requested",
      requestId: uiId,
      kind: "other",
      title: confirmation.title,
    });
    const decision = await pending;
    if (!canResolveRequest(live)) return;
    live.onEvent({ type: "approval.resolved", requestId: uiId, decision });
    if (decision !== "cancelled")
      await live.rpc.respond(id, {
        action: decision === "allow" ? "accept" : "decline",
        content: decision === "allow" ? confirmation.content : null,
        _meta: null,
      });
    return;
  }

  const uiId = live.nextApprovalUiId++;
  const mapped = mapApprovalRequest(method, params, uiId);
  if (!mapped) {
    // An empty success or invented denial hides protocol incompatibility.
    live.onEvent({
      type: "status",
      text: `Unsupported Codex request: ${method}`,
    });
    await live.rpc.respondError(id, {
      code: -32601,
      message: `Unsupported method: ${method}`,
    });
    return;
  }

  if (live.planning || live.cancelled || live.muteUpdates) {
    // Plan turns run in a non-escalating read-only sandbox. If an older
    // app-server still asks for broader access, deny it silently instead of
    // leaking a Supervised approval prompt into the user's selected mode.
    if (method === "item/permissions/requestApproval") {
      await live.rpc.respond(id, { permissions: {} }).catch(() => undefined);
    } else {
      await live.rpc
        .respond(id, {
          decision: toCodexApprovalDecision("deny", mapped.kind),
        })
        .catch(() => undefined);
    }
    return;
  }

  if (method === "item/permissions/requestApproval") {
    // Auto-deny extra permission grants in supervised; allow in full-access.
    if (live.runtimeMode === "full-access") {
      const rec = asRecord(params);
      const permissions = rec?.permissions ?? {};
      await live.rpc.respond(id, {
        scope: "session",
        permissions,
      });
      return;
    }
    if (live.runtimeMode === "supervised") {
      const pending = waitApproval(live, uiId, id, mapped.kind);
      live.onEvent(mapped.event);
      const decision = await pending;
      if (!canResolveRequest(live)) return;
      live.onEvent({
        type: "approval.resolved",
        requestId: uiId,
        decision,
      });
      if (decision === "cancelled") return;
      if (decision === "allow") {
        const rec = asRecord(params);
        await live.rpc.respond(id, {
          scope: "turn",
          permissions: rec?.permissions ?? {},
        });
      } else {
        await live.rpc.respond(id, { permissions: {} });
      }
      return;
    }
    // auto / auto-accept: grant requested permissions for the turn.
    const rec = asRecord(params);
    await live.rpc.respond(id, {
      scope: "turn",
      permissions: rec?.permissions ?? {},
    });
    return;
  }

  const auto = autoApproval(live.runtimeMode, mapped.kind);
  if (auto) {
    await live.rpc.respond(id, {
      decision: toCodexApprovalDecision(auto, mapped.kind),
    });
    return;
  }

  const pending = waitApproval(live, uiId, id, mapped.kind);
  live.onEvent(mapped.event);
  const decision = await pending;
  if (!canResolveRequest(live)) return;
  live.onEvent({
    type: "approval.resolved",
    requestId: uiId,
    decision,
  });
  if (decision === "cancelled") return;
  await live.rpc.respond(id, {
    decision: toCodexApprovalDecision(decision, mapped.kind),
  });
}

function waitApproval(
  live: Live,
  uiId: number,
  rpcId: JsonRpcId,
  kind: CodexApprovalKind,
): Promise<ApprovalOutcome> {
  return new Promise<ApprovalOutcome>((resolve) => {
    live.approvals.set(uiId, { rpcId, kind, resolve });
  }).finally(() => {
    live.approvals.delete(uiId);
  });
}

function autoApproval(
  runtimeMode: RuntimeMode,
  kind: CodexApprovalKind,
): ApprovalDecision | null {
  if (runtimeMode === "supervised") return null;
  if (runtimeMode === "full-access") return "allow";
  if (runtimeMode === "auto") {
    // auto_review is set on the server; still prompt if Codex asks.
    return null;
  }
  // auto-accept-edits: auto file changes, ask for commands.
  if (kind === "file-change") return "allow";
  return null;
}

/** Exported for tests. */
export function __codexTestReset(): void {
  const captured = [...childByThread.values()];
  for (const child of captured) void closeChild(child);
  childByThread.clear();
  liveByThread.clear();
  resumeByThread.clear();
  cancelledThreads.clear();
}

export function __codexTestResumeMap(): Map<string, Resume> {
  return resumeByThread;
}
