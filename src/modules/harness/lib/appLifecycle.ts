import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  bindHarnessSession,
  forgetHarnessSession,
  isLiveHarness,
} from "./harness/registry";
import { killAllChildren } from "./harness/child";
import {
  hasInFlightSessions,
  inFlightRefs,
  markTurnInterrupted,
  quitWhileBusyMessage,
  wasTurnInterrupted,
  workspaceFromResumed,
  type ResumedWorkspace,
} from "./inFlight";
import { leafIds, type WorkspaceTab } from "./layout";
import { killPty } from "./pty";
import {
  projectTerminalFileIds,
  type ProjectTerminalDock,
} from "./projectTerminal";
import { sessionWorkCwd, type Session } from "./session";
import { restoreSessionCheckout } from "./fs";
import { sessionChildHarnesses } from "./handoff";
import {
  getSession,
  listInFlightSessions,
  loadWorkspaceSnapshot,
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
  upsertSessions,
} from "./sessionStore";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
  parseWorkspaceSnapshot,
} from "./workspaceSnapshot";
import { loadWindowTransfer } from "./windowTransferBootstrap";
import type { WindowTransferPayload } from "./windowTransfer";
import type { ProjectReturnMemory } from "./projectReturn";
import {
  windowPersistenceAdmission,
  type PersistenceFinal,
  type PersistenceOwner,
  type PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";

export type PersistenceContext = {
  permit: PersistencePermit;
  final?: boolean;
  onSeal?: (final: PersistenceFinal) => void;
};

export type { ResumedWorkspace };
export { hasInFlightSessions };

export type BootWorkspace = {
  windowTransfer: WindowTransferPayload | null;
  resumed: ResumedWorkspace | null;
};

let resumedPromise: Promise<ResumedWorkspace | null> | null = null;
let bootPromise: Promise<BootWorkspace> | null = null;
let quitting = false;
let quitPersistence: PersistenceFinal | null = null;
let bootQuitOwner: PersistenceOwner | null = null;
let bootLoadOwner: PersistenceOwner | null = null;
let quitDialogOpen = false;
let bootingResumed: ResumedWorkspace | null = null;
let liveWorkspace: {
  sessions: () => Session[];
  tabs: () => WorkspaceTab[];
  activeTabId: () => string;
  projectCwd: () => string;
  projectTerminals: () => ProjectTerminalDock[];
  projectReturnMemory: () => ProjectReturnMemory;
  keepTab?: (tab: WorkspaceTab) => boolean;
  flush: () => void;
  persistenceOwner?: PersistenceOwner;
} | null = null;

export function isAppQuitting(): boolean {
  return quitting;
}

export function setQuitWorkspace(
  sessions: () => Session[],
  tabs: () => WorkspaceTab[],
  activeTabId: () => string,
  projectCwd: () => string,
  projectTerminals: () => ProjectTerminalDock[],
  projectReturnMemory: () => ProjectReturnMemory,
  flush: () => void,
  keepTab?: (tab: WorkspaceTab) => boolean,
  persistenceOwner?: PersistenceOwner,
): () => void {
  liveWorkspace = {
    sessions,
    tabs,
    activeTabId,
    projectCwd,
    projectTerminals,
    projectReturnMemory,
    keepTab,
    flush,
    persistenceOwner,
  };
  bootLoadOwner?.retire();
  bootLoadOwner = null;
  bootingResumed = null;
  return () => {
    if (liveWorkspace?.sessions === sessions) liveWorkspace = null;
  };
}

export type QuitConfirmPayload = {
  id: number;
  inFlight: number;
};

export async function reportQuitPoll(id: number): Promise<void> {
  if (liveWorkspace) {
    liveWorkspace.flush();
    const refs = inFlightRefs(liveWorkspace.sessions(), liveWorkspace.tabs());
    await invoke("quit_poll_reply", { id, inFlight: refs.length });
    return;
  }
  const { resumed } = await loadBootWorkspace();
  const pending = resumed ?? bootingResumed;
  if (pending) {
    const busy = pending.sessions.some(wasTurnInterrupted);
    await invoke("quit_poll_reply", { id, inFlight: busy ? 1 : 0 });
    return;
  }
  await invoke("quit_poll_reply", { id, inFlight: 0 });
}

export async function askQuitConfirmation(
  payload: QuitConfirmPayload,
): Promise<void> {
  if (quitDialogOpen) return;
  quitDialogOpen = true;
  try {
    const ok = await ask(quitWhileBusyMessage(payload.inFlight), {
      title: "Voktty",
      kind: "warning",
      okLabel: "Quit",
    });
    await invoke("quit_decision", {
      id: payload.id,
      confirmed: Boolean(ok),
    });
  } catch {
    await invoke("quit_decision", {
      id: payload.id,
      confirmed: false,
    });
  } finally {
    quitDialogOpen = false;
  }
}

export async function commitQuit(id: number): Promise<void> {
  quitting = true;
  let persisted = false;
  try {
    if (liveWorkspace) {
      const workspace = liveWorkspace;
      workspace.flush();
      if (liveWorkspace !== workspace) return;
      const capture: HarnessQuitCapture = {
        sessions: workspace.sessions(),
        tabs: workspace.tabs(),
        activeTabId: workspace.activeTabId(),
        projectCwd: workspace.projectCwd(),
        projectReturnMemory: workspace.projectReturnMemory(),
        projectTerminals: workspace.projectTerminals(),
        keepTab: workspace.keepTab,
      };
      if (liveWorkspace !== workspace) return;
      const permit = workspace.persistenceOwner?.capture();
      if (workspace.persistenceOwner && !permit) return;
      const state: { final: PersistenceFinal | null } = { final: null };
      const persistence: PersistenceContext | undefined = permit
        ? {
            permit,
            final: true,
            onSeal: (final) => {
              state.final = final;
              quitPersistence = final;
            },
          }
        : undefined;
      await persistQuitState(
        capture.sessions,
        capture.tabs,
        capture.activeTabId,
        capture.projectCwd,
        capture.projectReturnMemory,
        "quit",
        capture.projectTerminals,
        capture.keepTab,
        persistence,
      );
      persisted = !persistence || state.final?.isCurrent() === true;
    } else {
      bootQuitOwner ??= windowPersistenceAdmission.createOwner();
      const owner = bootQuitOwner;
      const permit = owner.capture();
      if (!permit) return;
      const { resumed } = await loadBootWorkspace();
      if (bootQuitOwner !== owner || !permit.isCurrent() || liveWorkspace)
        return;
      const pending = resumed ?? bootingResumed;
      if (pending) {
        const final = await persistBootingResume(pending, permit);
        persisted = final?.isCurrent() === true;
      } else {
        persisted = true;
      }
    }
  } catch {
    persisted = false;
  } finally {
    await invoke("quit_ready", { id, persisted });
  }
}

export function abortQuit(): void {
  quitting = false;
  quitPersistence?.cancel();
  quitPersistence = null;
  bootQuitOwner?.retire();
  bootQuitOwner = null;
}

export async function handleQuitRequested(): Promise<void> {
  if (liveWorkspace) {
    const workspace = liveWorkspace;
    workspace.flush();
    if (liveWorkspace !== workspace) return;
    await confirmQuitAndExit(workspace);
    return;
  }
  bootQuitOwner ??= windowPersistenceAdmission.createOwner();
  const owner = bootQuitOwner;
  const permit = owner.capture();
  if (!permit) return;
  const { resumed } = await loadBootWorkspace();
  if (bootQuitOwner !== owner || !permit.isCurrent() || liveWorkspace) return;
  const pending = resumed ?? bootingResumed;
  if (pending) {
    quitting = true;
    try {
      const final = await persistBootingResume(pending, permit);
      if (final?.isCurrent()) await invoke("confirm_quit");
      else if (bootQuitOwner === owner) {
        quitting = false;
        owner.retire();
        bootQuitOwner = null;
      }
    } catch {
      if (bootQuitOwner === owner) {
        quitting = false;
        owner.retire();
        bootQuitOwner = null;
      }
    }
    return;
  }
  await invoke("confirm_quit");
}

export function loadResumedWorkspace(): Promise<ResumedWorkspace | null> {
  if (!resumedPromise) resumedPromise = loadResumedWorkspaceOnce();
  return resumedPromise;
}

/** Transfer and restore run once; callers share the same promise. */
export function loadBootWorkspace(): Promise<BootWorkspace> {
  if (!bootPromise) {
    bootPromise = (async () => {
      const windowTransfer = await loadWindowTransfer();
      const resumed = windowTransfer ? null : await loadResumedWorkspace();
      return { windowTransfer, resumed };
    })();
  }
  return bootPromise;
}

async function loadResumedWorkspaceOnce(): Promise<ResumedWorkspace | null> {
  if (liveWorkspace) return null;
  const owner = windowPersistenceAdmission.createOwner();
  bootLoadOwner = owner;
  try {
    const permit = owner.capture();
    if (!permit) return null;
    return await readResumedWorkspace(
      permit,
      () => bootLoadOwner === owner && !liveWorkspace && permit.isCurrent(),
    );
  } finally {
    owner.retire();
    if (bootLoadOwner === owner) bootLoadOwner = null;
  }
}

async function readResumedWorkspace(
  permit: PersistencePermit,
  isCurrent: () => boolean,
): Promise<ResumedWorkspace | null> {
  const [snapshotRaw, refs] = await Promise.all([
    loadWorkspaceSnapshot().catch(() => null),
    listInFlightSessions().catch(() => []),
  ]);
  if (!isCurrent()) return null;
  const interrupted = new Set(refs.map((ref) => ref.sessionId));
  const snapshot = parseWorkspaceSnapshot(snapshotRaw);

  const ids = new Set<string>();
  const sourceCwds = new Map<string, string>();
  if (snapshot) {
    for (const stub of snapshot.sessions) {
      ids.add(stub.id);
      sourceCwds.set(stub.id, stub.cwd);
    }
    for (const tab of snapshot.tabs) {
      for (const id of leafIds(tab.layout)) ids.add(id);
    }
  }
  for (const ref of refs) {
    ids.add(ref.sessionId);
    if (!sourceCwds.has(ref.sessionId)) sourceCwds.set(ref.sessionId, ref.cwd);
  }

  const loaded = new Map<string, Session>();
  await Promise.all(
    [...ids].map(async (id) => {
      if (!isCurrent()) return;
      const cwd = sourceCwds.get(id);
      const record = await (cwd === undefined
        ? getSession(id, permit)
        : getSession(id, permit, cwd)).catch(() => null);
      if (isCurrent() && record) loaded.set(id, record);
    }),
  );
  if (!isCurrent()) return null;

  let workspace = snapshot
    ? hydrateWorkspaceSnapshot(snapshot, loaded, interrupted)
    : null;
  if (!workspace && refs.length > 0) {
    const sessions: Session[] = [];
    for (const ref of refs) {
      const record = loaded.get(ref.sessionId);
      if (!record) continue;
      sessions.push(markTurnInterrupted(record));
    }
    workspace = workspaceFromResumed(sessions);
  }

  if (workspace) {
    workspace = {
      ...workspace,
      sessions: await Promise.all(
        workspace.sessions.map((session) => restoreSessionCheckout(session)),
      ),
    };
  }

  if (!isCurrent()) return null;
  if (workspace) {
    const sessions = workspace.sessions;
    await permit.run(() => upsertSessions(sessions)).catch(() => undefined);
  }
  if (!isCurrent()) return null;
  bootingResumed = workspace;
  return workspace;
}

export function bindResumedSessions(sessions: Session[]): void {
  for (const session of sessions) {
    if (!session.providerSessionId || !isLiveHarness(session.harness)) continue;
    bindHarnessSession(
      session.harness,
      session.id,
      session.providerSessionId,
      sessionWorkCwd(session),
      session.providerAccountId,
      session.blocks,
    );
  }
}

export async function hideCurrentWindow(): Promise<void> {
  await invoke("hide_window");
}

export async function closeCurrentWindow(): Promise<void> {
  await invoke("destroy_window");
}

export async function confirmReload(
  hasUnsavedFiles: boolean,
): Promise<boolean> {
  if (!hasUnsavedFiles) return true;
  return ask("Reload Voktty and discard unsaved changes?", {
    title: "Voktty",
    kind: "warning",
    okLabel: "Reload",
  });
}

export async function persistLiveTranscripts(
  sessions: Session[],
): Promise<void> {
  await upsertSessions(sessions).catch(() => []);
}

export async function persistQuitState(
  sessions: Session[],
  tabs: WorkspaceTab[],
  activeTabId: string,
  projectCwd: string,
  memory: ProjectReturnMemory,
  mode: "quit" | "unload" = "quit",
  projectTerminals: ProjectTerminalDock[] = [],
  keepTab?: (tab: WorkspaceTab) => boolean,
  persistence?: PersistenceContext,
): Promise<void> {
  let writer = persistence?.permit;
  if (writer && !writer.isCurrent()) return;
  let failed = false;
  let failure: unknown;
  const write = async (effect: () => Promise<unknown>) => {
    try {
      const admitted = writer ? await writer.run(effect) : await effect();
      if (persistence?.final && admitted === false && writer?.isCurrent())
        throw new Error("Final persistence write was not admitted.");
    } catch (error) {
      if (persistence?.final && !failed) {
        failed = true;
        failure = error;
      }
    }
  };
  const refs = inFlightRefs(sessions, tabs);
  const interrupted = new Set(refs.map((ref) => ref.sessionId));
  let snapshot: ReturnType<typeof collectWorkspaceSnapshot>;
  let final: PersistenceFinal | null = null;
  try {
    snapshot = collectWorkspaceSnapshot(
      tabs,
      sessions,
      activeTabId,
      projectCwd,
      memory,
      projectTerminals,
      keepTab,
    );
  } finally {
    if (persistence?.final) {
      final = persistence.permit.seal();
      if (final) {
        writer = final;
        persistence.onSeal?.(final);
      }
    }
    if (final?.pending) await final.pending;
    const transcripts = sessions.map((session) =>
      interrupted.has(session.id) ? markTurnInterrupted(session) : session,
    );
    await write(() =>
      persistence?.final
        ? upsertSessions(transcripts, { requireRemotePersistence: true })
        : upsertSessions(transcripts),
    );
  }
  if (writer && !writer.isCurrent()) return;
  await write(() => saveWorkspaceSnapshot(snapshot));
  // Vite/webview reload must not wipe a restored snapshot: those chats are idle
  // in this process until Continue runs.
  if (mode === "quit" || refs.length > 0) {
    await write(() => replaceInFlightSessions(refs));
  }
  if (failed) throw failure;
}

async function persistBootingResume(
  workspace: ResumedWorkspace,
  permit: PersistencePermit,
): Promise<PersistenceFinal | null> {
  if (!permit.isCurrent()) return null;
  let writer: PersistencePermit = permit;
  let final: PersistenceFinal | null = null;
  let transcriptFailure: { error: unknown } | undefined;
  let snapshot: ReturnType<typeof collectWorkspaceSnapshot>;
  let refs: ReturnType<typeof inFlightRefs>;
  try {
    snapshot = collectWorkspaceSnapshot(
      workspace.tabs,
      workspace.sessions,
      workspace.activeTabId,
      workspace.projectCwd,
      workspace.projectReturnMemory ?? new Map(),
      workspace.projectTerminals ?? [],
    );
    refs = workspace.sessions
      .filter(wasTurnInterrupted)
      .map((session) => ({ sessionId: session.id, cwd: session.cwd }));
  } finally {
    final = permit.seal();
    if (final) {
      writer = final;
      quitPersistence = final;
    }
    if (final?.pending) await final.pending;
    const admitted = await writer
      .run(() =>
        upsertSessions(workspace.sessions, { requireRemotePersistence: true }),
      )
      .catch((error: unknown) => {
        transcriptFailure = { error };
        return false;
      });
    if (!admitted && writer.isCurrent())
      transcriptFailure ??= {
        error: new Error("Final transcript write was not admitted."),
      };
  }
  if (transcriptFailure) throw transcriptFailure.error;
  if (!final?.isCurrent()) return null;
  if (
    !(await final.run(() => saveWorkspaceSnapshot(snapshot))) &&
    final.isCurrent()
  )
    throw new Error("Final snapshot write was not admitted.");
  if (
    !(await final.run(() => replaceInFlightSessions(refs))) &&
    final.isCurrent()
  )
    throw new Error("Final recovery write was not admitted.");
  return final.isCurrent() ? final : null;
}

export type HarnessQuitCapture = {
  sessions: Session[];
  tabs: WorkspaceTab[];
  activeTabId: string;
  projectCwd: string;
  projectReturnMemory: ProjectReturnMemory;
  projectTerminals: ProjectTerminalDock[];
  keepTab?: (tab: WorkspaceTab) => boolean;
  persistencePermit?: PersistencePermit;
};

export async function confirmAndCloseWindow(
  sessions: Session[],
  tabs: WorkspaceTab[],
  activeTabId: string,
  projectCwd: string,
  memory: ProjectReturnMemory,
  projectTerminals: ProjectTerminalDock[] = [],
  flush?: () => void,
  keepTab?: (tab: WorkspaceTab) => boolean,
  recapture?: () => HarnessQuitCapture | null,
): Promise<void> {
  const refs = inFlightRefs(sessions, tabs);
  if (refs.length > 0) {
    const ok = await ask(quitWhileBusyMessage(refs.length), {
      title: "Voktty",
      kind: "warning",
      okLabel: "Close",
    });
    if (!ok) return;
  }
  let capture: HarnessQuitCapture | null;
  if (recapture) {
    capture = recapture();
  } else {
    flush?.();
    capture = {
      sessions,
      tabs,
      activeTabId,
      projectCwd,
      projectReturnMemory: memory,
      projectTerminals,
      keepTab,
    };
  }
  if (!capture) return;
  const state: { final: PersistenceFinal | null } = { final: null };
  const persistence: PersistenceContext | undefined = capture.persistencePermit
    ? {
        permit: capture.persistencePermit,
        final: true,
        onSeal: (sealed) => {
          state.final = sealed;
        },
      }
    : undefined;
  try {
    await persistQuitState(
      capture.sessions,
      capture.tabs,
      capture.activeTabId,
      capture.projectCwd,
      capture.projectReturnMemory,
      "unload",
      capture.projectTerminals,
      capture.keepTab,
      persistence,
    );
    const current = state.final
      ? state.final.isCurrent()
      : (capture.persistencePermit?.isCurrent() ?? true);
    if (current) {
      await closeCurrentWindow();
    }
  } catch (error) {
    state.final?.cancel();
    throw error;
  }
}

async function confirmQuitAndExit(
  workspace: NonNullable<typeof liveWorkspace>,
): Promise<void> {
  if (quitDialogOpen) return;
  quitDialogOpen = true;
  try {
    const refs = inFlightRefs(workspace.sessions(), workspace.tabs());
    if (refs.length > 0) {
      const ok = await ask(quitWhileBusyMessage(refs.length), {
        title: "Voktty",
        kind: "warning",
        okLabel: "Quit",
      });
      if (!ok) return;
    }
    if (liveWorkspace !== workspace) return;
    workspace.flush();
    if (liveWorkspace !== workspace) return;
    const capture: HarnessQuitCapture = {
      sessions: workspace.sessions(),
      tabs: workspace.tabs(),
      activeTabId: workspace.activeTabId(),
      projectCwd: workspace.projectCwd(),
      projectReturnMemory: workspace.projectReturnMemory(),
      projectTerminals: workspace.projectTerminals(),
      keepTab: workspace.keepTab,
    };
    if (liveWorkspace !== workspace) return;
    const permit = workspace.persistenceOwner?.capture();
    if (workspace.persistenceOwner && !permit) return;
    const state: { final: PersistenceFinal | null } = { final: null };
    const persistence: PersistenceContext | undefined = permit
      ? {
          permit,
          final: true,
          onSeal: (final) => {
            state.final = final;
            quitPersistence = final;
          },
        }
      : undefined;
    const cancel = () => {
      if (!persistence || quitPersistence === state.final) {
        quitting = false;
        state.final?.cancel();
        quitPersistence = null;
      }
    };
    quitting = true;
    try {
      await persistQuitState(
        capture.sessions,
        capture.tabs,
        capture.activeTabId,
        capture.projectCwd,
        capture.projectReturnMemory,
        "quit",
        capture.projectTerminals,
        capture.keepTab,
        persistence,
      );
      if (persistence && !state.final?.isCurrent()) {
        cancel();
        return;
      }
      await invoke("confirm_quit");
    } catch {
      cancel();
    }
  } finally {
    quitDialogOpen = false;
  }
}

export async function reapWindowRuntime(
  sessions: Session[],
  tabs: WorkspaceTab[],
  projectTerminals: ProjectTerminalDock[] = [],
): Promise<void> {
  await Promise.all(
    sessions.map((session) =>
      Promise.all(
        sessionChildHarnesses(session).map((harness) =>
          forgetHarnessSession(harness, session.id),
        ),
      ),
    ),
  );
  await Promise.all(
    [...terminalFileIds(tabs), ...projectTerminalFileIds(projectTerminals)].map(
      (id) => killPty(id),
    ),
  );
  // Catalog probes, title generators, and usage scrapers are not session
  // children. Drop them so an unused Pi/Codex probe cannot outlive the window.
  await killAllChildren().catch(() => undefined);
}

function terminalFileIds(tabs: WorkspaceTab[]): string[] {
  const ids: string[] = [];
  for (const tab of tabs) {
    for (const pane of [...tab.editorPanes, ...(tab.terminalPanes ?? [])]) {
      for (const file of pane.files) {
        if (file.terminal && !file.canonicalTerminal) ids.push(file.id);
      }
    }
  }
  return ids;
}
