import type { GitRangeContext, GitStagedContext } from "../fs";
import {
  assertRemoteAgentSupported,
  assertRemoteAttachments,
} from "./remoteAgents";
import type { PrContent } from "../gitText";
import { hasLiveCatalog } from "../models";
import type { Block, HarnessId, TaskListMeta } from "../session";
import type { GeneratedSessionTitle } from "../sessionTitle";
import type { UserQuestionReply } from "../userQuestion";
import type { NativeCommandProvider } from "./nativeCommands";
import { assertHarnessMemoryTarget } from "@/modules/harness/lib/harnessMemoryDelivery";
import type {
  ApprovalDecision,
  CompactContextInput,
  HarnessEvent,
  RewindLastTurnInput,
  RewindLastTurnResult,
  SendTurnInput,
  SteerTurnInput,
} from "./types";

export type TitleInput = {
  sessionId: string;
  cwd: string;
  message: string;
  providerAccountId?: string;
};

/**
 * Lifecycle contract for a live harness adapter.
 * App.tsx dispatches through the registry instead of harness-specific branches.
 */
export type HarnessAdapter = {
  id: HarnessId;
  projectMemory?: "managed-turn";
  /** True when this adapter can run live turns. */
  live: boolean;
  /** False when the harness cannot accept a follow-up while a turn is running. Default: same as live. */
  canSteer?: boolean;
  commands?: NativeCommandProvider;
  sendTurn(input: SendTurnInput): Promise<void>;
  /** Trigger provider-owned compaction outside MonoCode's normal user-turn path. */
  compactContext?(input: CompactContextInput): Promise<void>;
  /** Rewind provider state before resending an edited prompt. */
  rewindLastTurn?(input: RewindLastTurnInput): Promise<RewindLastTurnResult>;
  steerTurn(input: SteerTurnInput): Promise<void>;
  cancelTurn(sessionId: string): Promise<void>;
  respondApproval(
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ): void;
  respondQuestion?(
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
  ): void;
  keepQuestionOpen?(sessionId: string, requestId: number): void;
  /** Kill the child but keep resume state for later rebind. */
  stopSession(sessionId: string): Promise<void>;
  /** Drop resume state and kill the child (delete, harness switch, idle detach). */
  forgetSession(sessionId: string): Promise<void>;
  /** Seed resume state from a restored MonoCode session. */
  bindSession(
    threadId: string,
    providerSessionId: string,
    cwd: string,
    providerAccountId?: string,
  ): void;
  /** Seed provider task state from a restored session's persisted panels. */
  restoreTaskLists?(threadId: string, lists: TaskListMeta[]): void;
  /** Refresh the model catalog overlay when supported. */
  refreshCatalog?(): Promise<void>;
  /** Optional LLM tab title for the first turn. */
  generateTitle?(input: TitleInput): Promise<GeneratedSessionTitle | null>;
  /** Optional LLM commit message from supplied or staged Git context. */
  generateCommitMessage?(
    cwd: string,
    signal?: AbortSignal,
    context?: GitStagedContext,
  ): Promise<string>;
  /** Optional LLM pull request title/body from branch diff context. */
  generatePrContent?(
    cwd: string,
    context?: GitRangeContext,
  ): Promise<(PrContent & { base: string; head: string }) | null>;
  /** Optional LLM branch name from a user message. */
  generateBranchName?(cwd: string, message: string): Promise<string | null>;
  /** Optional warmup for text-generation backends. */
  warmupText?(cwd: string): Promise<void>;
};

const adapters = new Map<HarnessId, HarnessAdapter>();

/**
 * After a turn settles, keep the child warm for follow-ups, then park it.
 * Resume state stays, so the next prompt respawns instead of starting over.
 */
export const HARNESS_IDLE_PARK_MS = 5 * 60_000;
const MAX_HARNESS_ACTIVITIES = 256;

type IdleParkState = {
  adapter: HarnessAdapter;
  sessionId: string;
  active: number;
  approvals: Set<number>;
  questions: Set<number>;
  inputOverflow: boolean;
  timer?: { handle?: ReturnType<typeof setTimeout> };
};

const idleParkStates = new Set<IdleParkState>();
let pendingActivities = 0;

