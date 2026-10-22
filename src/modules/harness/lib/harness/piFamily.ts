import { nativeModelId } from "../models";
import { normalizeProjectPath } from "../recents";
import { taskListFromToolInput } from "../taskList";
import type { UserQuestionReply } from "../userQuestion";
import {
  closeRetiredRawChildren,
  type RawChildHandle,
  reserveRawChild,
} from "./child";
import type {
  CommandContext,
  NativeCommand,
  NativeCommandProvider,
} from "./nativeCommands";
import {
  createPiRpcCommandFailure,
  isPiRpcCommandFailure,
  PiRpc,
} from "./piClient";
import type { PiFlavor } from "./piFlavor";
import { OMP_FLAVOR } from "./piFlavor";
import {
  agentEndWillRetry,
  asRecord,
  assistantDeltaFromEvent,
  buildPiPrompt,
  buildPiSpawnArgs,
  buildPiSteer,
  contextFromSessionStats,
  contextFromUsage,
  extensionUiResponse,
  extensionUiTitle,
  forkMessagesFromRpcData,
  isAgentSettled,
  isPiThinkingLevel,
  mergeToolInput,
  needsExtensionUiReply,
  type PiExtensionUiRequest,
  parseExtensionUiRequest,
  parsePiModelRef,
  piNativeId,
  previewFromTool,
  providerSessionIdFromState,
  sessionFromState,
  statusFromPiEvent,
  stringField,
  summarizeToolRequest,
  toolCallDeltaFromEvent,
  toolCallEndFromEvent,
  toolCallStartFromEvent,
  toolExecutionEndFromEvent,
  toolExecutionStartFromEvent,
  toolExecutionUpdateFromEvent,
  toolKindFromName,
  toolTitle,
  tryParseJsonRecord,
  turnErrorFromEvent,
} from "./piProtocol";
import { discoverOmpCommands, ompCommandsFromRpcData } from "./piSkills";
import { piSubagentEvents } from "./piSubagents";
import type {
  ApprovalDecision,
  CompactContextInput,
  HarnessEvent,
  HarnessSessionInput,
  RewindLastTurnInput,
  SendTurnInput,
  SteerTurnInput,
} from "./types";

type PendingApproval = {
  request: PiExtensionUiRequest;
  resolve: (decision: ApprovalDecision) => void;
};

type InFlightTool = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  partialJson: string;
  title: string;
};

type Admission = {
  state: FlavorState;
  sessionId: string;
  cwd: string;
  planning: boolean;
  retired: boolean;
  ready: boolean;
  opening: Promise<Live>;
  child?: RawChildHandle;
  live?: Live;
};

type PendingAbort = {
  promise: Promise<void>;
  start: () => Promise<void>;
  settle: () => void;
};

type Live = {
  admission: Admission;
  unwatch: () => void;
  operationToken: object;
  isCurrent: () => boolean;
  exitError?: Error;
  reuseError?: Error;
  abortPending?: PendingAbort;
  rpc: PiRpc;
  cwd: string;
  providerSessionId: string;
  contextWindow?: number;
  nativeModel: string;
  thinking: string;
  fastModeEnabled?: boolean;
  fastModeRequested?: boolean;
  planning: boolean;
  onEvent: (event: HarnessEvent) => void;
  approvals: Map<number, PendingApproval>;
  questions: Map<
    number,
    { id: string; resolve: (reply: UserQuestionReply) => void }
  >;
  availableCommands?: NativeCommand[];
  promptId: string | null;
  toolsByIndex: Map<number, InFlightTool>;
  toolsById: Map<string, InFlightTool>;
  cancelled: boolean;
  muteUpdates: boolean;
  compacting: boolean;
  retrying: boolean;
  settling: boolean;
  settleToken: number;
  turns: Promise<void>;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  turnEndPending: boolean;
  activeTurn: boolean;
  emittedAssistant: string;
  emittedReasoning: string;
  /** Reason the turn failed, held until we know it is not being retried. */
  turnError: string | null;
};

type Resume = {
  sessionId: string;
  cwd: string;
};

let nextUiId = 1;

function allocateUiId(): number {
  if (!Number.isSafeInteger(nextUiId))
    throw new Error("Pi UI request identity exhausted");
  return nextUiId++;
}

const INIT_TIMEOUT_MS = 45_000;
const STATS_TIMEOUT_MS = 4_000;
const COMPACT_TIMEOUT_MS = 30 * 60_000;

type FlavorState = {
  liveByThread: Map<string, Live>;
  admissionByThread: Map<string, Admission>;
  resumeByThread: Map<string, Resume>;
  cancelledThreads: Set<string>;
  resolveBinary: () => Promise<{ path: string }>;
  commandListeners: Map<string, Set<(commands: NativeCommand[]) => void>>;
};

const stateByFlavor = new Map<string, FlavorState>();

function stateFor(flavor: PiFlavor): FlavorState {
  let state = stateByFlavor.get(flavor.id);
  if (!state) {
    state = {
      liveByThread: new Map(),
      admissionByThread: new Map(),
      resumeByThread: new Map(),
      cancelledThreads: new Set(),
      resolveBinary: flavor.resolveBinary,
      commandListeners: new Map(),
    };
    stateByFlavor.set(flavor.id, state);
  }
  return state;
}

function commandContextKey(context: CommandContext): string {
  return `${context.sessionId ?? ""}\0${normalizeProjectPath(context.cwd)}`;
}

