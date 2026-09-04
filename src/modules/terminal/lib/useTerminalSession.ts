import { ensureMonoFontsLoaded } from "@/lib/fonts";
import { IS_WINDOWS } from "@/lib/platform";
import { useDevServerCaptureStore } from "@/modules/preview/devServerStore";
import {
  beginConnectionAttempt,
  disconnectConnection,
  IDLE_CONNECTION_STATE,
  type ResourceConnectionState,
  requestConnectionCancellation,
  settleConnectionAttempt,
} from "@/modules/connections/lifecycle";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
  workspaceScopeKey,
} from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import type { SearchAddon } from "@xterm/addon-search";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BlockDecorations,
  type BlockMatch,
  type VisibleBlocks,
} from "../block/lib/blockDecorations";
import { historyRecord } from "../block/lib/history";
import type { BlockMode } from "../block/lib/modeMachine";
import { DormantRing } from "./dormantRing";
import {
  createShellIntegrationState,
  registerCwdHandler,
  registerOsc9ProgressHandler,
  registerOsc52ClipboardHandler,
  registerPromptTracker,
} from "./osc-handlers";
import {
  disposePtyTarget,
  getRemotePtyCwd,
  isGuestPtyTarget,
  openPty,
  type PtySession,
} from "./pty-bridge";
import { useTerminalProgressStore } from "./terminalProgressStore";
import "../block/block.css";
import {
  ensureAgentActivityListener,
  isAgentActivePty,
  touchAgentActivity,
  useAgentActivityStore,
} from "./agentActivity";
import {
  acquireSlot,
  applyBackgroundActive,
  applyCursorBlink,
  applyCursorStyle,
  applyLetterSpacing,
  applyTheme as applyPoolTheme,
  applyScrollback,
  applyTerminalFont,
  applyWebglPreference,
  configureRendererPool,
  discardRetainedSlot,
  disposeLeafSlot,
  focusSlot,
  getLiveSlotForLeaf,
  getSlotForLeaf,
  isLeafAltScreen,
  parkLeafSlot,
  poolSize,
  poolSlotStats,
  refreshLeafSlot,
  releaseSlot,
  setLeafCanonicalGrid,
  setSlotFocused,
} from "./rendererPool";
import { useTerminalFont } from "./useTerminalFont";

type Callbacks = {
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
  onTitle?: (title: string) => void;
};

type Session = {
  pty: PtySession | null;
  ptyOpening: boolean;
  workspaceEnv: WorkspaceEnv;
  shellOverride?: string;
  initialCwd: string | undefined;
  lastCwd: string | null;
  pendingExit: number | null;
  shellExited: boolean;
  callbacks: Callbacks;
  visibleNow: boolean;
  focusedNow: boolean;
  disposed: boolean;
  ready: Promise<void>;
  cols: number;
  rows: number;
  fixedGrid: boolean;
  container: HTMLDivElement | null;
  snapshot: string | null;
  searchQuery: string | null;
  dormantRing: DormantRing;
  pendingInput: string;
  hasSlot: boolean;
  blocks: boolean;
  blockMode: BlockMode;
  blockListeners: Set<() => void>;
  blockDecorations: BlockDecorations | null;
  // Set by the block shell-input; called to pull focus back when the xterm
  // grid steals it at the prompt (e.g. on a click), so typing stays in the bar.
  inputFocus: (() => void) | null;
  // Per-leaf unsent shell-input text; the single workspace bar swaps it on focus change.
  inputDraft: string;
  // Live "input has text" flag from the block shell-input (gates the watermark).
  inputActive: boolean;
  // A command was submitted on this leaf; kills the watermark synchronously,
  // before the shell's OSC 133 C round-trips through the PTY.
  everSubmitted: boolean;
  // True if the slot was in alt-screen mode (TUI like vim, htop, dofek)
  // at the most recent release. Read once on the next bind to trigger a
  // SIGWINCH-driven repaint instead of replaying dormant bytes.
  altScreenAtRelease: boolean;
  // OSC 133 C..D window (or blocks running mode): a foreground process owns
  // the terminal, so the leaf must keep its live grid while hidden.
  commandRunning: boolean;
  lastFailedExit: number | null;
  hiddenReleaseTimer: ReturnType<typeof setTimeout> | null;
  spawnFailed: boolean;
  connectionState: ResourceConnectionState;
};

const sessions = new Map<number, Session>();

const leafFailureListeners = new Map<
  number,
  Set<(code: number | null) => void>
>();

const leafStatusListeners = new Map<
  number,
  Set<(status: ResourceConnectionState) => void>
>();

function notifyLeafFailure(leafId: number, code: number | null): void {
  const set = leafFailureListeners.get(leafId);
  if (set) {
    for (const cb of set) cb(code);
  }
}

function setLeafConnectionState(
  leafId: number,
  session: Session,
  state: ResourceConnectionState,
): void {
  if (state === session.connectionState) return;
  session.connectionState = state;
  const set = leafStatusListeners.get(leafId);
  if (set) {
    for (const cb of set) cb(state);
  }
}

function beginLeafConnection(
  leafId: number,
  session: Session,
  phase: "connecting" | "reconnecting",
): number {
  const next = beginConnectionAttempt(session.connectionState, phase);
  setLeafConnectionState(leafId, session, next);
  return next.attempt;
}

function settleLeafConnection(
  leafId: number,
  session: Session,
  attempt: number,
  phase: "ready" | "failed" | "disconnected",
  error: string | null = null,
): void {
  setLeafConnectionState(
    leafId,
    session,
    settleConnectionAttempt(session.connectionState, attempt, phase, error),
  );
}

function connectionResult(state: ResourceConnectionState): void {
  if (state.phase === "ready") return;
  throw new Error(state.error ?? `terminal connection ${state.phase}`);
}

export function waitForLeafConnection(
  leafId: number,
  timeoutMs = 30_000,
): Promise<void> {
  const current = sessions.get(leafId)?.connectionState;
  if (
    current?.phase === "ready" ||
    current?.phase === "failed" ||
    current?.phase === "disconnected"
  ) {
    return Promise.resolve().then(() => connectionResult(current));
  }
  return new Promise((resolve, reject) => {
    let listeners = leafStatusListeners.get(leafId);
    if (!listeners) {
      listeners = new Set();
      leafStatusListeners.set(leafId, listeners);
    }
    const cleanup = () => {
      clearTimeout(timer);
      const live = leafStatusListeners.get(leafId);
      live?.delete(listener);
      if (live?.size === 0) leafStatusListeners.delete(leafId);
    };
    const listener = (state: ResourceConnectionState) => {
      if (
        state.phase !== "ready" &&
        state.phase !== "failed" &&
        state.phase !== "disconnected"
      ) {
        return;
      }
      cleanup();
      try {
        connectionResult(state);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("terminal connection timed out"));
    }, timeoutMs);
    listeners.add(listener);
  });
}

// Block-overlay viewport listeners, keyed by leafId at module scope so the
// overlay (a child) can subscribe before the parent effect creates the session.
const blockViewportListeners = new Map<number, Set<() => void>>();

