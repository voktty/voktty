import type { PrContent } from "../gitText";
import { hasLiveCatalog } from "../models";
import type { HarnessId, RuntimeMode } from "../session";
import { updateCodexRuntimeMode } from "./codex";
import type { ApprovalDecision, SendTurnInput, SteerTurnInput } from "./types";

export type TitleInput = {
  sessionId: string;
  cwd: string;
  message: string;
};

/**
 * Lifecycle contract for a live harness adapter.
 * App.tsx dispatches through the registry instead of harness-specific branches.
 */
export type HarnessAdapter = {
  id: HarnessId;
  /** True when this adapter can run live turns. */
  live: boolean;
  /** False when the harness cannot accept a follow-up while a turn is running. Default: same as live. */
  canSteer?: boolean;
  sendTurn(input: SendTurnInput): Promise<void>;
  steerTurn(input: SteerTurnInput): Promise<void>;
  cancelTurn(sessionId: string): Promise<void>;
  respondApproval(
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ): void;
  /** Kill the child but keep resume state for later rebind. */
  stopSession(sessionId: string): Promise<void>;
  /** Drop resume state and kill the child (delete, harness switch, idle detach). */
  forgetSession(sessionId: string): Promise<void>;
  /** Seed resume state from a restored MonoCode session. */
  bindSession(threadId: string, providerSessionId: string, cwd: string): void;
  /** Refresh the model catalog overlay when supported. */
  refreshCatalog?(): Promise<void>;
  /** Optional LLM tab title for the first turn. */
  generateTitle?(input: TitleInput): Promise<string | null>;
  /** Optional LLM commit message from staged changes. */
  generateCommitMessage?(cwd: string): Promise<string>;
  /** Optional LLM pull request title/body from branch diff context. */
  generatePrContent?(
    cwd: string,
  ): Promise<(PrContent & { base: string; head: string }) | null>;
  /** Optional LLM branch name from a user message. */
  generateBranchName?(cwd: string, message: string): Promise<string | null>;
  /** Optional warmup for text-generation backends. */
  warmupText?(cwd: string): Promise<void>;
};

const adapters = new Map<HarnessId, HarnessAdapter>();
const sessionOwners = new Map<string, HarnessId>();
const sessionTransitions = new Map<string, Promise<unknown>>();

/**
 * After a turn settles, keep the child warm for follow-ups, then park it.
 * Resume state stays, so the next prompt respawns instead of starting over.
 */
export const HARNESS_IDLE_PARK_MS = 5 * 60_000;
const idleParkTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelIdlePark(sessionId: string): void {
  const timer = idleParkTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  idleParkTimers.delete(sessionId);
}

function scheduleIdlePark(harness: HarnessId, sessionId: string): void {
  cancelIdlePark(sessionId);
  idleParkTimers.set(
    sessionId,
    setTimeout(() => {
      idleParkTimers.delete(sessionId);
      void stopHarnessSession(harness, sessionId);
    }, HARNESS_IDLE_PARK_MS),
  );
}

/** Test seam. */
export function resetHarnessIdlePark(): void {
  for (const timer of idleParkTimers.values()) clearTimeout(timer);
  idleParkTimers.clear();
  sessionOwners.clear();
  sessionTransitions.clear();
}

async function transitionSession<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = sessionTransitions.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  sessionTransitions.set(sessionId, current);
  try {
    return await current;
  } finally {
    if (sessionTransitions.get(sessionId) === current) {
      sessionTransitions.delete(sessionId);
    }
  }
}

async function claimHarnessSession(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  await transitionSession(sessionId, async () => {
    const previous = sessionOwners.get(sessionId);
    if (previous === harness) return;
    cancelIdlePark(sessionId);
    if (previous) {
      await getHarness(previous)
        ?.forgetSession(sessionId)
        .catch(() => undefined);
    }
    sessionOwners.set(sessionId, harness);
  });
}

export function registerHarness(adapter: HarnessAdapter): void {
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
  if (!adapter.live) {
    throw new Error(`${input.harness} is not connected yet`);
  }
  await claimHarnessSession(input.harness, input.sessionId);
  cancelIdlePark(input.sessionId);
  try {
    await adapter.sendTurn(input);
  } catch (error) {
    await transitionSession(input.sessionId, async () => {
      if (sessionOwners.get(input.sessionId) !== input.harness) return;
      sessionOwners.delete(input.sessionId);
      await adapter.stopSession(input.sessionId).catch(() => undefined);
    });
    throw error;
  } finally {
    if (sessionOwners.get(input.sessionId) === input.harness) {
      scheduleIdlePark(input.harness, input.sessionId);
    }
  }
}