function currentState(adapter: HarnessAdapter, sessionId: string) {
  for (const state of idleParkStates) {
    if (state.adapter === adapter && state.sessionId === sessionId)
      return state;
  }
}

function isCurrent(state: IdleParkState): boolean {
  return (
    idleParkStates.has(state) &&
    adapters.get(state.adapter.id) === state.adapter
  );
}

function cancelIdlePark(state: IdleParkState): void {
  const timer = state.timer;
  state.timer = undefined;
  if (timer?.handle !== undefined) clearTimeout(timer.handle);
}

function invalidateIdlePark(adapter: HarnessAdapter, sessionId: string): void {
  const state = currentState(adapter, sessionId);
  if (!state) return;
  idleParkStates.delete(state);
  cancelIdlePark(state);
}

function reserveActivity(): () => void {
  if (pendingActivities >= MAX_HARNESS_ACTIVITIES) {
    throw new Error("HARNESS_ACTIVITY_CAPACITY");
  }
  pendingActivities++;
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    pendingActivities--;
  };
}

function scheduleIdlePark(state: IdleParkState): void {
  if (
    !isCurrent(state) ||
    state.active !== 0 ||
    state.inputOverflow ||
    state.approvals.size !== 0 ||
    state.questions.size !== 0
  )
    return;
  cancelIdlePark(state);
  const timer: NonNullable<IdleParkState["timer"]> = {};
  state.timer = timer;
  timer.handle = setTimeout(() => {
    if (
      !isCurrent(state) ||
      state.timer !== timer ||
      state.active !== 0 ||
      state.inputOverflow ||
      state.approvals.size !== 0 ||
      state.questions.size !== 0
    )
      return;
    if (!state.adapter.live) {
      idleParkStates.delete(state);
      state.timer = undefined;
      return;
    }
    if (pendingActivities >= MAX_HARNESS_ACTIVITIES) {
      scheduleIdlePark(state);
      return;
    }
    const finish = reserveActivity();
    idleParkStates.delete(state);
    state.timer = undefined;
    void (async () => {
      try {
        await state.adapter.stopSession(state.sessionId);
      } catch {
        // Automatic parking is best effort, like adapter interrupt cleanup.
      } finally {
        finish();
      }
    })();
  }, HARNESS_IDLE_PARK_MS);
}

function beginActivity(adapter: HarnessAdapter, sessionId: string) {
  let state = currentState(adapter, sessionId);
  if (!state && idleParkStates.size >= MAX_HARNESS_ACTIVITIES) {
    throw new Error("HARNESS_ACTIVITY_CAPACITY");
  }
  const release = reserveActivity();
  if (!state) {
    state = {
      adapter,
      sessionId,
      active: 0,
      approvals: new Set(),
      questions: new Set(),
      inputOverflow: false,
    };
    idleParkStates.add(state);
  }
  const captured = state;
  cancelIdlePark(captured);
  captured.active++;
  let settled = false;
  return {
    state: captured,
    finish() {
      if (settled) return;
      settled = true;
      captured.active--;
      release();
      scheduleIdlePark(captured);
    },
  };
}

function ownedEvents(
  state: IdleParkState,
  onEvent: (event: HarnessEvent) => void,
) {
  return (event: HarnessEvent) => {
    if (isCurrent(state)) {
      const requested =
        event.type === "approval.requested" || event.type === "question.asked";
      const resolved =
        event.type === "approval.resolved" ||
        event.type === "question.resolved";
      if (requested || resolved) {
        const requests =
          event.type === "approval.requested" ||
          event.type === "approval.resolved"
            ? state.approvals
            : state.questions;
        if (requested) {
          cancelIdlePark(state);
          if (
            state.approvals.size + state.questions.size <
            MAX_HARNESS_ACTIVITIES
          ) {
            requests.add(event.requestId);
          } else if (!requests.has(event.requestId)) {
            state.inputOverflow = true;
          }
        } else {
          requests.delete(event.requestId);
          scheduleIdlePark(state);
        }
      }
    }
    onEvent(event);
  };
}

/** Test seam. Outstanding operations keep their admission budget until settlement. */
export function resetHarnessIdlePark(): void {
  const states = [...idleParkStates];
  idleParkStates.clear();
  for (const state of states) cancelIdlePark(state);
}