// Scroll and line tracking listeners, keyed by leafId
const leafScrollListeners = new Map<number, Set<() => void>>();

export function notifyLeafScroll(leafId: number): void {
  const set = leafScrollListeners.get(leafId);
  if (set) {
    for (const cb of set) cb();
  }
}

export function subscribeLeafScroll(
  leafId: number,
  cb: () => void,
): () => void {
  let set = leafScrollListeners.get(leafId);
  if (!set) {
    set = new Set();
    leafScrollListeners.set(leafId, set);
  }
  set.add(cb);
  return () => {
    const live = leafScrollListeners.get(leafId);
    live?.delete(cb);
    if (live && live.size === 0) leafScrollListeners.delete(leafId);
  };
}

const readyLeaves = new Set<number>();
const readyWaiters = new Map<
  number,
  { resolve: () => void; timer: ReturnType<typeof setTimeout> }[]
>();

function markSessionReady(leafId: number): void {
  if (readyLeaves.has(leafId)) return;
  readyLeaves.add(leafId);
  const waiters = readyWaiters.get(leafId);
  if (!waiters) return;
  readyWaiters.delete(leafId);
  for (const w of waiters) {
    clearTimeout(w.timer);
    w.resolve();
  }
}

export function whenSessionReady(
  leafId: number,
  timeoutMs = 4000,
): Promise<void> {
  if (readyLeaves.has(leafId)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const arr = readyWaiters.get(leafId);
      const i = arr?.findIndex((w) => w.timer === timer) ?? -1;
      if (arr && i >= 0) arr.splice(i, 1);
      resolve();
    }, timeoutMs);
    const arr = readyWaiters.get(leafId) ?? [];
    arr.push({ resolve, timer });
    readyWaiters.set(leafId, arr);
  });
}

const PENDING_INPUT_MAX = 256 * 1024;

// Input typed before the pty attaches is queued and flushed on attach. Cap the
// queue so a large paste into a still-spawning pane can't grow it without bound.
function queuePendingInput(s: Session, data: string): void {
  if (s.pendingInput.length + data.length > PENDING_INPUT_MAX) return;
  s.pendingInput += data;
}

let lastFocusedLiveLeafId: number | null = null;

export function markLeafFocused(leafId: number): void {
  lastFocusedLiveLeafId = leafId;
}

export function writeToSession(leafId: number, data: string): boolean {
  lastFocusedLiveLeafId = leafId;
  const s = sessions.get(leafId);
  if (!s || s.shellExited) return false;
  if (s.pty) {
    void s.pty.write(data);
    return true;
  }
  queuePendingInput(s, data);
  return true;
}

export function submitToLeaf(leafId: number, text: string): void {
  lastFocusedLiveLeafId = leafId;
  const s = sessions.get(leafId);
  if (!s || s.shellExited) return;
  s.everSubmitted = true;
  const trimmed = text.trim();
  if (trimmed) {
    historyRecord(
      trimmed,
      s.workspaceEnv?.kind === "ssh" ||
        s.workspaceEnv?.kind === "docker" ||
        s.workspaceEnv?.kind === "wsl"
        ? "unix"
        : undefined,
      s.workspaceEnv?.kind,
    );
  }
  useTerminalProgressStore.getState().setLeafCommandStart(leafId, trimmed);
  // Bracketed paste keeps a multiline command atomic; trailing CR runs it.
  const data = text.includes("\n")
    ? `\x1b[200~${text}\x1b[201~\r`
    : `${text}\r`;
  if (s.pty) void s.pty.write(data);
  else queuePendingInput(s, data);
}

export function interruptLeaf(leafId: number): void {
  sessions.get(leafId)?.pty?.write("\x03");
}

export function getActiveTerminalLeafId(): number | null {
  // 1. If we have a tracked leaf that is still live and visible, return it
  if (lastFocusedLiveLeafId !== null) {
    const s = sessions.get(lastFocusedLiveLeafId);
    if (s && !s.disposed && !s.shellExited && s.visibleNow) {
      return lastFocusedLiveLeafId;
    }
  }

  // 2. Otherwise, check if any currently visible session has focusedNow == true
  for (const [leafId, s] of sessions.entries()) {
    if (!s.disposed && !s.shellExited && s.visibleNow && s.focusedNow) {
      return leafId;
    }
  }

  // 3. If no session has focusedNow, but lastFocusedLiveLeafId is live, return it
  if (lastFocusedLiveLeafId !== null) {
    const s = sessions.get(lastFocusedLiveLeafId);
    if (s && !s.disposed && !s.shellExited) {
      return lastFocusedLiveLeafId;
    }
  }

  // 4. Any live visible session
  for (const [leafId, s] of sessions.entries()) {
    if (!s.disposed && !s.shellExited && s.visibleNow) {
      return leafId;
    }
  }

  // 5. Fallback to any live non-exited session
  for (const [leafId, s] of sessions.entries()) {
    if (!s.disposed && !s.shellExited) return leafId;
  }
  return null;
}

export function getAnyLiveTerminalLeafId(): number | null {
  return getActiveTerminalLeafId();
}

export function leafCwd(leafId: number): string | null {
  return sessions.get(leafId)?.lastCwd ?? null;
}

export function navigateFocusedBlocks(dir: -1 | 1): boolean {
  for (const [, s] of sessions) {
    if (!s.visibleNow || !s.focusedNow || !s.blockDecorations) continue;
    s.blockDecorations.navigateBlocks(dir);
    return true;
  }
  return false;
}

export function clearLeafBlockSelection(leafId: number): boolean {
  return sessions.get(leafId)?.blockDecorations?.clearBlockSelection() ?? false;
}

export function leafGridSelection(leafId: number): string | null {
  const sel = getSlotForLeaf(leafId)?.term.getSelection() ?? "";
  return sel.length > 0 ? sel : null;
}

export function getLeafBlockMode(leafId: number): BlockMode {
  return sessions.get(leafId)?.blockMode ?? "prompt";
}

export function subscribeLeafBlockMode(
  leafId: number,
  cb: () => void,
): () => void {
  const s = sessions.get(leafId);
  if (!s) return () => {};
  s.blockListeners.add(cb);
  return () => {
    s.blockListeners.delete(cb);
  };
}

export function setLeafInputFocus(
  leafId: number,
  fn: (() => void) | null,
): void {
  const s = sessions.get(leafId);
  if (s) s.inputFocus = fn;
}

export function focusLeafInput(leafId: number): void {
  lastFocusedLiveLeafId = leafId;
  sessions.get(leafId)?.inputFocus?.();
}

export function getLeafDraft(leafId: number): string {
  return sessions.get(leafId)?.inputDraft ?? "";
}

export function setLeafDraft(leafId: number, text: string): void {
  const s = sessions.get(leafId);
  if (s) s.inputDraft = text;
}

export function setLeafInputActivity(leafId: number, active: boolean): void {
  const s = sessions.get(leafId);
  if (!s || s.inputActive === active) return;
  s.inputActive = active;
  const set = blockViewportListeners.get(leafId);
  if (set) for (const l of set) l();
}

