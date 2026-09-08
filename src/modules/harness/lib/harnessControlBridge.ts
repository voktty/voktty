/**
 * Minimal imperative bridge exposing mounted harness sessions to the control
 * plane (`voktty.harness.*`). Session state lives in local React state inside
 * `HarnessSessionView`; this module only lets that component register its own
 * read/submit closures so `useControlBridge` can reach them without touching
 * how sessions are stored today.
 */
import type { Attachment, HarnessId, Session } from "./session";
import { hasPendingApproval } from "./session";

export type HarnessSessionState = "idle" | "working" | "waiting" | "done";

export type HarnessSessionSnapshot = {
  sessionId: string;
  harness: HarnessId;
  cwd: string;
  title: string;
  state: HarnessSessionState;
};

export type HarnessSessionHandle = {
  getSession: () => Session;
  submit: (text: string, attachments?: Attachment[]) => Promise<void>;
};

const handles = new Map<string, HarnessSessionHandle>();

export function registerHarnessSessionHandle(
  sessionId: string,
  handle: HarnessSessionHandle,
): () => void {
  handles.set(sessionId, handle);
  return () => {
    if (handles.get(sessionId) === handle) handles.delete(sessionId);
  };
}

export function harnessSessionState(session: Session): HarnessSessionState {
  if (session.busy) return "working";
  if (hasPendingApproval(session.blocks)) return "waiting";
  if (session.blocks.some((block) => block.role === "user")) return "done";
  return "idle";
}

function snapshotOf(session: Session): HarnessSessionSnapshot {
  return {
    sessionId: session.id,
    harness: session.harness,
    cwd: session.cwd,
    title: session.title,
    state: harnessSessionState(session),
  };
}

/** Sessions currently mounted in a visible/active view. Not every open tab is included. */
export function listHarnessSessionSnapshots(): HarnessSessionSnapshot[] {
  return [...handles.values()].map((handle) => snapshotOf(handle.getSession()));
}

export function getHarnessSessionSnapshot(
  sessionId: string,
): HarnessSessionSnapshot | null {
  const handle = handles.get(sessionId);
  return handle ? snapshotOf(handle.getSession()) : null;
}

export function lastAssistantText(session: Session): string | null {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role === "assistant" && block.text.trim()) return block.text;
  }
  return null;
}

export type HarnessSessionResult = HarnessSessionSnapshot & {
  text: string | null;
};

export function getHarnessSessionResult(
  sessionId: string,
): HarnessSessionResult | null {
  const handle = handles.get(sessionId);
  if (!handle) return null;
  const session = handle.getSession();
  return { ...snapshotOf(session), text: lastAssistantText(session) };
}

export async function sendHarnessSessionMessage(
  sessionId: string,
  text: string,
): Promise<void> {
  const handle = handles.get(sessionId);
  if (!handle) {
    throw new Error(`no mounted harness session "${sessionId}"`);
  }
  await handle.submit(text);
}

const WAIT_POLL_MS = 150;

/**
 * Waits, within this single call, for the session to reach one of `states`.
 * Bounded by `timeoutMs` because the control-plane forwards every request
 * through a fixed-timeout Rust<->frontend round trip; a longer overall wait
 * is the caller's (voktty-cli's) job by calling this repeatedly.
 */
export async function waitForHarnessSession(
  sessionId: string,
  states: HarnessSessionState[],
  timeoutMs: number,
): Promise<{ reached: boolean; snapshot: HarnessSessionSnapshot }> {
  const targets =
    states.length > 0 ? states : (["done", "waiting"] as HarnessSessionState[]);
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    const snapshot = getHarnessSessionSnapshot(sessionId);
    if (!snapshot) {
      throw new Error(`no mounted harness session "${sessionId}"`);
    }
    if (targets.includes(snapshot.state)) {
      return { reached: true, snapshot };
    }
    if (Date.now() >= deadline) {
      return { reached: false, snapshot };
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
  }
}