export function registerHarness(adapter: HarnessAdapter): void {
  const previous = adapters.get(adapter.id);
  if (previous) {
    for (const state of idleParkStates) {
      if (state.adapter !== previous) continue;
      idleParkStates.delete(state);
      cancelIdlePark(state);
    }
  }
  adapters.set(adapter.id, adapter);
}

export function getHarness(id: HarnessId): HarnessAdapter | undefined {
  return adapters.get(id);
}

export function requireHarness(id: HarnessId): HarnessAdapter {
  const adapter = adapters.get(id);
  if (!adapter) {
    throw new Error(`No harness adapter registered for "${id}"`);
  }
  return adapter;
}

export function isLiveHarness(id: HarnessId): boolean {
  return adapters.get(id)?.live === true;
}

export function listHarnesses(): HarnessAdapter[] {
  return [...adapters.values()];
}

export async function sendHarnessTurn(
  input: SendTurnInput & { harness: HarnessId },
) {
  const adapter = requireHarness(input.harness);
  if (input.projectMemory && adapter.projectMemory !== "managed-turn")
    throw new Error("KIT_MEMORY_CONTEXT_UNSUPPORTED");
  assertHarnessMemoryTarget(input.projectMemory, input.cwd);
  if (!adapter.live) {
    throw new Error(`${input.harness} is not connected yet`);
  }
  assertRemoteAgentSupported(input.harness, input.cwd);
  assertRemoteAttachments(input.attachments, input.cwd);
  const activity = beginActivity(adapter, input.sessionId);
  try {
    await adapter.sendTurn({
      ...input,
      onEvent: ownedEvents(activity.state, input.onEvent),
    });
  } finally {
    activity.finish();
  }
}

export function canCompactHarnessContext(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  return adapter?.live === true && adapter.compactContext != null;
}

export async function compactHarnessContext(
  input: CompactContextInput & { harness: HarnessId },
): Promise<void> {
  const adapter = requireHarness(input.harness);
  if (!adapter.live) {
    throw new Error(`${input.harness} is not connected yet`);
  }
  if (!adapter.compactContext) {
    throw new Error(`${input.harness} does not support manual compaction`);
  }
  const activity = beginActivity(adapter, input.sessionId);
  try {
    await adapter.compactContext({
      ...input,
      onEvent: ownedEvents(activity.state, input.onEvent),
    });
  } finally {
    activity.finish();
  }
}

export function canSteerHarness(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  if (!adapter?.live) return false;
  return adapter.canSteer !== false;
}

export function canRewindHarnessLastTurn(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  return adapter?.live === true && adapter.rewindLastTurn != null;
}

export async function rewindHarnessLastTurn(
  input: RewindLastTurnInput & { harness: HarnessId },
): Promise<RewindLastTurnResult> {
  const adapter = requireHarness(input.harness);
  if (!adapter.rewindLastTurn) {
    throw new Error(
      `${input.harness} does not support editing the last message`,
    );
  }
  const activity = beginActivity(adapter, input.sessionId);
  try {
    return await adapter.rewindLastTurn({
      ...input,
      onEvent: ownedEvents(activity.state, input.onEvent),
    });
  } finally {
    activity.finish();
  }
}

export async function steerHarnessTurn(
  input: SteerTurnInput & { harness: HarnessId },
): Promise<void> {
  const adapter = requireHarness(input.harness);
  if (input.projectMemory && adapter.projectMemory !== "managed-turn")
    throw new Error("KIT_MEMORY_CONTEXT_UNSUPPORTED");
  assertHarnessMemoryTarget(input.projectMemory, input.cwd);
  if (!adapter.live) {
    throw new Error(`${input.harness} is not connected yet`);
  }
  const activity = beginActivity(adapter, input.sessionId);
  try {
    await adapter.steerTurn(input);
  } finally {
    activity.finish();
  }
}

export async function cancelHarnessTurn(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  const adapter = getHarness(harness);
  if (!adapter?.live) return;
  const activity = beginActivity(adapter, sessionId);
  try {
    await adapter.cancelTurn(sessionId);
  } finally {
    activity.finish();
  }
}

export function respondHarnessApproval(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  const adapter = getHarness(harness);
  if (!adapter) return;
  const activity = beginActivity(adapter, sessionId);
  try {
    adapter.respondApproval(sessionId, requestId, decision);
  } finally {
    activity.finish();
  }
}

