import { stopStreaming } from "./harness/apply";
import {
  buildDeterministicHandoff,
  completeHandoff,
  isPreparingHandoff,
} from "./handoff";
import { isFilesystemTab, type WorkspaceTab } from "./layout";
import type { Session } from "./session";
import {
  removeSessionFromWorkspace,
  type SessionWorkspaceRemoval,
} from "./sessionWorkspaceLifecycle";
import type { WorkspaceTabCloseScope } from "./workspaceTabGroups";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";

type Workspace = {
  tabs: WorkspaceTab[];
  sessions: Session[];
  activeTabId: string;
  dirtyFiles: ReadonlySet<string>;
};

/** Run the same lifecycle for archive and delete, reading state after each wait. */
export async function runSessionRemoval(options: {
  sessionId: string;
  scope: WorkspaceTabCloseScope;
  persistencePermit?: PersistencePermit;
  readWorkspace: () => Workspace;
  createReplacement: (seed: Session | undefined) => Session;
  confirmClose: (tabs: WorkspaceTab[]) => Promise<boolean>;
  stop: () => Promise<void>;
  updateSession: (session: Session) => void;
  persist: (
    session: Session | undefined,
    isCurrent: () => boolean,
  ) => Promise<void>;
  commit: (removal: SessionWorkspaceRemoval) => void;
}): Promise<boolean> {
  const permit = options.persistencePermit;
  const isCurrent = () => permit?.isCurrent() ?? true;
  if (!isCurrent()) return false;
  const initial = options.readWorkspace();
  if (!isCurrent()) return false;
  const plan = removeSessionFromWorkspace({ ...initial, ...options });
  if (
    !isCurrent() ||
    !(await options.confirmClose(plan.closedTabs)) ||
    !isCurrent()
  )
    return false;

  await options.stop();
  if (!isCurrent()) return false;
  const latest = options
    .readWorkspace()
    .sessions.find((session) => session.id === options.sessionId);
  if (!isCurrent()) return false;
  let stopped = latest;
  if (latest) {
    stopped = latest.busy ? stopStreaming(latest) : latest;
    if (isPreparingHandoff(stopped)) {
      stopped = completeHandoff(stopped, buildDeterministicHandoff(stopped));
    }
    if (stopped.queuedMessages?.length) {
      stopped = { ...stopped, queueStatus: "paused" };
    }
    // Cancellation invalidates normal turn completion. Keep a usable stopped
    // session even when the following storage operation fails.
    options.updateSession(stopped);
  }
  if (!isCurrent()) return false;
  const persist = () => options.persist(stopped, isCurrent);
  if (permit) {
    if (!(await permit.run(persist))) return false;
  } else {
    await persist();
  }
  if (!isCurrent()) return false;

  const current = options.readWorkspace();
  if (!isCurrent()) return false;
  const confirmed = new Map(plan.closedTabs.map((tab) => [tab.id, tab]));
  const removal = removeSessionFromWorkspace({
    ...current,
    ...options,
    canCloseTab: (tab) => {
      const before = confirmed.get(tab.id);
      // File/terminal panes opened or rearranged during a dialog or save were
      // never confirmed. Remove the conversation but keep those surfaces open.
      if (
        !before ||
        before.filePanes !== tab.filePanes
      )
        return false;
      return !tab.filePanes.some((pane) =>
        pane.files.some(
          (file) =>
            isFilesystemTab(file) &&
            current.dirtyFiles.has(file.id) &&
            !initial.dirtyFiles.has(file.id),
        ),
      );
    },
  });
  // No await between the final read and commit: unrelated streaming updates,
  // tabs, and focus changes must survive this operation.
  if (!isCurrent()) return false;
  options.commit(removal);
  return true;
}

export async function runSessionRemovalBatch({
  sessionIds,
  persistencePermit,
  remove,
}: {
  sessionIds: readonly string[];
  persistencePermit: PersistencePermit;
  remove: (sessionId: string, permit: PersistencePermit) => Promise<boolean>;
}): Promise<boolean> {
  const capturedIds = [...sessionIds];
  for (const id of capturedIds) {
    if (!persistencePermit.isCurrent()) return false;
    if (!(await remove(id, persistencePermit))) return false;
  }
  return persistencePermit.isCurrent();
}