export type WatermarkState = "visible" | "hidden" | "dead";

// Watermark gate: a block terminal that has never run a command, whose grid is
// still untouched, and whose input is empty. Synchronous so tab switches, slot
// rebinds and the Enter-to-OSC-133 gap never flash it over real content.
// "dead" is permanent and lets the component unmount for good. The grid check
// scans glyphs, not the cursor: the prompt integration prints a blank gap line
// at spawn, so the cursor sits below row 0 even on a visually empty terminal.
export function blockWatermarkState(leafId: number): WatermarkState {
  const s = sessions.get(leafId);
  if (!s || s.disposed) return "dead";
  if (s.everSubmitted || s.blockDecorations?.hasAnyBlock()) return "dead";
  if (!s.blockDecorations || s.inputActive) return "hidden";
  const slot = getSlotForLeaf(leafId);
  if (!slot) return "hidden";
  const buf = slot.term.buffer.active;
  if (buf.baseY > 0) return "dead";
  const rows = Math.min(buf.length, slot.term.rows);
  for (let i = 0; i < rows; i++) {
    if (buf.getLine(i)?.translateToString(true)) return "dead";
  }
  return "visible";
}

/**
 * Clear the scrollback and screen of the currently focused terminal, keeping
 * the active prompt line — macOS Terminal's ⌘K behaviour. Returns false when no
 * focused terminal slot is bound (e.g. focus is in the editor or AI panel).
 */
export function clearFocusedTerminal(): boolean {
  for (const [leafId, s] of sessions) {
    if (!s.visibleNow || !s.focusedNow) continue;
    const slot = getSlotForLeaf(leafId);
    if (!slot) continue;
    slot.term.clear();
    return true;
  }
  return false;
}

export function leafIdForPty(ptyId: number): number | null {
  for (const [leafId, s] of sessions) {
    if (s.pty?.id === ptyId) return leafId;
  }
  return null;
}

export function ptyIdForLeaf(leafId: number): number | null {
  return sessions.get(leafId)?.pty?.id ?? null;
}

export function leafHasKnownActivity(leafId: number): boolean {
  const session = sessions.get(leafId);
  return session !== undefined && leafBusy(session);
}

function leafBusy(s: Session): boolean {
  return s.commandRunning || (s.pty !== null && isAgentActivePty(s.pty.id));
}

const HIDDEN_RELEASE_DELAY_MS = 300;

// A parked hidden leaf went idle: give the post-command prompt a moment to
// render into the live buffer, then hand the slot back to the pool.
function scheduleHiddenRelease(leafId: number, s: Session): void {
  if (s.visibleNow || !s.hasSlot) return;
  cancelHiddenRelease(s);
  s.hiddenReleaseTimer = setTimeout(() => {
    s.hiddenReleaseTimer = null;
    if (s.disposed || s.visibleNow || !s.hasSlot) return;
    if (s.blocks || isLeafAltScreen(leafId) || leafBusy(s)) return;
    unbindLeafFromSlot(leafId, s);
  }, HIDDEN_RELEASE_DELAY_MS);
}

function cancelHiddenRelease(s: Session): void {
  if (s.hiddenReleaseTimer !== null) {
    clearTimeout(s.hiddenReleaseTimer);
    s.hiddenReleaseTimer = null;
  }
}

async function releaseIfIdle(leafId: number, s: Session): Promise<void> {
  const busy = await leafHasForegroundJob(leafId);
  if (busy || s.disposed || s.visibleNow || !s.hasSlot) return;
  if (s.blocks || isLeafAltScreen(leafId) || leafBusy(s)) return;
  unbindLeafFromSlot(leafId, s);
}

async function leafHasForegroundJob(leafId: number): Promise<boolean> {
  if (isGuestPtyTarget(leafId)) return false;
  const s = sessions.get(leafId);
  if (!s?.pty || s.shellExited) return false;
  try {
    return await invoke<boolean>("pty_has_foreground_job", { id: s.pty.id });
  } catch (e) {
    console.error("[voktty] pty_has_foreground_job failed for leaf", leafId, e);
    return false;
  }
}

function onLeafCommandState(
  leafId: number,
  running: boolean,
  exitCode?: number | null,
): void {
  const s = sessions.get(leafId);
  if (!s) return;
  if (running) {
    s.lastFailedExit = null;
    notifyLeafFailure(leafId, null);
    useTerminalProgressStore.getState().setLeafCommandStart(leafId);
    if (s.pty && !isGuestPtyTarget(leafId)) {
      touchAgentActivity(s.pty.id);
    }
  } else if (exitCode !== null && exitCode !== undefined && exitCode !== 0) {
    s.lastFailedExit = exitCode;
    notifyLeafFailure(leafId, exitCode);
    useTerminalProgressStore.getState().setLeafCommandEnd(leafId, exitCode);
    if (s.pty && !isGuestPtyTarget(leafId)) {
      const store = useAgentActivityStore.getState();
      if (store.phases[s.pty.id] === "working") {
        store.setPhase(s.pty.id, "idle");
      }
    }
  } else if (exitCode === 0) {
    s.lastFailedExit = null;
    notifyLeafFailure(leafId, null);
    useTerminalProgressStore.getState().setLeafCommandEnd(leafId, 0);
    if (s.pty && !isGuestPtyTarget(leafId)) {
      const store = useAgentActivityStore.getState();
      if (store.phases[s.pty.id] === "working") {
        store.setPhase(s.pty.id, "idle");
      }
    }
  } else {
    useTerminalProgressStore.getState().setLeafCommandEnd(leafId, null);
    if (s.pty && !isGuestPtyTarget(leafId)) {
      const store = useAgentActivityStore.getState();
      if (store.phases[s.pty.id] === "working") {
        store.setPhase(s.pty.id, "idle");
      }
    }
  }
  if (s.commandRunning !== running) {
    if (running) beginDevServerCommand(leafId, s);
    else useDevServerCaptureStore.getState().endCommand(leafId);
  }
  if (s.commandRunning === running) return;
  s.commandRunning = running;
  if (!running) {
    scheduleHiddenRelease(leafId, s);
    return;
  }
  cancelHiddenRelease(s);
  // A command started in a hidden released leaf (e.g. submitted by the AI):
  // rebind its retained slot so output parses live instead of filling the
  // ring. Deferred: this callback fires inside xterm's parse loop and the
  // rebind touches the same terminal (fit/resize).
  if (!s.visibleNow && !s.hasSlot && s.container && !s.disposed) {
    setTimeout(() => {
      if (s.disposed || s.visibleNow || s.hasSlot || !s.container) return;
      if (!leafBusy(s)) return;
      bindLeafToSlot(leafId, s);
      parkLeafSlot(leafId);
    }, 0);
  }
}

function beginDevServerCommand(leafId: number, session: Session): void {
  if (isGuestPtyTarget(leafId)) return;
  useDevServerCaptureStore.getState().beginCommand(leafId, {
    ptyId: session.pty?.id ?? null,
    workspaceKey: workspaceScopeKey(session.workspaceEnv),
    cwd: session.lastCwd ?? session.initialCwd ?? null,
  });
}