export function respondHarnessQuestion(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  const adapter = getHarness(harness);
  if (!adapter?.respondQuestion) return;
  const activity = beginActivity(adapter, sessionId);
  try {
    adapter.respondQuestion(sessionId, requestId, reply);
  } finally {
    activity.finish();
  }
}

export function keepHarnessQuestionOpen(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
): void {
  const adapter = getHarness(harness);
  if (!adapter?.keepQuestionOpen) return;
  const activity = beginActivity(adapter, sessionId);
  try {
    adapter.keepQuestionOpen(sessionId, requestId);
  } finally {
    activity.finish();
  }
}

export async function stopHarnessSession(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  const adapter = getHarness(harness);
  if (!adapter) return;
  if (!adapter.live) {
    invalidateIdlePark(adapter, sessionId);
    return;
  }
  const finish = reserveActivity();
  invalidateIdlePark(adapter, sessionId);
  try {
    await adapter.stopSession(sessionId);
  } finally {
    finish();
  }
}

export async function forgetHarnessSession(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  const adapter = getHarness(harness);
  if (!adapter) return;
  const finish = reserveActivity();
  invalidateIdlePark(adapter, sessionId);
  try {
    await adapter.forgetSession(sessionId);
  } finally {
    finish();
  }
}

export function bindHarnessSession(
  harness: HarnessId,
  threadId: string,
  providerSessionId: string,
  cwd: string,
  providerAccountId?: string,
  /** Restored transcript, so the adapter can reseed its task state. */
  blocks?: Block[],
): void {
  const adapter = getHarness(harness);
  if (!adapter) return;
  invalidateIdlePark(adapter, threadId);
  adapter.bindSession(threadId, providerSessionId, cwd, providerAccountId);
  if (!blocks || !adapter?.restoreTaskLists) return;
  const lists = blocks.flatMap((block) =>
    block.role === "tasks" && block.taskList ? [block.taskList] : [],
  );
  if (lists.length > 0) adapter.restoreTaskLists(threadId, lists);
}

/**
 * Probe model lists only for the harnesses the caller actually needs.
 * Boot used to refresh every adapter; that spawned unused CLIs (Pi with
 * extensions can sit at ~1GB) even when the workspace never touched them.
 */
export async function refreshHarnessCatalogs(
  ids: Iterable<HarnessId>,
  options?: { force?: boolean },
): Promise<void> {
  const wanted = new Set(ids);
  if (wanted.size === 0) return;
  await Promise.all(
    [...adapters.values()]
      .filter((adapter) => wanted.has(adapter.id))
      .map(async (adapter) => {
        if (
          !adapter.refreshCatalog ||
          (!options?.force && hasLiveCatalog(adapter.id))
        )
          return;
        await adapter.refreshCatalog().catch((error: unknown) => {
          console.debug(`[voktty] ${adapter.id} catalog`, error);
        });
      }),
  );
}

export async function generateHarnessTitle(
  harness: HarnessId,
  input: TitleInput,
): Promise<GeneratedSessionTitle | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generateTitle) return null;
  return adapter.generateTitle(input);
}

export async function generateHarnessCommitMessage(
  harness: HarnessId,
  cwd: string,
  signal?: AbortSignal,
  context?: GitStagedContext,
): Promise<string> {
  const adapter = requireHarness(harness);
  if (!adapter.generateCommitMessage) {
    throw new Error(`${harness} does not support commit message generation`);
  }
  return adapter.generateCommitMessage(cwd, signal, context);
}

export async function generateHarnessPrContent(
  harness: HarnessId,
  cwd: string,
  context?: GitRangeContext,
): Promise<(PrContent & { base: string; head: string }) | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generatePrContent) return null;
  return adapter.generatePrContent(cwd, context);
}

export async function generateHarnessBranchName(
  harness: HarnessId,
  cwd: string,
  message: string,
): Promise<string | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generateBranchName) return null;
  return adapter.generateBranchName(cwd, message);
}

export async function warmupHarnessText(
  harness: HarnessId,
  cwd: string,
): Promise<void> {
  await getHarness(harness)?.warmupText?.(cwd);
}
