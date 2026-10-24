import {
  confirmAndCloseWindow,
  hideCurrentWindow,
  isAppQuitting,
  persistLiveTranscripts,
  persistQuitState,
  reapWindowRuntime,
  setQuitWorkspace,
  type HarnessQuitCapture,
} from "@/modules/harness/lib/appLifecycle";
import {
  ownHarnessUnloadSubscription,
  type HarnessUnloadDependencies,
} from "@/modules/harness/lib/harnessUnloadSubscription";
import { ownHarnessWindowCloseSubscription } from "@/modules/harness/lib/harnessWindowCloseSubscription";
import {
  inFlightRefs,
  inFlightSnapshotKey,
  shouldWriteInFlightSnapshot,
} from "@/modules/harness/lib/inFlight";
import type {
  PersistenceFinal,
  PersistenceOwner,
  PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import {
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
} from "@/modules/harness/lib/sessionStore";
import {
  collectWorkspaceSnapshot,
  workspaceSnapshotKey,
} from "@/modules/harness/lib/workspaceSnapshot";

export type HarnessWindowPersistenceInputs = {
  owner: PersistenceOwner;
  read: () => HarnessQuitCapture;
  flush: () => void;
  skipSnapshot: () => boolean;
  closeToTray: () => boolean;
  onError?: (error: unknown) => void;
  target: HarnessUnloadDependencies["target"];
  registerClose: Parameters<typeof ownHarnessWindowCloseSubscription>[0];
  schedule: (callback: () => void, delay: number) => () => void;
};

export function ownHarnessWindowPersistence(
  inputs: HarnessWindowPersistenceInputs,
) {
  let active = true;
  let closeActive = true;
  let inFlightKey: string | null = null;
  let sawInFlight = false;
  let snapshotKey: string | null = null;
  let pendingSnapshotKey: string | null = null;
  let snapshotTimer: object | null = null;
  let cancelSnapshot: (() => void) | null = null;
  let capture = inputs.read();
  let ownedFinal: PersistenceFinal | null = null;
  const owner: PersistenceOwner = {
    ...inputs.owner,
    capture() {
      if (!active) return null;
      const permit = inputs.owner.capture();
      if (!permit) return null;
      return {
        isCurrent: () => active && permit.isCurrent(),
        run: (write) => (active ? permit.run(write) : Promise.resolve(false)),
        seal() {
          if (!active) return null;
          const final = permit.seal();
          if (final) ownedFinal = final;
          return final;
        },
      };
    },
  };

  const cancelPendingSnapshot = () => {
    cancelSnapshot?.();
    cancelSnapshot = null;
    pendingSnapshotKey = null;
    snapshotTimer = null;
  };
  const flush = () => {
    if (!active) return;
    inputs.flush();
    if (active) capture = inputs.read();
  };
  const releaseQuit = setQuitWorkspace(
    () => capture.sessions,
    () => capture.tabs,
    () => capture.activeTabId,
    () => capture.projectCwd,
    () => capture.projectTerminals,
    () => capture.projectReturnMemory,
    flush,
    (tab) => capture.keepTab?.(tab) ?? true,
    owner,
  );
  const closeSubscription = ownHarnessWindowCloseSubscription(
    inputs.registerClose,
    () => {
      flush();
      if (!active || !closeActive) return;
      if (inputs.closeToTray()) {
        const permit = owner.capture();
        if (permit) {
          const sessions = capture.sessions;
          void permit.run(() => persistLiveTranscripts(sessions));
        }
        void hideCurrentWindow();
        return;
      }
      void confirmAndCloseWindow(
        capture.sessions,
        capture.tabs,
        capture.activeTabId,
        capture.projectCwd,
        capture.projectReturnMemory,
        capture.projectTerminals,
        undefined,
        capture.keepTab,
        () => {
          if (!active || !closeActive) return null;
          flush();
          if (!active || !closeActive) return null;
          const persistencePermit = owner.capture();
          return persistencePermit ? { ...capture, persistencePermit } : null;
        },
      ).catch((error: unknown) => {
        if (active && closeActive) inputs.onError?.(error);
      });
    },
  );
  void closeSubscription.ready.catch(() => {
    closeActive = false;
  });

  let unloadPermit: PersistencePermit | null = null;
  let unloadDenied = false;
  const unloadSubscription = ownHarnessUnloadSubscription({
    target: inputs.target,
    isAppQuitting,
    flush,
    getSessions: () => capture.sessions,
    getTabs: () => capture.tabs,
    getActiveTabId: () => capture.activeTabId,
    getProjectCwd: () => capture.projectCwd,
    getProjectReturnMemory: () => capture.projectReturnMemory,
    getProjectTerminals: () => capture.projectTerminals,
    persist: async (unload) => {
      const permit = owner.capture();
      unloadPermit = permit;
      if (!permit) return;
      const writer: PersistencePermit = {
        ...permit,
        run: async (write) => {
          const admitted = await permit.run(write);
          if (!admitted) unloadDenied = true;
          return admitted;
        },
      };
      await persistQuitState(
        unload.sessions,
        unload.tabs,
        unload.activeTabId,
        unload.projectCwd,
        unload.projectReturnMemory,
        "unload",
        unload.projectTerminals,
        undefined,
        { permit: writer, final: false },
      );
    },
    reap: async (unload) => {
      if (unloadDenied || !unloadPermit?.isCurrent()) return;
      await reapWindowRuntime(
        unload.sessions,
        unload.tabs,
        unload.projectTerminals,
      );
    },
  });

  const publish = (
    workspace?: HarnessQuitCapture,
    skipSnapshot = inputs.skipSnapshot(),
  ) => {
    if (!active) return;
    const current = workspace ?? inputs.read();
    const refs = inFlightRefs(current.sessions, current.tabs);
    if (refs.length > 0) sawInFlight = true;
    const permit = owner.capture();
    if (!permit) {
      cancelPendingSnapshot();
      return;
    }
    const nextInFlightKey = inFlightSnapshotKey(refs);
    if (
      shouldWriteInFlightSnapshot(
        nextInFlightKey,
        refs,
        inFlightKey,
        sawInFlight,
      )
    ) {
      void permit
        .run(() => {
          inFlightKey = nextInFlightKey;
          return replaceInFlightSessions(refs);
        })
        .catch(() => undefined);
    }
    if (skipSnapshot) {
      cancelPendingSnapshot();
      return;
    }
    const snapshot = collectWorkspaceSnapshot(
      current.tabs,
      current.sessions,
      current.activeTabId,
      current.projectCwd,
      current.projectReturnMemory,
      current.projectTerminals,
    );
    const nextSnapshotKey = workspaceSnapshotKey(snapshot);
    if (snapshotKey === nextSnapshotKey) {
      cancelPendingSnapshot();
      return;
    }
    if (pendingSnapshotKey === nextSnapshotKey) return;
    cancelPendingSnapshot();
    pendingSnapshotKey = nextSnapshotKey;
    const timer = {};
    snapshotTimer = timer;
    cancelSnapshot = inputs.schedule(() => {
      if (!active || snapshotTimer !== timer) return;
      cancelSnapshot = null;
      pendingSnapshotKey = null;
      snapshotTimer = null;
      void permit
        .run(() => {
          snapshotKey = nextSnapshotKey;
          return saveWorkspaceSnapshot(snapshot);
        })
        .catch(() => undefined);
    }, 250);
  };

  return {
    ready: closeSubscription.ready,
    publish,
    resume() {
      if (!active) return;
      inFlightKey = null;
      snapshotKey = null;
      cancelPendingSnapshot();
      publish();
    },
    release() {
      if (!active) return;
      active = false;
      closeActive = false;
      ownedFinal?.cancel();
      cancelPendingSnapshot();
      releaseQuit();
      closeSubscription.release();
      unloadSubscription.release();
    },
  };
}
