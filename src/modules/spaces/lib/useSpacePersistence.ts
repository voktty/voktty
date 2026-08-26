import type { Tab } from "@/modules/tabs";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { type SessionSnapshot, snapshotFromRuntime } from "./sessionSnapshot";
import {
  promoteLastCleanSession,
  reserveSessionGeneration,
  writeWorkingCheckpoint,
} from "./store";
import { useSpaces } from "./useSpaces";

const DEBOUNCE_MS = 400;

type RuntimeState = {
  tabs: Tab[];
  activeId: number;
  activeSpaceId: string;
};

type Params = RuntimeState & {
  enabled: boolean;
  ownerInstanceId: string;
};

async function withFreshGeneration<T>(
  write: (generation: number) => Promise<T | null>,
): Promise<T> {
  let result = await write(reserveSessionGeneration());
  if (result === null) result = await write(reserveSessionGeneration());
  if (result === null) throw new Error("session generation is stale");
  return result;
}

export function useSpacePersistence({
  tabs,
  activeId,
  activeSpaceId,
  enabled,
  ownerInstanceId,
}: Params) {
  const workspaceContexts = useSpaces((state) => state.spaces);
  const viewSpaces = useSpaces((state) => state.viewSpaces);
  const stripEntries = useSpaces((state) => state.stripEntries);
  const activeStripItem = useSpaces((state) => state.activeStripItem);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWorkingJson = useRef("");
  const latest = useRef<RuntimeState>({ tabs, activeId, activeSpaceId });
  latest.current = { tabs, activeId, activeSpaceId };

  const currentSnapshot = useCallback((): SessionSnapshot => {
    const runtime = latest.current;
    const spaces = useSpaces.getState();
    return snapshotFromRuntime({
      workspaceContexts: spaces.spaces,
      activeWorkspaceContextId: runtime.activeSpaceId,
      tabs: runtime.tabs,
      activeTabId: runtime.activeId,
      viewSpaces: spaces.viewSpaces,
      stripEntries: spaces.stripEntries,
      activeStripItem: spaces.activeStripItem,
    });
  }, []);

  const persistenceRevision = useMemo(
    () =>
      JSON.stringify(
        snapshotFromRuntime({
          workspaceContexts,
          activeWorkspaceContextId: activeSpaceId,
          tabs,
          activeTabId: activeId,
          viewSpaces,
          stripEntries,
          activeStripItem,
        }),
      ),
    [
      activeId,
      activeSpaceId,
      activeStripItem,
      stripEntries,
      tabs,
      viewSpaces,
      workspaceContexts,
    ],
  );

  const flushWorkingCheckpoint = useCallback(async () => {
    if (!enabled) return;
    const snapshot = currentSnapshot();
    const json = JSON.stringify(snapshot);
    if (json === lastWorkingJson.current) return;
    await withFreshGeneration((generation) =>
      writeWorkingCheckpoint(snapshot, { ownerInstanceId, generation }),
    );
    lastWorkingJson.current = json;
  }, [currentSnapshot, enabled, ownerInstanceId]);

  const flushAndPromoteSession = useCallback(async () => {
    if (!enabled) throw new Error("session persistence is not ready");
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const snapshot = currentSnapshot();
    await withFreshGeneration((generation) =>
      promoteLastCleanSession(snapshot, {
        ownerInstanceId,
        generation,
        closedAt: Date.now(),
      }),
    );
    lastWorkingJson.current = JSON.stringify(snapshot);
  }, [currentSnapshot, enabled, ownerInstanceId]);

  useEffect(() => {
    if (!enabled) return;
    if (persistenceRevision === lastWorkingJson.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flushWorkingCheckpoint().catch((error) => {
        console.error("[voktty] session checkpoint failed:", error);
      });
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, flushWorkingCheckpoint, persistenceRevision]);

  useEffect(() => {
    if (!enabled) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        void flushWorkingCheckpoint().catch((error) => {
          console.error("[voktty] session checkpoint failed:", error);
        });
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [enabled, flushWorkingCheckpoint]);

  return { flushWorkingCheckpoint, flushAndPromoteSession };
}