export const ompCommandProvider: NativeCommandProvider = {
  rawSlashCommands: true,
  async discover(context) {
    const live = context.sessionId
      ? stateFor(OMP_FLAVOR).liveByThread.get(context.sessionId)
      : undefined;
    if (
      !live ||
      normalizeProjectPath(live.cwd) !== normalizeProjectPath(context.cwd)
    ) {
      return discoverOmpCommands(context.cwd);
    }
    if (live.availableCommands) return live.availableCommands;
    const response = await live.rpc.request(
      { type: "get_available_commands" },
      INIT_TIMEOUT_MS,
    );
    return live.availableCommands ?? ompCommandsFromRpcData(response.data);
  },
  subscribe(context, onCommands) {
    const state = stateFor(OMP_FLAVOR);
    const key = commandContextKey(context);
    let listeners = state.commandListeners.get(key);
    if (!listeners) state.commandListeners.set(key, (listeners = new Set()));
    listeners.add(onCommands);
    const live = context.sessionId
      ? state.liveByThread.get(context.sessionId)
      : undefined;
    if (
      live?.availableCommands &&
      normalizeProjectPath(live.cwd) === normalizeProjectPath(context.cwd)
    ) {
      onCommands(live.availableCommands);
    }
    return () => {
      listeners.delete(onCommands);
      if (!listeners.size) state.commandListeners.delete(key);
    };
  },
};

/** Test seam. */
export function setPiBinaryResolver(
  flavor: PiFlavor,
  fn: () => Promise<{ path: string }>,
): void {
  stateFor(flavor).resolveBinary = fn;
}

function snapshotInput<T extends HarnessSessionInput>(input: T): T {
  return {
    ...input,
    modelSettings: input.modelSettings
      ? { ...input.modelSettings }
      : input.modelSettings,
    networkAllowlist: input.networkAllowlist
      ? [...input.networkAllowlist]
      : input.networkAllowlist,
  };
}

export async function sendTurn(
  flavor: PiFlavor,
  request: SendTurnInput,
): Promise<void> {
  const input = {
    ...snapshotInput(request),
    attachments: request.attachments?.map((attachment) => ({ ...attachment })),
  };
  const { cancelledThreads, liveByThread } = stateFor(flavor);
  const admittedLive = liveByThread.get(input.sessionId);
  const admittedOperation = admittedLive?.operationToken;
  let live: Live;
  try {
    live = await ensureLive(flavor, input, false);
  } catch (error) {
    cancelledThreads.delete(input.sessionId);
    throw error;
  }
  if (cancelledThreads.delete(input.sessionId)) return;
  const operation =
    admittedLive === live && admittedOperation
      ? admittedOperation
      : live.operationToken;
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      try {
        assertCurrentOperation(live, operation);
        const abort = live.abortPending;
        if (abort) {
          await abort.promise;
          assertCurrentOperation(live, operation);
        }
      } catch (error) {
        if (error instanceof RetiredPiOperationError) return;
        throw error;
      }
      live.onEvent = input.onEvent;
      live.cancelled = false;
      live.muteUpdates = false;
      try {
        await runTurn(flavor, live, input, operation);
      } catch (error) {
        if (live.cancelled || error instanceof RetiredPiOperationError) return;
        throw error;
      }
    });
  await live.turns;
}

async function admitControl<T extends HarnessSessionInput>(
  flavor: PiFlavor,
  request: T,
) {
  const input = snapshotInput(request);
  const state = stateFor(flavor);
  const admittedLive = state.liveByThread.get(input.sessionId);
  const admittedOperation = admittedLive?.operationToken;
  const live = await ensureLive(flavor, input, false);
  const operation =
    admittedLive === live && admittedOperation
      ? admittedOperation
      : live.operationToken;
  assertCurrentOperation(live, operation);
  if (state.cancelledThreads.delete(input.sessionId))
    throw new RetiredPiOperationError();
  return { input, live, operation };
}