ensureAgentActivityListener((ptyId) => {
  const leafId = leafIdForPty(ptyId);
  if (leafId === null) return;
  const s = sessions.get(leafId);
  if (s) scheduleHiddenRelease(leafId, s);
});

configureRendererPool({
  resolveLeaf(leafId) {
    const s = sessions.get(leafId);
    if (!s) return null;
    return {
      writeToPty: (data) => {
        lastFocusedLiveLeafId = leafId;
        // Shell spawn failed (bad cwd, missing binary): Enter retries.
        if (s.spawnFailed) {
          if (data.includes("\r")) void respawnSession(leafId);
          return;
        }
        if (s.pty) void s.pty.write(data);
        else queuePendingInput(s, data);
      },
      resizePty: (cols, rows) => {
        if (s.fixedGrid) return;
        s.cols = cols;
        s.rows = rows;
        s.pty?.resize(cols, rows);
      },
      kickPty: (cols, rows) => {
        if (s.fixedGrid) return;
        const pty = s.pty;
        if (!pty || cols <= 0 || rows <= 0) return;
        // Linux only emits SIGWINCH when the winsize ioctl actually
        // changes dims, so bump +1 row then restore. The TUI receives
        // (possibly two) SIGWINCHes and repaints from scratch.
        pty
          .resize(cols, rows + 1)
          .then(() => pty.resize(cols, rows))
          .catch((e) => console.warn("[voktty] kickPty failed:", e));
      },
    };
  },
  evictLeaf(leafId) {
    const s = sessions.get(leafId);
    if (!s) return;
    unbindLeafFromSlot(leafId, s);
  },
  isLeafFocused(leafId) {
    const s = sessions.get(leafId);
    return !!s && s.visibleNow && s.focusedNow;
  },
  isLeafBlocks(leafId) {
    return sessions.get(leafId)?.blocks ?? false;
  },
  isLeafBusy(leafId) {
    const s = sessions.get(leafId);
    return !!s && leafBusy(s);
  },
  isLeafVisible(leafId) {
    return sessions.get(leafId)?.visibleNow ?? false;
  },
  storeSnapshot(leafId, out) {
    const s = sessions.get(leafId);
    if (!s) return;
    s.snapshot = out.snapshot;
    if (out.cols > 0) s.cols = out.cols;
    if (out.rows > 0) s.rows = out.rows;
    s.altScreenAtRelease = out.altScreen;
  },
  getSessionInfo(leafId) {
    const s = sessions.get(leafId);
    if (!s) return null;
    const isUnix =
      s.workspaceEnv.kind === "ssh" ||
      s.workspaceEnv.kind === "docker" ||
      s.workspaceEnv.kind === "wsl" ||
      !IS_WINDOWS;
    return {
      workspaceEnv: s.workspaceEnv,
      cwd: s.lastCwd || s.initialCwd || null,
      shellOverride: s.shellOverride,
      isUnix,
    };
  },
});

function ensureSession(
  leafId: number,
  initialCwd?: string,
  blocks = false,
  workspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE,
  shellOverride?: string,
): Session {
  const existing = sessions.get(leafId);
  if (existing) {
    if (isGuestPtyTarget(leafId)) existing.fixedGrid = true;
    if (!existing.pty && !existing.ptyOpening) {
      existing.workspaceEnv = workspaceEnv;
      if (shellOverride) existing.shellOverride = shellOverride;
    }
    return existing;
  }

  const session: Session = {
    pty: null,
    ptyOpening: false,
    workspaceEnv,
    shellOverride,
    initialCwd,
    lastCwd: null,
    pendingExit: null,
    shellExited: false,
    callbacks: {},
    visibleNow: false,
    focusedNow: false,
    disposed: false,
    ready: Promise.resolve(),
    cols: 0,
    rows: 0,
    fixedGrid: isGuestPtyTarget(leafId),
    container: null,
    snapshot: null,
    searchQuery: null,
    dormantRing: new DormantRing(),
    pendingInput: "",
    hasSlot: false,
    blocks,
    blockMode: "prompt",
    blockListeners: new Set(),
    blockDecorations: null,
    inputFocus: null,
    inputDraft: "",
    inputActive: false,
    everSubmitted: false,
    altScreenAtRelease: false,
    commandRunning: false,
    lastFailedExit: null,
    hiddenReleaseTimer: null,
    spawnFailed: false,
    connectionState: IDLE_CONNECTION_STATE,
  };
  sessions.set(leafId, session);

  session.ready = (async () => {
    await ensureMonoFontsLoaded();
    await document.fonts.ready;
  })();
  startPtyOpening(leafId, session, initialCwd);

  return session;
}

function deliverPtyBytes(leafId: number, bytes: Uint8Array): void {
  const s = sessions.get(leafId);
  if (!s) return;
  let devServerChunk: string | null = null;
  if (!isGuestPtyTarget(leafId)) {
    try {
      const chunk = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      useTerminalProgressStore.getState().processPtyOutput(leafId, chunk);
      devServerChunk = chunk;
    } catch {}
    if (s.pty !== null) touchAgentActivity(s.pty.id);
  }
  // Retained slots keep parsing live (render paused); the ring is only for
  // leaves whose buffer was stolen or never bound.
  const slot = getLiveSlotForLeaf(leafId);
  if (slot) {
    slot.term.write(bytes, () => {
      if (devServerChunk !== null) {
        useDevServerCaptureStore
          .getState()
          .processOutput(leafId, devServerChunk);
      }
    });
  } else {
    if (devServerChunk !== null) {
      useDevServerCaptureStore
        .getState()
        .processOutput(leafId, devServerChunk);
    }
    s.dormantRing.push(bytes);
  }
}

const SPAWN_RETRY_DELAY_MS = 250;

async function openPtyWithRetry(
  leafId: number,
  s: Session,
  cwd: string | undefined,
  attempt: number,
): Promise<PtySession> {
  try {
    return await openPtyForSession(leafId, s, cwd, attempt);
  } catch (e) {
    console.error("[voktty] openPty failed, retrying once:", e);
    await new Promise((r) => setTimeout(r, SPAWN_RETRY_DELAY_MS));
    if (
      s.disposed ||
      s.connectionState.attempt !== attempt ||
      s.connectionState.phase === "cancelling"
    ) {
      throw e;
    }
    return openPtyForSession(leafId, s, cwd, attempt);
  }
}

// Spawn failure must not flow through onExit: handleLeafExit closes the pane
// (or respawns the last one, which would loop). Show the error in the pane
// and let Enter retry instead of leaving a dead black grid.
function surfaceSpawnFailure(leafId: number, s: Session, e: unknown): string {
  console.error("[voktty] shell spawn failed:", e);
  s.shellExited = true;
  s.spawnFailed = true;
  const detail = String(e)
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, 300);
  deliverPtyBytes(
    leafId,
    new TextEncoder().encode(
      `\r\n\x1b[31m[voktty] failed to start shell: ${detail}\x1b[0m\r\n\x1b[2mpress Enter to retry\x1b[0m\r\n`,
    ),
  );
  return detail;
}