export function canSteerHarness(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  if (!adapter?.live) return false;
  return adapter.canSteer !== false;
}

export async function steerHarnessTurn(
  input: SteerTurnInput & { harness: HarnessId },
): Promise<void> {
  const adapter = requireHarness(input.harness);
  if (!adapter.live) {
    throw new Error(`${input.harness} is not connected yet`);
  }
  cancelIdlePark(input.sessionId);
  await adapter.steerTurn(input);
}

export async function cancelHarnessTurn(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  const adapter = getHarness(harness);
  if (!adapter?.live) return;
  await transitionSession(sessionId, async () => {
    if (sessionOwners.get(sessionId) !== harness) return;
    cancelIdlePark(sessionId);
    await adapter.cancelTurn(sessionId);
    if (sessionOwners.get(sessionId) === harness) {
      scheduleIdlePark(harness, sessionId);
    }
  });
}

export function respondHarnessApproval(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  getHarness(harness)?.respondApproval(sessionId, requestId, decision);
}

export async function stopHarnessSession(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  const adapter = getHarness(harness);
  if (!adapter?.live) return;
  await transitionSession(sessionId, async () => {
    const owner = sessionOwners.get(sessionId);
    if (owner && owner !== harness) return;
    cancelIdlePark(sessionId);
    try {
      await adapter.stopSession(sessionId);
    } finally {
      if (sessionOwners.get(sessionId) === harness) {
        sessionOwners.delete(sessionId);
      }
    }
  });
}

export async function forgetHarnessSession(
  harness: HarnessId,
  sessionId: string,
): Promise<void> {
  const adapter = getHarness(harness);
  if (!adapter) return;
  await transitionSession(sessionId, async () => {
    const owner = sessionOwners.get(sessionId);
    if (owner && owner !== harness) return;
    cancelIdlePark(sessionId);
    try {
      await adapter.forgetSession(sessionId);
    } finally {
      if (sessionOwners.get(sessionId) === harness) {
        sessionOwners.delete(sessionId);
      }
    }
  });
}

export function bindHarnessSession(
  harness: HarnessId,
  threadId: string,
  providerSessionId: string,
  cwd: string,
): void {
  sessionOwners.set(threadId, harness);
  getHarness(harness)?.bindSession(threadId, providerSessionId, cwd);
}

/**
 * Probe model lists only for the harnesses the caller actually needs.
 * Boot used to refresh every adapter; that spawned unused CLIs (Pi with
 * extensions can sit at ~1GB) even when the workspace never touched them.
 */
export async function refreshHarnessCatalogs(
  ids: Iterable<HarnessId>,
): Promise<void> {
  const wanted = new Set(ids);
  if (wanted.size === 0) return;
  await Promise.all(
    [...adapters.values()]
      .filter((adapter) => wanted.has(adapter.id))
      .map(async (adapter) => {
        if (!adapter.refreshCatalog || hasLiveCatalog(adapter.id)) return;
        await adapter.refreshCatalog().catch((error: unknown) => {
          console.debug(`[monocode] ${adapter.id} catalog`, error);
        });
      }),
  );
}

export async function generateHarnessTitle(
  harness: HarnessId,
  input: TitleInput,
): Promise<string | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generateTitle) return null;
  return adapter.generateTitle(input);
}

export async function generateHarnessCommitMessage(
  harness: HarnessId,
  cwd: string,
): Promise<string> {
  const adapter = requireHarness(harness);
  if (!adapter.generateCommitMessage) {
    throw new Error(`${harness} does not support commit message generation`);
  }
  return adapter.generateCommitMessage(cwd);
}

export async function generateHarnessPrContent(
  harness: HarnessId,
  cwd: string,
): Promise<(PrContent & { base: string; head: string }) | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generatePrContent) return null;
  return adapter.generatePrContent(cwd);
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

export function updateHarnessRuntimeMode(
  harness: HarnessId,
  sessionId: string,
  mode: RuntimeMode,
): void {
  if (harness === "codex") {
    updateCodexRuntimeMode(sessionId, mode);
  }
}