function queueControl<T>(
  flavor: PiFlavor,
  live: Live,
  input: HarnessSessionInput,
  operation: object,
  run: () => Promise<T>,
): Promise<T> {
  const result = live.turns
    .catch(() => undefined)
    .then(async () => {
      assertCurrentOperation(live, operation);
      const abort = live.abortPending;
      if (abort) {
        await abort.promise;
        assertCurrentOperation(live, operation);
      }
      live.onEvent = input.onEvent;
      live.cancelled = false;
      live.muteUpdates = false;
      await applyModel(flavor, live, input, operation);
      assertCurrentOperation(live, operation);
      return run();
    });
  live.turns = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function compactContext(
  flavor: PiFlavor,
  request: CompactContextInput,
): Promise<void> {
  const { input, live, operation } = await admitControl(flavor, request);
  await queueControl(flavor, live, input, operation, async () => {
    const response = await operationRequest(
      live,
      operation,
      { type: "compact" },
      COMPACT_TIMEOUT_MS,
    );
    assertCurrentOperation(live, operation);
    const data = asRecord(response.data);
    const used = data?.estimatedTokensAfter;
    if (typeof used === "number" && Number.isFinite(used) && used > 0) {
      emit(live, {
        type: "context",
        used,
        ...(live.contextWindow ? { window: live.contextWindow } : {}),
      });
      assertCurrentOperation(live, operation);
    }
  });
}

export async function rewindLastTurn(
  flavor: PiFlavor,
  request: RewindLastTurnInput,
): Promise<{ submitted: boolean }> {
  const { input, live, operation } = await admitControl(flavor, request);
  if (live.activeTurn) {
    throw new Error("Stop the current turn before editing the last message");
  }
  return queueControl(flavor, live, input, operation, async () => {
    const forkMessages = await operationRequest(live, operation, {
      type: "get_fork_messages",
    });
    assertCurrentOperation(live, operation);
    const messages = forkMessagesFromRpcData(forkMessages.data);
    const last = messages[messages.length - 1];
    if (!last) throw new Error("No user message to edit");

    const fork = await operationRequest(live, operation, {
      type: "fork",
      entryId: last.entryId,
    });
    assertCurrentOperation(live, operation);
    if (asRecord(fork.data)?.cancelled === true) {
      throw new Error("Edit cancelled");
    }
    const forkState = await operationRequest(live, operation, {
      type: "get_state",
    });
    assertCurrentOperation(live, operation);
    const providerSessionId = providerSessionIdFromState(forkState.data);
    if (!providerSessionId) {
      throw new Error("Pi did not expose the forked session");
    }
    bindState(flavor, input.sessionId, live, forkState.data);
    emit(live, { type: "session.providerBound", providerSessionId });
    assertCurrentOperation(live, operation);
    return { submitted: false };
  });
}

export async function steerTurn(
  flavor: PiFlavor,
  input: SteerTurnInput,
): Promise<void> {
  const live = stateFor(flavor).liveByThread.get(input.sessionId);
  if (!live?.activeTurn) throw new Error("No active turn to steer");
  const operation = live.operationToken;
  const message = input.text.trim();
  const buildCommand =
    flavor.id === "omp" && message.startsWith("/")
      ? (input: Parameters<typeof buildPiPrompt>[0]) =>
          buildPiPrompt({ ...input, streaming: true })
      : buildPiSteer;
  const command = buildCommand({
    text: message,
    attachments: input.attachments,
  });
  if (!command.message && !Array.isArray(command.images)) return;
  await operationRequest(live, operation, command);
  assertCurrentOperation(live, operation);
}

export function respondApproval(
  flavor: PiFlavor,
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  const live = stateFor(flavor).liveByThread.get(sessionId);
  const pending = live?.approvals.get(requestId);
  if (!pending) return;
  pending.resolve(decision);
}

export function respondQuestion(
  flavor: PiFlavor,
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  stateFor(flavor)
    .liveByThread.get(sessionId)
    ?.questions.get(requestId)
    ?.resolve(reply);
}

export async function cancelTurn(
  flavor: PiFlavor,
  sessionId: string,
): Promise<void> {
  const state = stateFor(flavor);
  const { liveByThread, cancelledThreads } = state;
  const live = liveByThread.get(sessionId);
  if (live && !live.admission.ready) {
    await stopSession(flavor, sessionId);
    return;
  }
  if (!live) {
    const opening = state.admissionByThread.get(sessionId);
    if (opening) {
      detachAdmission(opening)();
      await opening.child?.close().catch(() => undefined);
      return;
    }
    cancelledThreads.add(sessionId);
    return;
  }
  const previousAbort = live.abortPending;
  const abort = previousAbort ?? reserveAbort(live);
  live.operationToken = {};
  const onEvent = live.onEvent;
  const done = live.turnDone;
  const hadTurn = live.activeTurn || done !== null;
  live.turnDone = null;
  live.turnFailed = null;
  live.activeTurn = false;
  live.turnEndPending = false;
  live.cancelled = true;
  live.muteUpdates = true;
  live.settleToken += 1;
  const approvals = [...live.approvals.values()];
  const questions = [...live.questions.values()];
  live.approvals.clear();
  live.questions.clear();
  try {
    for (const pending of approvals) pending.resolve("deny");
    for (const question of questions) question.resolve({ kind: "skipped" });
    if (hadTurn) {
      onEvent({ type: "message.completed" });
      onEvent({ type: "reasoning.completed" });
    }
  } finally {
    try {
      done?.();
    } finally {
      if (!previousAbort) await abort.start();
      else await abort.promise;
    }
  }
}

export async function stopSession(
  flavor: PiFlavor,
  sessionId: string,
): Promise<void> {
  const state = stateFor(flavor);
  state.cancelledThreads.delete(sessionId);
  const owners = new Set<Admission>();
  const opening = state.admissionByThread.get(sessionId);
  const live = state.liveByThread.get(sessionId);
  if (opening) owners.add(opening);
  if (live) owners.add(live.admission);
  const cleanup = [...owners].map((owner) => detachAdmission(owner));
  const retired = closeRetiredRawChildren(sessionId).catch(() => undefined);
  for (const release of cleanup) release();
  await Promise.all([
    retired,
    ...[...owners].map((owner) => owner.child?.close().catch(() => undefined)),
  ]);
}

function isCurrentAdmission(owner: Admission): boolean {
  return (
    !owner.retired &&
    !owner.child?.retired &&
    owner.state.admissionByThread.get(owner.sessionId) === owner
  );
}

function guardAdmission(owner: Admission): void {
  if (!isCurrentAdmission(owner))
    throw owner.live?.exitError ?? new RetiredPiOperationError();
}

function detachAdmission(owner: Admission, error?: Error): () => void {
  owner.retired = true;
  const state = owner.state;
  if (state.admissionByThread.get(owner.sessionId) === owner)
    state.admissionByThread.delete(owner.sessionId);
  const live = owner.live;
  if (state.liveByThread.get(owner.sessionId) === live)
    state.liveByThread.delete(owner.sessionId);
  if (!live) return () => undefined;
  if (error) live.exitError = error;
  else live.operationToken = {};
  live.muteUpdates = true;
  live.settleToken += 1;
  const approvals = [...live.approvals.values()];
  const questions = [...live.questions.values()];
  const done = live.turnDone;
  const failed = live.turnFailed;
  live.approvals.clear();
  live.questions.clear();
  live.activeTurn = false;
  live.turnEndPending = false;
  live.promptId = null;
  live.turnDone = null;
  live.turnFailed = null;
  live.toolsById.clear();
  live.toolsByIndex.clear();
  live.abortPending?.settle();
  return () => {
    live.unwatch();
    live.rpc.close(error);
    for (const pending of approvals) pending.resolve("deny");
    for (const question of questions) question.resolve({ kind: "skipped" });
    if (error) failed?.(error);
    else done?.();
  };
}

export async function forgetSession(
  flavor: PiFlavor,
  sessionId: string,
): Promise<void> {
  stateFor(flavor).resumeByThread.delete(sessionId);
  await stopSession(flavor, sessionId);
}

export function bindSession(
  flavor: PiFlavor,
  threadId: string,
  providerSessionId: string,
  cwd: string,
): void {
  const sessionId = providerSessionId.trim();
  if (!threadId || !sessionId || !cwd.trim()) return;
  stateFor(flavor).resumeByThread.set(threadId, { sessionId, cwd });
}

async function ensureLive(
  flavor: PiFlavor,
  request: HarnessSessionInput,
  configureModel = true,
): Promise<Live> {
  const input = snapshotInput({
    sessionId: request.sessionId,
    cwd: request.cwd,
    model: request.model,
    modelSettings: request.modelSettings,
    providerAccountId: request.providerAccountId,
    runtimeMode: request.runtimeMode,
    intent: request.intent,
    onEvent: request.onEvent,
    networkAllowlist: request.networkAllowlist,
  });
  const state = stateFor(flavor);
  let owner = state.admissionByThread.get(input.sessionId);
  if (
    !owner ||
    !isCurrentAdmission(owner) ||
    owner.cwd !== input.cwd ||
    owner.planning !== (input.intent === "plan")
  ) {
    owner = beginAdmission(flavor, input, state);
  }
  const live = await owner.opening;
  guardAdmission(live.admission);
  if (configureModel) {
    const operation = live.operationToken;
    const abort = live.abortPending;
    if (abort) {
      await abort.promise;
      assertCurrentOperation(live, operation);
    }
    live.onEvent = input.onEvent;
    await applyModel(flavor, live, input, operation);
    assertCurrentOperation(live, operation);
  }
  return live;
}

function beginAdmission(
  flavor: PiFlavor,
  input: HarnessSessionInput,
  state: FlavorState,
  allowResume = true,
  resolveBinary = state.resolveBinary,
): Admission {
  const capturedFlavor = {
    ...flavor,
    isolateFlags: [...flavor.isolateFlags],
    planTools: [...flavor.planTools],
  };
  const previous = state.admissionByThread.get(input.sessionId);
  const siblings = [...stateByFlavor.values()]
    .map((entry) => entry.admissionByThread.get(input.sessionId))
    .filter((entry): entry is Admission => entry !== undefined);
  const resume = state.resumeByThread.get(input.sessionId);
  const providerId =
    allowResume && resume?.cwd === input.cwd ? resume.sessionId : undefined;
  let resolve!: (live: Live) => void;
  let reject!: (error: unknown) => void;
  const opening = new Promise<Live>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void opening.catch(() => undefined);
  const owner: Admission = {
    state,
    sessionId: input.sessionId,
    cwd: input.cwd,
    planning: input.intent === "plan",
    retired: false,
    ready: false,
    opening,
  };
  state.admissionByThread.set(input.sessionId, owner);
  try {
    const child = reserveRawChild(input.sessionId);
    owner.child = child;
    const cleanup = siblings
      .filter((sibling) => sibling.child?.retired)
      .map((sibling) => detachAdmission(sibling));
    for (const release of cleanup) release();
    guardAdmission(owner);
    if (
      resume &&
      resume.cwd !== input.cwd &&
      state.resumeByThread.get(input.sessionId) === resume
    )
      state.resumeByThread.delete(input.sessionId);
    const start = async () => {
      try {
        return await startLive(
          capturedFlavor,
          input,
          providerId,
          owner,
          child,
          resolveBinary,
        );
      } catch (error) {
        if (isCurrentAdmission(owner) && owner.live?.reuseError)
          throw owner.live.reuseError;
        if (
          providerId &&
          isCurrentAdmission(owner) &&
          !(error instanceof RetiredPiOperationError)
        ) {
          if (state.resumeByThread.get(input.sessionId) === resume)
            state.resumeByThread.delete(input.sessionId);
          return beginAdmission(
            capturedFlavor,
            input,
            state,
            false,
            resolveBinary,
          ).opening;
        }
        if (isCurrentAdmission(owner)) detachAdmission(owner)();
        void child.close().catch(() => undefined);
        throw error;
      }
    };
    void start().then(resolve, reject);
  } catch (error) {
    if (state.admissionByThread.get(input.sessionId) === owner) {
      if (previous && !previous.retired && !previous.child?.retired)
        state.admissionByThread.set(input.sessionId, previous);
      else state.admissionByThread.delete(input.sessionId);
    }
    owner.retired = true;
    void owner.child?.close().catch(() => undefined);
    reject(error);
  }
  return owner;
}

async function startLive(
  flavor: PiFlavor,
  input: HarnessSessionInput,
  resume: string | undefined,
  owner: Admission,
  child: RawChildHandle,
  resolveBinary: () => Promise<{ path: string }>,
): Promise<Live> {
  const { liveByThread } = owner.state;
  guardAdmission(owner);
  const { path } = await resolveBinary();
  guardAdmission(owner);
  const native = nativeModelId(input.model);
  const modelRef = parsePiModelRef(native);
  const liveRef: { current: Live | null } = { current: null };

  const rpc = new PiRpc(
    input.sessionId,
    (rec) => {
      const current = liveRef.current;
      if (!current?.isCurrent()) return;
      handleFrame(flavor, input.sessionId, current, rec);
    },
    flavor.label,
    async (line) => {
      try {
        await child.write(line);
      } catch (error) {
        const current = liveRef.current;
        if (current) blockNativeReuse(current, error);
        throw error;
      }
    },
  );

  const live: Live = {
    admission: owner,
    unwatch: () => undefined,
    operationToken: {},
    isCurrent: () =>
      !live.reuseError &&
      isCurrentAdmission(owner) &&
      liveByThread.get(input.sessionId) === live,
    rpc,
    cwd: input.cwd,
    providerSessionId: resume ?? "",
    nativeModel: native,
    thinking: input.modelSettings?.thinking ?? "",
    fastModeEnabled: undefined,
    fastModeRequested: undefined,
    planning: input.intent === "plan",
    onEvent: input.onEvent,
    approvals: new Map(),
    questions: new Map(),
    promptId: null,
    toolsByIndex: new Map(),
    toolsById: new Map(),
    cancelled: false,
    muteUpdates: false,
    compacting: false,
    retrying: false,
    settling: false,
    settleToken: 0,
    turns: Promise.resolve(),
    turnDone: null,
    turnFailed: null,
    turnEndPending: false,
    activeTurn: false,
    emittedAssistant: "",
    emittedReasoning: "",
    turnError: null,
  };
  liveRef.current = live;
  owner.live = live;
  guardAdmission(owner);
  liveByThread.set(input.sessionId, live);

  live.unwatch = child.watch(
    (line) => rpc.pushLine(line),
    (code) => {
      if (!isCurrentAdmission(owner)) return;
      const error = new Error(`${flavor.label} exited`);
      const onEvent = live.onEvent;
      detachAdmission(owner, error)();
      try {
        onEvent({ type: "session.ended", code });
      } finally {
        void child.close().catch(() => undefined);
      }
    },

    (line) => {
      console.debug(`[${flavor.id}]`, line);
    },
  );

  guardAdmission(owner);
  await child.spawn(
    path,
    buildPiSpawnArgs(flavor, {
      resume,
      model: modelRef ? native : undefined,
      plan: input.intent === "plan",
    }),
    input.cwd,
    input.networkAllowlist,
  );

  guardAdmission(owner);
  const operation = live.operationToken;

  try {
    const stateFrame = await operationRequest(
      live,
      operation,
      { type: "get_state" },
      INIT_TIMEOUT_MS,
    );
    assertCurrentOperation(live, operation);
    bindState(flavor, input.sessionId, live, stateFrame.data);
    await applyModel(flavor, live, input, operation);
    if (live.providerSessionId) {
      emit(live, {
        type: "session.providerBound",
        providerSessionId: live.providerSessionId,
      });
    }
    emit(live, { type: "session.started" });
    assertCurrentOperation(live, operation);
    owner.ready = true;
    return live;
  } catch (error) {
    if (!isCurrentAdmission(owner))
      throw live.exitError ?? new RetiredPiOperationError();
    throw error;
  }
}

async function runTurn(
  flavor: PiFlavor,
  live: Live,
  input: SendTurnInput,
  operation: object,
): Promise<void> {
  await applyModel(flavor, live, input, operation);
  assertCurrentOperation(live, operation);
  live.emittedAssistant = "";
  live.emittedReasoning = "";
  live.turnError = null;
  live.toolsByIndex.clear();
  live.toolsById.clear();
  live.compacting = false;
  live.retrying = false;
  live.settleToken += 1;
  live.settling = false;
  const promptId = `mc_turn_${crypto.randomUUID()}`;
  live.promptId = promptId;

  const turnPromise = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  live.activeTurn = true;
  settlePendingTurn(live);

  try {
    let response: Record<string, unknown> | null;
    try {
      response = await Promise.race([
        live.rpc.request(
          {
            ...buildPiPrompt({
              text: input.text,
              attachments: input.attachments,
            }),
            id: promptId,
          },
          flavor.id === "omp" ? COMPACT_TIMEOUT_MS : 15_000,
        ),
        turnPromise.then(() => null),
      ]);
    } catch (error) {
      if (!isPiRpcCommandFailure(error)) blockNativeReuse(live, error);
      throw error;
    }
    assertCurrentOperation(live, operation);
    input.onAccepted?.();
    assertCurrentOperation(live, operation);
    if (
      flavor.id === "omp" &&
      asRecord(response?.data)?.agentInvoked === false
    ) {
      finishActiveTurn(live, [
        { type: "message.completed" },
        { type: "reasoning.completed" },
      ]);
    }
    settlePendingTurn(live);
    await turnPromise;
  } catch (error) {
    if (live.cancelled || error instanceof RetiredPiOperationError) return;
    emit(live, {
      type: "session.error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    live.rpc.cancelRequest(promptId);
    if (live.operationToken === operation && live.promptId === promptId) {
      live.activeTurn = false;
      live.promptId = null;
      live.turnDone = null;
      live.turnFailed = null;
    }
  }
}

function handleFrame(
  flavor: PiFlavor,
  sessionId: string,
  live: Live,
  rec: Record<string, unknown>,
): void {
  if (flavor.id === "omp" && rec.type === "available_commands_update") {
    try {
      live.availableCommands = ompCommandsFromRpcData(rec);
      const listeners = stateFor(flavor).commandListeners.get(
        commandContextKey({ sessionId, cwd: live.cwd }),
      );
      for (const listener of listeners ?? []) listener(live.availableCommands);
    } catch {
      // Preserve the last valid inventory when a runtime emits a malformed update.
    }
    return;
  }
  if (
    flavor.id === "omp" &&
    rec.type === "extension_ui_request" &&
    rec.method === "cancel"
  ) {
    for (const question of live.questions.values()) {
      if (question.id === rec.id) question.resolve({ kind: "skipped" });
    }
    return;
  }
  const ui = parseExtensionUiRequest(rec);
  if (ui) {
    void handleExtensionUi(flavor, live, ui);
    return;
  }
  if (live.muteUpdates) return;

  const type = stringField(rec, "type");
  if (flavor.id === "omp") {
    if (type === "session_info_update") {
      const providerSessionId = stringField(rec, "sessionId");
      if (providerSessionId) {
        bindState(flavor, sessionId, live, { sessionId: providerSessionId });
        emit(live, { type: "session.providerBound", providerSessionId });
      }
      return;
    }
    if (type === "config_update") {
      const model = asRecord(rec.model);
      const provider = stringField(model, "provider");
      const modelId = stringField(model, "id");
      const thinking = stringField(rec, "thinkingLevel");
      const fastModeEnabled =
        typeof rec.fastModeEnabled === "boolean"
          ? rec.fastModeEnabled
          : undefined;
      const native =
        provider && modelId ? piNativeId(provider, modelId) : undefined;
      if (native) live.nativeModel = native;
      if (isPiThinkingLevel(thinking)) live.thinking = thinking;
      if (fastModeEnabled != null) {
        live.fastModeEnabled = fastModeEnabled;
        live.fastModeRequested = fastModeEnabled;
      }
      emit(live, {
        type: "session.configChanged",
        ...(native ? { model: `${flavor.id}:${native}` } : {}),
        ...(isPiThinkingLevel(thinking) || fastModeEnabled != null
          ? {
              modelSettings: {
                ...(isPiThinkingLevel(thinking) ? { thinking } : {}),
                ...(fastModeEnabled != null
                  ? { fast: String(fastModeEnabled) }
                  : {}),
              },
            }
          : {}),
      });
      return;
    }
    if (type === "command_output") {
      const text = stringField(rec, "text");
      if (text)
        emit(live, {
          type: "status",
          text: extensionUiTitle({
            id: "output",
            method: "notify",
            title: text,
          }),
        });
      return;
    }
    if (type === "prompt_result") {
      if (
        live.activeTurn &&
        rec.id === live.promptId &&
        rec.agentInvoked === false
      ) {
        finishActiveTurn(live, [
          { type: "message.completed" },
          { type: "reasoning.completed" },
        ]);
      }
      return;
    }
    // OMP can acknowledge a prompt and later report an asynchronous error.
    if (
      type === "response" &&
      rec.command === "prompt" &&
      rec.id === live.promptId &&
      rec.success === false
    ) {
      live.turnFailed?.(
        createPiRpcCommandFailure(
          stringField(rec, "error") ?? "OMP command failed",
        ),
      );
      return;
    }
    if (type === "agent_end" && rec.isTerminal === false) return;
  }
  if (type === "compaction_start") live.compacting = true;
  if (type === "compaction_end") live.compacting = false;
  if (type === "auto_retry_start") live.retrying = true;
  if (type === "auto_retry_end") live.retrying = false;

  const status = statusFromPiEvent(rec);
  if (status) emit(live, { type: "status", text: status });

  const turnError = turnErrorFromEvent(rec);
  if (turnError !== null) live.turnError = turnError;

  const context = contextFromUsage(rec, live.contextWindow);
  if (context) emit(live, { type: "context", ...context });

  const delta = assistantDeltaFromEvent(rec);
  if (delta) {
    if (delta.kind === "text") {
      live.emittedAssistant += delta.text;
      emit(live, { type: "message.delta", text: delta.text });
    } else {
      live.emittedReasoning += delta.text;
      emit(live, { type: "reasoning.delta", text: delta.text });
    }
  }

  const started = toolCallStartFromEvent(rec);
  if (started) {
    upsertTool(live, started.id, started.name, {}, started.index);
  }

  const jsonDelta = toolCallDeltaFromEvent(rec);
  if (jsonDelta) {
    const tool = live.toolsByIndex.get(jsonDelta.index);
    if (tool) {
      tool.partialJson += jsonDelta.delta;
      const parsed = tryParseJsonRecord(tool.partialJson);
      if (parsed) updateTool(live, tool, parsed);
    }
  }

  const ended = toolCallEndFromEvent(rec);
  if (ended) {
    upsertTool(live, ended.id, ended.name, ended.input);
  }

  const execStart = toolExecutionStartFromEvent(rec);
  if (execStart) {
    upsertTool(live, execStart.id, execStart.name, execStart.input);
    const tool = live.toolsById.get(execStart.id);
    if (tool) {
      emit(live, {
        type: "tool.updated",
        callId: tool.id,
        title: tool.title,
        kind: toolKindFromName(tool.name),
        status: "running",
        preview: previewFromTool(tool.name, tool.input),
      });
    }
  }

  const execUpdate = toolExecutionUpdateFromEvent(rec);
  if (execUpdate) {
    const tool = live.toolsById.get(execUpdate.id);
    if (tool) {
      if (Object.keys(execUpdate.input).length > 0) {
        tool.input = mergeToolInput(tool.input, execUpdate.input);
        tool.title = toolTitle(tool.name, tool.input);
      }
      const subevents = piSubagentEvents(
        tool.id,
        tool.input,
        rec.partialResult ?? rec,
        false,
      );
      if (subevents.length > 0) {
        for (const event of subevents) emit(live, event);
      } else {
        emit(live, {
          type: "tool.updated",
          callId: tool.id,
          title: tool.title,
          kind: toolKindFromName(tool.name),
          status: "running",
          detail: execUpdate.detail,
          preview: previewFromTool(tool.name, tool.input, execUpdate.detail),
        });
      }
    }
  }

  const execEnd = toolExecutionEndFromEvent(rec);
  if (execEnd) {
    const tool = live.toolsById.get(execEnd.id);
    if (tool) {
      const subevents = piSubagentEvents(
        tool.id,
        tool.input,
        rec.result ?? rec,
        true,
        execEnd.isError,
      );
      if (subevents.length > 0) {
        for (const event of subevents) emit(live, event);
      } else {
        emit(live, {
          type: "tool.updated",
          callId: tool.id,
          title: tool.title,
          kind: toolKindFromName(tool.name),
          status: execEnd.isError ? "failed" : "completed",
          detail: execEnd.detail,
          preview: previewFromTool(tool.name, tool.input, execEnd.detail),
        });
      }
    }
  }

  if (isAgentSettled(rec)) {
    flushTurnError(flavor, live);
    void settleTurn(live);
    return;
  }
  const willRetry = agentEndWillRetry(rec);
  // The retry carries the real answer, so the attempt it replaces stays quiet.
  if (willRetry === true) live.turnError = null;
  if (willRetry === false && !live.compacting && !live.retrying) {
    flushTurnError(flavor, live);
    void settleTurn(live);
  }
}

function flushTurnError(flavor: PiFlavor, live: Live): void {
  const message = live.turnError;
  if (message === null) return;
  live.turnError = null;
  emit(live, {
    type: "session.error",
    message: message || `${flavor.label} turn failed`,
  });
}

async function settleTurn(live: Live): Promise<void> {
  if (live.settling || live.cancelled || live.muteUpdates) return;
  if (!live.activeTurn && !live.turnDone) return;
  live.settling = true;
  const token = live.settleToken;
  try {
    const stats = await live.rpc.request(
      { type: "get_session_stats" },
      STATS_TIMEOUT_MS,
    );
    if (live.settleToken === token && !live.cancelled) {
      const context = contextFromSessionStats(stats.data);
      if (context) emit(live, { type: "context", ...context });
    }
  } catch {
    // meter stays on the last streamed usage
  }
  if (live.settleToken === token && !live.cancelled) {
    finishActiveTurn(live, [
      { type: "message.completed" },
      { type: "reasoning.completed" },
    ]);
  }
  if (live.settleToken === token) live.settling = false;
}

async function handleExtensionUi(
  flavor: PiFlavor,
  live: Live,
  request: PiExtensionUiRequest,
): Promise<void> {
  if (!needsExtensionUiReply(request)) {
    const text = request.title ? extensionUiTitle(request) : "";
    if (request.method === "setStatus" && request.statusKey)
      emit(live, { type: "status", key: request.statusKey, text });
    else if (text.trim()) emit(live, { type: "status", text });
    return;
  }

  if (live.cancelled || live.muteUpdates) {
    await live.admission.child
      ?.write(JSON.stringify(extensionUiResponse(request, "deny")))
      .catch(() => undefined);
    return;
  }

  if (
    flavor.id === "omp" &&
    (request.method === "select" ||
      request.method === "input" ||
      request.method === "editor")
  ) {
    const uiId = allocateUiId();
    const replyPromise = new Promise<UserQuestionReply>((resolve) => {
      live.questions.set(uiId, { id: request.id, resolve });
    });
    emit(live, {
      type: "question.asked",
      requestId: uiId,
      title: extensionUiTitle(request),
      questions: [
        {
          id: request.id,
          prompt: extensionUiTitle(request),
          multiSelect: false,
          allowCustom: request.method !== "select",
          options:
            request.method === "select"
              ? request.options.map((label, index) => ({
                  id: String(index),
                  label: extensionUiTitle({
                    id: request.id,
                    method: "notify",
                    title: label,
                  }),
                }))
              : [],
        },
      ],
    });
    const reply = await replyPromise;
    if (!live.isCurrent()) return;
    live.questions.delete(uiId);
    let value: string | undefined;
    if (reply.kind === "answered") {
      if (request.method === "select") {
        const selected = reply.answers[request.id]?.[0];
        if (selected !== undefined && /^\d+$/.test(selected))
          value = request.options[Number(selected)];
      } else {
        value = reply.custom?.[request.id];
      }
    }
    emit(live, {
      type: "question.resolved",
      requestId: uiId,
      decision: value === undefined ? "skipped" : "answered",
    });
    await live.admission.child
      ?.write(
        JSON.stringify({
          type: "extension_ui_response",
          id: request.id,
          ...(value === undefined ? { cancelled: true } : { value }),
        }),
      )
      .catch(() => undefined);
    return;
  }

  const uiId = allocateUiId();
  const decisionPromise = new Promise<ApprovalDecision>((resolve) => {
    live.approvals.set(uiId, { request, resolve });
  });
  emit(live, {
    type: "approval.requested",
    requestId: uiId,
    title: extensionUiTitle(request),
    kind: "other",
  });
  const decision = await decisionPromise;
  if (!live.isCurrent()) return;
  live.approvals.delete(uiId);
  emit(live, { type: "approval.resolved", requestId: uiId, decision });
  await live.admission.child
    ?.write(JSON.stringify(extensionUiResponse(request, decision)))
    .catch(() => undefined);
}

class RetiredPiOperationError extends Error {
  constructor() {
    super("Pi operation was retired.");
  }
}

function reserveAbort(live: Live): PendingAbort {
  const rpc = live.rpc;
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  const pending: PendingAbort = {
    promise,
    settle: () => {
      if (live.abortPending === pending) live.abortPending = undefined;
      resolve();
    },
    start: async () => {
      try {
        if (isCurrentAdmission(live.admission) && !live.reuseError)
          await rpc.request({ type: "abort" }, 5_000);
      } catch (error) {
        blockNativeReuse(live, error);
      } finally {
        pending.settle();
      }
    },
  };
  live.abortPending = pending;
  return pending;
}

function blockNativeReuse(live: Live, error: unknown): void {
  if (live.reuseError || !isCurrentAdmission(live.admission)) return;
  const failure = error instanceof Error ? error : new Error(String(error));
  live.reuseError = failure;
  live.muteUpdates = true;
  live.settleToken += 1;
  const approvals = [...live.approvals.values()];
  const questions = [...live.questions.values()];
  const failed = live.turnFailed;
  live.approvals.clear();
  live.questions.clear();
  live.activeTurn = false;
  live.turnEndPending = false;
  live.promptId = null;
  live.turnDone = null;
  live.turnFailed = null;
  live.toolsById.clear();
  live.toolsByIndex.clear();
  live.abortPending?.settle();
  live.rpc.close(failure);
  for (const pending of approvals) pending.resolve("deny");
  for (const question of questions) question.resolve({ kind: "skipped" });
  failed?.(failure);
}

function assertCurrentOperation(live: Live, operation: object): void {
  if (live.operationToken !== operation) throw new RetiredPiOperationError();
  if (!live.isCurrent())
    throw live.exitError ?? live.reuseError ?? new RetiredPiOperationError();
}

async function operationRequest(
  live: Live,
  operation: object,
  command: Record<string, unknown>,
  timeoutMs?: number,
): Promise<Record<string, unknown>> {
  assertCurrentOperation(live, operation);
  const abort = live.abortPending;
  if (abort) {
    await abort.promise;
    assertCurrentOperation(live, operation);
  }
  let result: Record<string, unknown>;
  try {
    result = await live.rpc.request(command, timeoutMs);
  } catch (error) {
    if (!isPiRpcCommandFailure(error)) blockNativeReuse(live, error);
    assertCurrentOperation(live, operation);
    throw error;
  }
  assertCurrentOperation(live, operation);
  return result;
}

async function applyModel(
  flavor: PiFlavor,
  live: Live,
  input: HarnessSessionInput,
  operation = live.operationToken,
): Promise<void> {
  assertCurrentOperation(live, operation);
  const abort = live.abortPending;
  if (abort) {
    await abort.promise;
    assertCurrentOperation(live, operation);
  }
  const native = nativeModelId(input.model);
  const thinking = input.modelSettings?.thinking;
  const fast = input.modelSettings?.fast;
  const onEvent = input.onEvent;
  const ref = parsePiModelRef(native);
  if (ref && native !== live.nativeModel) {
    const result = await operationRequest(live, operation, {
      type: "set_model",
      provider: ref.provider,
      modelId: ref.modelId,
    });
    assertCurrentOperation(live, operation);
    live.nativeModel = native;
    const model = asRecord(result.data);
    const window =
      model && typeof model.contextWindow === "number"
        ? model.contextWindow
        : undefined;
    if (window && window > 0) live.contextWindow = window;
  } else if (ref) {
    live.nativeModel = native;
  }
  if (isPiThinkingLevel(thinking) && thinking !== live.thinking) {
    try {
      await operationRequest(live, operation, {
        type: "set_thinking_level",
        level: thinking,
      });
      assertCurrentOperation(live, operation);
    } catch (error) {
      assertCurrentOperation(live, operation);
      if (!isPiRpcCommandFailure(error)) throw error;
    }
    live.thinking = thinking;
  }
  if (
    flavor.id === "omp" &&
    (fast === "true" || fast === "false") &&
    (fast === "true") !== live.fastModeRequested
  ) {
    const enabled = fast === "true";
    try {
      const response = await operationRequest(live, operation, {
        type: "set_fast_mode",
        enabled,
      });
      assertCurrentOperation(live, operation);
      const data = asRecord(response.data);
      live.fastModeEnabled =
        typeof data?.enabled === "boolean" ? data.enabled : enabled;
    } catch (error) {
      assertCurrentOperation(live, operation);
      if (!isPiRpcCommandFailure(error)) throw error;
      if (enabled) {
        live.fastModeEnabled = false;
        onEvent({
          type: "session.configChanged",
          modelSettings: { fast: "false" },
        });
        assertCurrentOperation(live, operation);
        onEvent({
          type: "status",
          text:
            error instanceof Error
              ? error.message
              : "Fast mode is unavailable for the current model.",
        });
        assertCurrentOperation(live, operation);
      }
    }
    assertCurrentOperation(live, operation);
    live.fastModeRequested = enabled;
  }
  assertCurrentOperation(live, operation);
}

function emit(live: Live, event: HarnessEvent): void {
  if (live.isCurrent()) live.onEvent(event);
}

function bindState(
  flavor: PiFlavor,
  sessionId: string,
  live: Live,
  data: unknown,
): void {
  guardAdmission(live.admission);
  const state = sessionFromState(data);
  const providerSessionId = providerSessionIdFromState(data);
  if (state.contextWindow) live.contextWindow = state.contextWindow;
  if (providerSessionId) {
    live.providerSessionId = providerSessionId;
    stateFor(flavor).resumeByThread.set(sessionId, {
      sessionId: providerSessionId,
      cwd: live.cwd,
    });
  }
  const model = asRecord(asRecord(data)?.model);
  const provider = stringField(model, "provider");
  const modelId = stringField(model, "id");
  if (provider && modelId && !live.nativeModel) {
    live.nativeModel = piNativeId(provider, modelId);
  }
  const fastModeEnabled = asRecord(data)?.fastModeEnabled;
  if (flavor.id === "omp" && typeof fastModeEnabled === "boolean") {
    live.fastModeEnabled = fastModeEnabled;
    live.fastModeRequested = fastModeEnabled;
  }
}

function upsertTool(
  live: Live,
  id: string,
  name: string,
  input: Record<string, unknown>,
  index?: number,
): void {
  let tool = live.toolsById.get(id);
  if (!tool) {
    tool = {
      id,
      name,
      input,
      partialJson: "",
      title: toolTitle(name, input),
    };
    live.toolsById.set(id, tool);
    emit(live, {
      type: "tool.started",
      callId: id,
      title: tool.title,
      kind: toolKindFromName(name),
      status: "pending",
      preview: previewFromTool(name, input),
    });
    emitTaskListIfNeeded(live, tool);
  } else if (Object.keys(input).length > 0) {
    updateTool(live, tool, input);
  }
  if (index != null && index >= 0) live.toolsByIndex.set(index, tool);
}

function updateTool(
  live: Live,
  tool: InFlightTool,
  input: Record<string, unknown>,
): void {
  tool.input = mergeToolInput(tool.input, input);
  tool.title = toolTitle(tool.name, tool.input);
  emit(live, {
    type: "tool.updated",
    callId: tool.id,
    title: tool.title,
    kind: toolKindFromName(tool.name),
    status: "pending",
    detail: summarizeToolRequest(tool.name, tool.input),
    preview: previewFromTool(tool.name, tool.input),
  });
  emitTaskListIfNeeded(live, tool);
}

function emitTaskListIfNeeded(live: Live, tool: InFlightTool): void {
  const items = taskListFromToolInput(tool.name, tool.input);
  if (items) emit(live, { type: "tasks.updated", items });
}

function finishActiveTurn(live: Live, extraEvents: HarnessEvent[] = []): void {
  if (!live.activeTurn && !live.turnDone) return;
  live.turnEndPending = false;
  live.activeTurn = false;
  for (const event of extraEvents) emit(live, event);
  const done = live.turnDone;
  const failed = live.turnFailed;
  live.turnDone = null;
  live.turnFailed = null;
  if (done) {
    done();
    return;
  }
  if (!failed) live.turnEndPending = true;
}

function settlePendingTurn(live: Live): void {
  if (!live.turnEndPending || !live.turnDone) return;
  finishActiveTurn(live);
}