function startPtyOpening(
  leafId: number,
  session: Session,
  cwd: string | undefined,
): void {
  if (
    session.pty ||
    session.ptyOpening ||
    session.shellExited ||
    session.disposed
  ) {
    return;
  }
  session.ptyOpening = true;
  const attempt = beginLeafConnection(leafId, session, "connecting");
  void openPtyWithRetry(leafId, session, cwd, attempt)
    .then((pty) => {
      const cancelled = session.connectionState.phase === "cancelling";
      if (
        session.disposed ||
        session.connectionState.attempt !== attempt ||
        cancelled
      ) {
        void pty.close();
        if (cancelled && session.connectionState.attempt === attempt) {
          session.ptyOpening = false;
          session.shellExited = true;
          settleLeafConnection(leafId, session, attempt, "disconnected");
        }
        return;
      }
      session.ptyOpening = false;
      session.pty = pty;
      settleLeafConnection(leafId, session, attempt, "ready");
      if (session.pendingInput) {
        void pty.write(session.pendingInput);
        session.pendingInput = "";
      }
      if (session.cols > 0 && session.rows > 0) {
        void pty.resize(session.cols, session.rows);
      }
    })
    .catch((error) => {
      if (session.connectionState.attempt !== attempt) return;
      session.ptyOpening = false;
      if (session.disposed) return;
      if (session.connectionState.phase === "cancelling") {
        session.shellExited = true;
        settleLeafConnection(leafId, session, attempt, "disconnected");
        return;
      }
      const detail = surfaceSpawnFailure(leafId, session, error);
      settleLeafConnection(leafId, session, attempt, "failed", detail);
    });
}

async function openPtyForSession(
  leafId: number,
  s: Session,
  cwd: string | undefined,
  attempt: number,
): Promise<PtySession> {
  const startCols = s.cols > 0 ? s.cols : 80;
  const startRows = s.rows > 0 ? s.rows : 24;
  const pty = await openPty(
    startCols,
    startRows,
    {
      onData: (bytes) => deliverPtyBytes(leafId, bytes),
      onResize: (cols, rows) => {
        if (cols <= 0 || rows <= 0) return;
        s.fixedGrid = true;
        s.cols = cols;
        s.rows = rows;
        setLeafCanonicalGrid(leafId, cols, rows);
      },
      onExit: (code) => {
        if (s.connectionState.attempt !== attempt) return;
        s.shellExited = true;
        s.pty = null;
        s.pendingInput = "";
        s.commandRunning = false;
        useDevServerCaptureStore.getState().clearLeaf(leafId);
        setLeafConnectionState(
          leafId,
          s,
          disconnectConnection(
            s.connectionState,
            code === 0 ? null : `process exited with code ${code}`,
          ),
        );
        const slot = getSlotForLeaf(leafId);
        if (slot) slot.term.options.disableStdin = true;
        scheduleHiddenRelease(leafId, s);
        if (s.callbacks.onExit) s.callbacks.onExit(code);
        else s.pendingExit = code;
      },
    },
    cwd,
    s.blocks,
    s.shellOverride ||
      usePreferencesStore.getState().terminalShell ||
      undefined,
    leafId,
    s.workspaceEnv,
  );
  // Only resize if the bound dims changed during the spawn: a same-size
  // ResizePseudoConsole during conhost warmup is a known ConPTY trigger for
  // a console that never renders (blank tab).
  if (
    s.cols > 0 &&
    s.rows > 0 &&
    (s.cols !== startCols || s.rows !== startRows)
  ) {
    void pty.resize(s.cols, s.rows);
  }
  return pty;
}

function applyBlockMode(leafId: number, mode: BlockMode): void {
  const s = sessions.get(leafId);
  if (!s) return;
  s.blockMode = mode;
  const running = mode !== "prompt";
  if (s.commandRunning !== running) {
    if (running) beginDevServerCommand(leafId, s);
    else useDevServerCaptureStore.getState().endCommand(leafId);
  }
  s.commandRunning = running;
  if (running) {
    useTerminalProgressStore.getState().setLeafCommandStart(leafId);
  }
  const slot = getSlotForLeaf(leafId);
  if (slot) {
    const prompt = mode === "prompt";
    slot.term.options.disableStdin = prompt;
    // Disable the helper textarea at the prompt so a grid click can't focus the
    // xterm (no flashing cursor) and can't steal focus from the shell input.
    if (slot.term.textarea) slot.term.textarea.disabled = prompt;
    if (!prompt) {
      slot.term.focus();
    } else if (s.visibleNow && s.focusedNow) {
      const inputFocus = s.inputFocus;
      if (inputFocus) setTimeout(inputFocus, 0);
    }
  }
  for (const l of s.blockListeners) l();
}

function bindLeafToSlot(leafId: number, s: Session): void {
  if (!s.container) return;
  const altScreen = s.altScreenAtRelease;
  s.altScreenAtRelease = false;
  acquireSlot({
    leafId,
    container: s.container,
    snapshot: s.snapshot,
    altScreen,
    drainRing: (write) => s.dormantRing.drain(write),
    // Keep stdin alive after a spawn failure so Enter can trigger the retry.
    shellExited: s.shellExited && !s.spawnFailed,
    searchQuery: s.searchQuery,
    cols: s.cols,
    rows: s.rows,
    fixedGrid: s.fixedGrid,
    registerOsc: (term) => {
      const osc9 = registerOsc9ProgressHandler(term, (p) => {
        if (p.state === "none") {
          useTerminalProgressStore.getState().setLeafCommandEnd(leafId, 0);
        } else if (p.state === "error") {
          useTerminalProgressStore
            .getState()
            .setLeafProgress(leafId, p.progress, "failed");
        } else {
          useTerminalProgressStore
            .getState()
            .setLeafProgress(leafId, p.progress, "running");
        }
      });
      const onScrollDisposable = term.onScroll(() => {
        notifyLeafScroll(leafId);
      });
      const onWriteDisposable = term.onWriteParsed(() => {
        notifyLeafScroll(leafId);
      });
      if (s.blocks) {
        const osc52 = registerOsc52ClipboardHandler(term);
        const deco = new BlockDecorations(term, {
          onCwd: (next) => {
            markSessionReady(leafId);
            if (s.lastCwd === next) return;
            s.lastCwd = next;
            s.callbacks.onCwd?.(next);
          },
          onMode: (mode) => applyBlockMode(leafId, mode),
          onViewport: () => {
            const set = blockViewportListeners.get(leafId);
            if (set) for (const l of set) l();
          },
        });
        s.blockDecorations = deco;
        const onGridFocus = () => {
          if (s.blockMode === "prompt") s.inputFocus?.();
        };
        term.textarea?.addEventListener("focus", onGridFocus);
        return [
          () => {
            s.blockDecorations = null;
            osc52();
            osc9();
            onScrollDisposable.dispose();
            onWriteDisposable.dispose();
            deco.dispose();
            term.textarea?.removeEventListener("focus", onGridFocus);
          },
        ];
      }
      // Shared in-command flag; see osc-handlers.ts. The prompt tracker
      // flips it on OSC 133 B/C/D/A; the cwd handler reads it to ignore OSC
      // 7 emitted by untrusted command output (remote SSH, `cat` of an
      // attacker file, etc.).
      const shellState = createShellIntegrationState();
      const prompt = registerPromptTracker(
        term,
        shellState,
        (running, exitCode) => onLeafCommandState(leafId, running, exitCode),
      );
      const cwd = registerCwdHandler(
        term,
        (next) => {
          markSessionReady(leafId);
          if (s.lastCwd === next) return;
          s.lastCwd = next;
          s.callbacks.onCwd?.(next);
        },
        shellState,
      );
      const osc52 = registerOsc52ClipboardHandler(term);
      let lastReportedTitle: string | null = null;
      const titleDisposable = term.onTitleChange((newTitle) => {
        const trimmed = (newTitle || "").trim();
        if (trimmed && trimmed !== lastReportedTitle) {
          lastReportedTitle = trimmed;
          s.callbacks.onTitle?.(trimmed);
        }
      });
      return [
        prompt.dispose,
        cwd,
        osc52,
        osc9,
        () => titleDisposable.dispose(),
        () => {
          onScrollDisposable.dispose();
          onWriteDisposable.dispose();
        },
      ];
    },
    onSearchReady: (addon) => s.callbacks.onSearchReady?.(addon),
  });
  s.snapshot = null;
  s.hasSlot = true;
  if (s.blocks) applyBlockMode(leafId, s.blockMode);
  if (s.lastCwd !== null) s.callbacks.onCwd?.(s.lastCwd);
  if (s.pendingExit !== null) {
    const code = s.pendingExit;
    s.pendingExit = null;
    s.callbacks.onExit?.(code);
  }
}

