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

export type { ResumedWorkspace };
export { hasInFlightSessions };

export type BootWorkspace = {
  windowTransfer: WindowTransferPayload | null;
  resumed: ResumedWorkspace | null;
};

let resumedPromise: Promise<ResumedWorkspace | null> | null = null;
let bootPromise: Promise<BootWorkspace> | null = null;
let quitting = false;
let quitDialogOpen = false;
let bootingResumed: ResumedWorkspace | null = null;
let liveWorkspace: {
  sessions: () => Session[];
  tabs: () => WorkspaceTab[];
  activeTabId: () => string;
  projectCwd: () => string;
  projectTerminals: () => ProjectTerminalDock[];
  projectReturnMemory: () => ProjectReturnMemory;
  flush: () => void;
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
): () => void {
  liveWorkspace = {
    sessions,
    tabs,
    activeTabId,
    projectCwd,
    projectTerminals,
    projectReturnMemory,
    flush,
  };
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
    const refs = inFlightRefs(
      liveWorkspace.sessions(),
      liveWorkspace.tabs(),
    );
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
      liveWorkspace.flush();
      await persistQuitState(
        liveWorkspace.sessions(),
        liveWorkspace.tabs(),
        liveWorkspace.activeTabId(),
        liveWorkspace.projectCwd(),
        liveWorkspace.projectReturnMemory(),
        "quit",
        liveWorkspace.projectTerminals(),
      );
      persisted = true;
    } else {
      const { resumed } = await loadBootWorkspace();
      const pending = resumed ?? bootingResumed;
      if (pending) {
        await persistBootingResume(pending);
      }
      persisted = true;
    }
  } catch {
    persisted = false;
  } finally {
    await invoke("quit_ready", { id, persisted });
  }
}

export function abortQuit(): void {
  quitting = false;
}

export async function handleQuitRequested(): Promise<void> {
  if (liveWorkspace) {
    liveWorkspace.flush();
    await confirmQuitAndExit(
      liveWorkspace.sessions(),
      liveWorkspace.tabs(),
      liveWorkspace.activeTabId(),
      liveWorkspace.projectCwd(),
      liveWorkspace.projectReturnMemory(),
      liveWorkspace.projectTerminals(),
    );
    return;
  }
  const { resumed } = await loadBootWorkspace();
  const pending = resumed ?? bootingResumed;
  if (pending) {
    quitting = true;
    try {
      await persistBootingResume(pending);
      await invoke("confirm_quit");
    } catch {
      quitting = false;
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
  const [snapshotRaw, refs] = await Promise.all([
    loadWorkspaceSnapshot().catch(() => null),
    listInFlightSessions().catch(() => []),
  ]);
  const interrupted = new Set(refs.map((ref) => ref.sessionId));
  const snapshot = parseWorkspaceSnapshot(snapshotRaw);

  const ids = new Set<string>();
  if (snapshot) {
    for (const stub of snapshot.sessions) ids.add(stub.id);
    for (const tab of snapshot.tabs) {
      for (const id of leafIds(tab.layout)) ids.add(id);
    }
  }
  for (const ref of refs) ids.add(ref.sessionId);

  const loaded = new Map<string, Session>();
  await Promise.all(
    [...ids].map(async (id) => {
      const record = await getSession(id).catch(() => null);
      if (record) loaded.set(id, record);
    }),
  );

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

  bootingResumed = workspace;
  if (workspace) {
    await upsertSessions(workspace.sessions).catch(() => []);
  }
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
): Promise<void> {
  const refs = inFlightRefs(sessions, tabs);
  const interrupted = new Set(refs.map((ref) => ref.sessionId));
  await upsertSessions(
    sessions.map((session) =>
      interrupted.has(session.id) ? markTurnInterrupted(session) : session,
    ),
  ).catch(() => []);
  await saveWorkspaceSnapshot(
    collectWorkspaceSnapshot(
      tabs,
      sessions,
      activeTabId,
      projectCwd,
      memory,
      projectTerminals,
    ),
  ).catch(() => undefined);
  // Vite/webview reload must not wipe a restored snapshot: those chats are idle
  // in this process until Continue runs.
  if (mode === "quit" || refs.length > 0) {
    await replaceInFlightSessions(refs).catch(() => undefined);
  }
}

async function persistBootingResume(workspace: ResumedWorkspace): Promise<void> {
  await upsertSessions(workspace.sessions).catch(() => []);
  await saveWorkspaceSnapshot(
    collectWorkspaceSnapshot(
      workspace.tabs,
      workspace.sessions,
      workspace.activeTabId,
      workspace.projectCwd,
      workspace.projectReturnMemory ?? new Map(),
      workspace.projectTerminals ?? [],
    ),
  ).catch(() => undefined);
  await replaceInFlightSessions(
    workspace.sessions
      .filter(wasTurnInterrupted)
      .map((session) => ({
        sessionId: session.id,
        cwd: session.cwd,
      })),
  ).catch(() => undefined);
}

export async function confirmAndCloseWindow(
  sessions: Session[],
  tabs: WorkspaceTab[],
  activeTabId: string,
  projectCwd: string,
  memory: ProjectReturnMemory,
  projectTerminals: ProjectTerminalDock[] = [],
  flush?: () => void,
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
  flush?.();
  try {
    await persistQuitState(
      sessions,
      tabs,
      activeTabId,
      projectCwd,
      memory,
      "unload",
      projectTerminals,
    );
  } finally {
    await closeCurrentWindow();
  }
}

async function confirmQuitAndExit(
  sessions: Session[],
  tabs: WorkspaceTab[],
  activeTabId: string,
  projectCwd: string,
  memory: ProjectReturnMemory,
  projectTerminals: ProjectTerminalDock[] = [],
): Promise<void> {
  if (quitDialogOpen) return;
  quitDialogOpen = true;
  try {
    const refs = inFlightRefs(sessions, tabs);
    if (refs.length > 0) {
      const ok = await ask(quitWhileBusyMessage(refs.length), {
        title: "Voktty",
        kind: "warning",
        okLabel: "Quit",
      });
      if (!ok) return;
    }
    quitting = true;
    try {
      await persistQuitState(
        sessions,
        tabs,
        activeTabId,
        projectCwd,
        memory,
        "quit",
        projectTerminals,
      );
      await invoke("confirm_quit");
    } catch {
      quitting = false;
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
        if (file.terminal) ids.push(file.id);
      }
    }
  }
  return ids;
}
