import type { WorkspaceTab } from "@/modules/harness/lib/layout";
import type { ProjectReturnMemory } from "@/modules/harness/lib/projectReturn";
import type { ProjectTerminalDock } from "@/modules/harness/lib/projectTerminal";
import type { Session } from "@/modules/harness/lib/session";

export type HarnessUnloadCapture = Readonly<{
  sessions: Session[];
  tabs: WorkspaceTab[];
  activeTabId: string;
  projectCwd: string;
  projectReturnMemory: ProjectReturnMemory;
  projectTerminals: ProjectTerminalDock[];
}>;

type UnloadEventName = "pagehide" | "beforeunload";
export type HarnessUnloadDependencies = {
  target: {
    addEventListener: (name: UnloadEventName, listener: EventListener) => void;
    removeEventListener: (
      name: UnloadEventName,
      listener: EventListener,
    ) => void;
  };
  isAppQuitting: () => boolean;
  flush: () => void;
  getSessions: () => Session[];
  getTabs: () => WorkspaceTab[];
  getActiveTabId: () => string;
  getProjectCwd: () => string;
  getProjectReturnMemory: () => ProjectReturnMemory;
  getProjectTerminals: () => ProjectTerminalDock[];
  persist: (capture: HarnessUnloadCapture) => Promise<void>;
  reap: (capture: HarnessUnloadCapture) => Promise<void>;
};

export function ownHarnessUnloadSubscription(deps: HarnessUnloadDependencies) {
  let active = true;
  let started = false;
  const persistAndReap = async (): Promise<void> => {
    deps.flush();
    if (!active) return;
    const capture: HarnessUnloadCapture = Object.freeze({
      sessions: deps.getSessions(),
      tabs: deps.getTabs(),
      activeTabId: deps.getActiveTabId(),
      projectCwd: deps.getProjectCwd(),
      projectReturnMemory: deps.getProjectReturnMemory(),
      projectTerminals: deps.getProjectTerminals(),
    });
    if (!active) return;
    try {
      await deps.persist(capture);
    } finally {
      // A retired effect must not run global native cleanup against its successor.
      if (active) await deps.reap(capture);
    }
  };
  const onUnload: EventListener = () => {
    if (!active || started || deps.isAppQuitting()) return;
    started = true;
    void persistAndReap().catch(() => undefined);
  };
  deps.target.addEventListener("pagehide", onUnload);
  deps.target.addEventListener("beforeunload", onUnload);
  return {
    release: () => {
      if (!active) return;
      active = false;
      deps.target.removeEventListener("pagehide", onUnload);
      deps.target.removeEventListener("beforeunload", onUnload);
    },
  };
}