function unbindLeafFromSlot(leafId: number, s: Session): void {
  if (!s.hasSlot) return;
  const out = releaseSlot(leafId);
  if (out) {
    if (out.cols > 0) s.cols = out.cols;
    if (out.rows > 0) s.rows = out.rows;
  }
  s.hasSlot = false;
}

function attachSession(
  leafId: number,
  container: HTMLDivElement,
  callbacks: Callbacks,
): void {
  const s = sessions.get(leafId);
  if (!s || s.disposed) return;
  s.callbacks = callbacks;
  s.container = container;
  if (s.visibleNow) bindLeafToSlot(leafId, s);
  startPtyOpening(leafId, s, s.initialCwd);
}

function detachSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  unbindLeafFromSlot(leafId, s);
  s.callbacks = {};
  s.container = null;
}

export async function respawnSession(
  leafId: number,
  cwd?: string,
): Promise<void> {
  const s = sessions.get(leafId);
  if (!s || s.disposed) return;
  const previousPty = s.pty;
  s.pty = null;
  s.snapshot = null;
  s.dormantRing = new DormantRing();
  s.shellExited = false;
  s.pendingExit = null;
  s.pendingInput = "";
  s.altScreenAtRelease = false;
  s.commandRunning = false;
  useDevServerCaptureStore.getState().clearLeaf(leafId);
  s.spawnFailed = false;
  cancelHiddenRelease(s);
  const slot = getSlotForLeaf(leafId);
  if (slot) {
    slot.term.options.disableStdin = false;
    slot.term.clear();
    slot.term.reset();
  } else {
    discardRetainedSlot(leafId);
  }
  const attempt = beginLeafConnection(leafId, s, "reconnecting");
  void previousPty?.close();
  s.ptyOpening = true;
  let pty: PtySession;
  try {
    pty = await openPtyWithRetry(leafId, s, cwd ?? s.initialCwd, attempt);
  } catch (e) {
    if (s.connectionState.attempt !== attempt) return;
    s.ptyOpening = false;
    if (s.disposed) return;
    if (s.connectionState.phase === "cancelling") {
      s.shellExited = true;
      settleLeafConnection(leafId, s, attempt, "disconnected");
      return;
    }
    const detail = surfaceSpawnFailure(leafId, s, e);
    settleLeafConnection(leafId, s, attempt, "failed", detail);
    return;
  }
  const cancelled = s.connectionState.phase === "cancelling";
  if (s.disposed || s.connectionState.attempt !== attempt || cancelled) {
    void pty.close();
    if (cancelled && s.connectionState.attempt === attempt) {
      s.ptyOpening = false;
      s.shellExited = true;
      settleLeafConnection(leafId, s, attempt, "disconnected");
    }
    return;
  }
  s.ptyOpening = false;
  s.pty = pty;
  settleLeafConnection(leafId, s, attempt, "ready");
  if (s.pendingInput) {
    void pty.write(s.pendingInput);
    s.pendingInput = "";
  }
  if (s.cols > 0 && s.rows > 0) pty.resize(s.cols, s.rows);
}

export function cancelSessionConnection(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s || s.disposed || !s.ptyOpening) return;
  setLeafConnectionState(
    leafId,
    s,
    requestConnectionCancellation(s.connectionState),
  );
}

export async function leafHasForegroundProcess(
  leafId: number,
): Promise<boolean> {
  if (isGuestPtyTarget(leafId)) return false;
  const s = sessions.get(leafId);
  if (!s?.pty || s.shellExited) return false;
  try {
    const result = await invoke<boolean>("pty_has_foreground_process", {
      id: s.pty.id,
    });
    return result;
  } catch (e) {
    console.error(
      "[voktty] pty_has_foreground_process failed for leaf",
      leafId,
      e,
    );
    return false;
  }
}

export function disposeSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) {
    useDevServerCaptureStore.getState().clearLeaf(leafId);
    disposePtyTarget(leafId);
    return;
  }
  s.disposed = true;
  setLeafConnectionState(
    leafId,
    s,
    disconnectConnection(s.connectionState, "connection cancelled"),
  );
  cancelHiddenRelease(s);
  disposeLeafSlot(leafId);
  s.hasSlot = false;
  s.snapshot = null;
  s.pty?.close();
  s.pty = null;
  s.pendingInput = "";
  useDevServerCaptureStore.getState().clearLeaf(leafId);
  sessions.delete(leafId);
  disposePtyTarget(leafId);
  blockViewportListeners.delete(leafId);
  readyLeaves.delete(leafId);
  const waiters = readyWaiters.get(leafId);
  if (waiters) {
    readyWaiters.delete(leafId);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve();
    }
  }
}

type Options = {
  leafId: number;
  container: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  focused?: boolean;
  initialCwd?: string;
  workspaceEnv?: WorkspaceEnv;
  shellOverride?: string;
  blocks?: boolean;
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
  onTitle?: (title: string) => void;
};

export function useTerminalSession({
  leafId,
  container,
  visible,
  focused = true,
  initialCwd,
  workspaceEnv = LOCAL_WORKSPACE,
  shellOverride,
  blocks = false,
  onSearchReady,
  onExit,
  onCwd,
  onTitle,
}: Options) {
  const cbRef = useRef({ onSearchReady, onExit, onCwd, onTitle });
  cbRef.current = { onSearchReady, onExit, onCwd, onTitle };

  // initialCwd seeds the first PTY spawn only. It must NOT be an effect dep:
  // OSC 7 updates the leaf cwd on every `cd`, and re-running the bind effect
  // would detach/rebind the renderer slot (disposing block markers) on each cd.
  const initialCwdRef = useRef(initialCwd);
  initialCwdRef.current = initialCwd;

  useEffect(() => {
    let cancelled = false;
    const s = ensureSession(
      leafId,
      initialCwdRef.current,
      blocks,
      workspaceEnv,
      shellOverride,
    );
    s.ready.then(() => {
      if (cancelled || s.disposed) return;
      const node = container.current;
      if (!node) return;
      attachSession(leafId, node, {
        onSearchReady: (a) => cbRef.current.onSearchReady?.(a),
        onExit: (c) => cbRef.current.onExit?.(c),
        onCwd: (c) => cbRef.current.onCwd?.(c),
        onTitle: (t) => cbRef.current.onTitle?.(t),
      });
      if (s.visibleNow && s.focusedNow && !s.blocks) focusSlot(leafId);
    });
    return () => {
      cancelled = true;
      detachSession(leafId);
    };
  }, [leafId, container, blocks, workspaceEnv, shellOverride]);

  const [blockMode, setBlockMode] = useState<BlockMode>("prompt");
  useEffect(() => {
    if (!blocks) return;
    const s = ensureSession(
      leafId,
      initialCwdRef.current,
      blocks,
      workspaceEnv,
      shellOverride,
    );
    setBlockMode(s.blockMode);
    const cb = () => setBlockMode(sessions.get(leafId)?.blockMode ?? "prompt");
    s.blockListeners.add(cb);
    return () => {
      s.blockListeners.delete(cb);
    };
  }, [leafId, blocks, workspaceEnv]);

  const { fontFamily, fontWeight, fontSize } = useTerminalFont();
  const zoomLevel = usePreferencesStore((p) => p.zoomLevel);
  useLayoutEffect(() => {
    applyTerminalFont({
      fontFamily,
      fontWeight,
      fontSize: Math.max(4, Math.round(fontSize * zoomLevel)),
    });
  }, [fontFamily, fontWeight, fontSize, zoomLevel]);

  const letterSpacing = usePreferencesStore((p) => p.terminalLetterSpacing);
  useEffect(() => {
    applyLetterSpacing(letterSpacing);
  }, [letterSpacing]);

  const scrollback = usePreferencesStore((p) => p.terminalScrollback);
  useEffect(() => {
    applyScrollback(scrollback);
  }, [scrollback]);

  const webglPref = usePreferencesStore((p) => p.terminalWebglEnabled);
  useEffect(() => {
    applyWebglPreference(webglPref);
  }, [webglPref]);

  const cursorBlink = usePreferencesStore((p) => p.terminalCursorBlink);
  useEffect(() => {
    applyCursorBlink(cursorBlink);
  }, [cursorBlink]);

  const cursorStyle = usePreferencesStore((p) => p.terminalCursorStyle);
  useEffect(() => {
    applyCursorStyle(cursorStyle);
  }, [cursorStyle]);

  const bgActive = usePreferencesStore(
    (p) => p.backgroundKind === "image" && !!p.backgroundImageId,
  );
  useEffect(() => {
    applyBackgroundActive(bgActive);
  }, [bgActive]);

  useEffect(() => {
    const s = sessions.get(leafId);
    if (!s) return;
    s.visibleNow = visible;
    s.focusedNow = focused;
    if (visible) {
      if (focused) {
        lastFocusedLiveLeafId = leafId;
      }
      cancelHiddenRelease(s);
      if (s.container && !s.hasSlot) bindLeafToSlot(leafId, s);
      else if (s.hasSlot) refreshLeafSlot(leafId);
      setSlotFocused(leafId, focused);
      if (focused && !blocks) focusSlot(leafId);
    } else if (s.hasSlot) {
      // Always park first (keeps the grid live, pauses rendering); release
      // only after confirming nothing owns the terminal. Sync signals (OSC
      // 133, agent detect) short-circuit; the async foreground-process check
      // covers shells without integration.
      parkLeafSlot(leafId);
      if (!s.blocks && !isLeafAltScreen(leafId) && !leafBusy(s)) {
        void releaseIfIdle(leafId, s);
      }
    }
  }, [leafId, visible, focused, blocks]);

  const [failedExit, setFailedExit] = useState<number | null>(
    () => sessions.get(leafId)?.lastFailedExit ?? null,
  );

  useEffect(() => {
    let set = leafFailureListeners.get(leafId);
    if (!set) {
      set = new Set();
      leafFailureListeners.set(leafId, set);
    }
    const listener = (code: number | null) => setFailedExit(code);
    set.add(listener);
    return () => {
      const live = leafFailureListeners.get(leafId);
      live?.delete(listener);
      if (live && live.size === 0) leafFailureListeners.delete(leafId);
    };
  }, [leafId]);

  const clearFailedExit = useCallback(() => {
    const s = sessions.get(leafId);
    if (s) s.lastFailedExit = null;
    setFailedExit(null);
  }, [leafId]);

  const write = useCallback(
    (data: string) => {
      const s = sessions.get(leafId);
      if (!s || s.shellExited) return;
      if (s.pty) void s.pty.write(data);
      else queuePendingInput(s, data);
    },
    [leafId],
  );

  const focus = useCallback(() => focusSlot(leafId), [leafId]);

  const getBuffer = useCallback(
    (maxLines = 200): string | null => {
      const s = sessions.get(leafId);
      if (!s) return null;
      const slot = getLiveSlotForLeaf(leafId);
      if (slot) {
        const buf = slot.term.buffer.active;
        const total = buf.length;
        const lines: string[] = [];
        const start = Math.max(0, total - maxLines);
        for (let i = start; i < total; i++) {
          lines.push(buf.getLine(i)?.translateToString(true) ?? "");
        }
        while (lines.length && lines[lines.length - 1] === "") lines.pop();
        return lines.join("\n");
      }
      if (!s.snapshot) return "";
      const plain = stripAnsi(s.snapshot);
      const lines = plain.split(/\r?\n/);
      const tail = lines.slice(-maxLines);
      while (tail.length && tail[tail.length - 1] === "") tail.pop();
      return tail.join("\n");
    },
    [leafId],
  );

  const getSelection = useCallback((): string | null => {
    const slot = getSlotForLeaf(leafId);
    const sel = slot?.term.getSelection() ?? "";
    return sel.length > 0 ? sel : null;
  }, [leafId]);

  const applyTheme = useCallback(() => {
    applyPoolTheme();
  }, []);

  const selectBlockAt = useCallback(
    (clientY: number) =>
      sessions.get(leafId)?.blockDecorations?.selectBlockAt(clientY),
    [leafId],
  );

  const readBlockId = useCallback(
    (id: string) =>
      sessions.get(leafId)?.blockDecorations?.readById(id) ?? null,
    [leafId],
  );

  const subscribeBlocks = useCallback(
    (cb: () => void) => {
      let set = blockViewportListeners.get(leafId);
      if (!set) {
        set = new Set();
        blockViewportListeners.set(leafId, set);
      }
      set.add(cb);
      return () => {
        const live = blockViewportListeners.get(leafId);
        live?.delete(cb);
        if (live && live.size === 0) blockViewportListeners.delete(leafId);
      };
    },
    [leafId],
  );

  const visibleBlocks = useCallback(
    (): VisibleBlocks =>
      sessions.get(leafId)?.blockDecorations?.visibleBlocks() ?? {
        blocks: [],
        sticky: null,
      },
    [leafId],
  );

  const searchBlock = useCallback(
    (id: string, query: string) =>
      sessions.get(leafId)?.blockDecorations?.searchBlock(id, query) ?? [],
    [leafId],
  );

  const revealMatch = useCallback(
    (m: BlockMatch) => sessions.get(leafId)?.blockDecorations?.revealMatch(m),
    [leafId],
  );

  const clearSearch = useCallback(
    () => sessions.get(leafId)?.blockDecorations?.clearSearch(),
    [leafId],
  );

  const [connectionState, setConnectionState] =
    useState<ResourceConnectionState>(
      () => sessions.get(leafId)?.connectionState ?? IDLE_CONNECTION_STATE,
    );

  useEffect(() => {
    let set = leafStatusListeners.get(leafId);
    if (!set) {
      set = new Set();
      leafStatusListeners.set(leafId, set);
    }
    const listener = (state: ResourceConnectionState) =>
      setConnectionState(state);
    set.add(listener);
    const current = sessions.get(leafId)?.connectionState;
    if (current) setConnectionState(current);
    return () => {
      const live = leafStatusListeners.get(leafId);
      live?.delete(listener);
      if (live && live.size === 0) leafStatusListeners.delete(leafId);
    };
  }, [leafId]);

  const respawn = useCallback(() => {
    void respawnSession(leafId);
  }, [leafId]);

  const cancelConnection = useCallback(() => {
    cancelSessionConnection(leafId);
  }, [leafId]);

  return useMemo(
    () => ({
      write,
      focus,
      getBuffer,
      getSelection,
      applyTheme,
      blockMode,
      selectBlockAt,
      readBlockId,
      subscribeBlocks,
      visibleBlocks,
      searchBlock,
      revealMatch,
      clearSearch,
      failedExit,
      clearFailedExit,
      connectionState,
      connectionStatus: connectionState.phase,
      respawn,
      cancelConnection,
    }),
    [
      write,
      focus,
      getBuffer,
      getSelection,
      applyTheme,
      blockMode,
      selectBlockAt,
      readBlockId,
      subscribeBlocks,
      visibleBlocks,
      searchBlock,
      revealMatch,
      clearSearch,
      failedExit,
      clearFailedExit,
      connectionState,
      respawn,
      cancelConnection,
    ],
  );
}

const ANSI_RE =
  /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][AB012]|\x1b[78=>]|\x1bc|\x1b[NOP\]X^_]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export type TerminalScrollInfo = {
  isScrolledUp: boolean;
  linesAbove: number;
  snippet: string;
};

export function getLeafScrollInfo(leafId: number): TerminalScrollInfo {
  const slot = getLiveSlotForLeaf(leafId);
  if (!slot) {
    return { isScrolledUp: false, linesAbove: 0, snippet: "" };
  }
  const buffer = slot.term.buffer.active;
  const linesAbove = Math.max(0, buffer.baseY - buffer.viewportY);
  const isScrolledUp = linesAbove > 1;
  let snippet = "";
  if (isScrolledUp) {
    const maxRow = Math.min(buffer.length, buffer.baseY + slot.term.rows);
    for (let y = maxRow - 1; y >= 0; y--) {
      const line = buffer.getLine(y);
      if (line) {
        const str = stripAnsi(line.translateToString(true)).trim();
        if (str.length > 0) {
          snippet = str;
          break;
        }
      }
    }
  }
  return { isScrolledUp, linesAbove, snippet };
}

export function scrollLeafToBottom(leafId: number): void {
  const slot = getLiveSlotForLeaf(leafId);
  if (slot) {
    slot.term.scrollToBottom();
    slot.term.focus();
  }
  const s = sessions.get(leafId);
  if (s?.blockMode === "prompt") {
    s.inputFocus?.();
    focusLeafInput(leafId);
  }
  notifyLeafScroll(leafId);
}

export function getLeafTerminalStats(leafId: number): {
  cols: number;
  rows: number;
  bufferLines: number;
} | null {
  const slot = getLiveSlotForLeaf(leafId);
  if (!slot) return null;
  return {
    cols: slot.term.cols,
    rows: slot.term.rows,
    bufferLines: slot.term.buffer.active.length,
  };
}

export async function getLiveLeafCwd(leafId: number): Promise<string | null> {
  const s = sessions.get(leafId);
  if (!s) return null;
  if (
    s.workspaceEnv.kind === "ssh" &&
    s.workspaceEnv.sessionId !== undefined &&
    s.pty
  ) {
    try {
      const cwd = await getRemotePtyCwd(s.workspaceEnv.sessionId, s.pty.id);
      if (cwd) {
        if (s.lastCwd !== cwd) {
          s.lastCwd = cwd;
          s.callbacks.onCwd?.(cwd);
        }
        return cwd;
      }
    } catch {}
  }
  return s.lastCwd;
}

export function terminalDebugStats() {
  const liveSessions = [...sessions.entries()].map(([leafId, s]) => ({
    leafId,
    pty: !!s.pty,
    visible: s.visibleNow,
    focused: s.focusedNow,
    hasSlot: s.hasSlot,
    ringBytes: s.dormantRing.byteLength(),
    snapshotLen: s.snapshot?.length ?? 0,
    shellExited: s.shellExited,
  }));
  const ringTotal = liveSessions.reduce((n, s) => n + s.ringBytes, 0);
  const snapshotTotal = liveSessions.reduce((n, s) => n + s.snapshotLen, 0);
  const slots = poolSlotStats();
  return {
    poolSize: poolSize(),
    webglContexts: slots.filter((s) => s.webgl).length,
    idleSlots: slots.filter((s) => s.leafId === null).length,
    slots,
    sessionCount: liveSessions.length,
    sessions: liveSessions,
    ringBytesTotal: ringTotal,
    snapshotCharsTotal: snapshotTotal,
    domCanvases: document.querySelectorAll("canvas").length,
    domScreens: document.querySelectorAll(".xterm-screen").length,
    domRows: document.querySelectorAll(".xterm-rows > div").length,
    jsHeapBytes:
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize ?? null,
  };
}

if (import.meta.env?.DEV && typeof window !== "undefined") {
  (window as unknown as { __vokttyTerm?: unknown }).__vokttyTerm =
    terminalDebugStats;
}
