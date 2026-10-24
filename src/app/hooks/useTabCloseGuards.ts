import {
  type CloseManyHazards,
  type CloseManyKind,
  type CloseManyPending,
  evaluateCloseHazards,
  hasCloseManyHazards,
  hasNewCloseManyHazards,
  requiresTerminalCloseConfirmation,
  planTerminalSubsetClose,
} from "@/app/hooks/tabCloseGuards";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type CloseTabsPlan,
  planCloseAllTabs,
  planCloseOtherTabs,
  planCloseTabsToRight,
  type Tab,
} from "@/modules/tabs";
import {
  leafHasForegroundProcess,
  leafHasKnownActivity,
  leafIds,
} from "@/modules/terminal";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { projectStripEntries } from "@/modules/spaces/lib/spaceProjection";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";

function confirmRunningTerminal(): boolean {
  return usePreferencesStore.getState().confirmCloseRunningTerminal;
}

type Params = {
  tabs: Tab[];
  activeId: number;
  disposeTab: (id: number) => void;
  disposeTabs: (anchorId: number, plan: CloseTabsPlan) => void;
};

/**
 * Guards tab closing: dirty editors and terminals with a live foreground
 * process route through a confirmation dialog instead of closing immediately.
 * Owns the pending-close states the dialogs render from.
 */
export function useTabCloseGuards({
  tabs,
  activeId,
  disposeTab,
  disposeTabs,
}: Params) {
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  useLayoutEffect(() => {
    tabsRef.current = tabs;
    activeIdRef.current = activeId;
  }, [tabs, activeId]);
  const [pendingCloseTab, setPendingCloseTab] = useState<number | null>(null);
  const [pendingTerminalCloseTab, setPendingTerminalCloseTab] = useState<
    number | null
  >(null);
  const [pendingDeleteTabs, setPendingDeleteTabs] = useState<number[] | null>(
    null,
  );
  const [pendingCloseMany, setPendingCloseMany] =
    useState<CloseManyPending | null>(null);
  const [closeManyConfirming, setCloseManyConfirming] = useState(false);
  const closeManyRequestRef = useRef(0);

  const captureCloseMany = useCallback((closeIds: number[]) => {
    const close = new Set(closeIds);
    const affected = tabsRef.current.filter((tab) => close.has(tab.id));
    return {
      dirtyIds: affected
        .filter((tab) => tab.kind === "editor" && tab.dirty)
        .map((tab) => tab.id),
      leafIds: affected
        .filter((tab) => tab.kind === "terminal")
        .flatMap((tab) => leafIds(tab.paneTree)),
    };
  }, []);

  const evaluateCloseMany = useCallback(
    (closeIds: number[]): Promise<CloseManyHazards> =>
      evaluateCloseHazards(
        () => captureCloseMany(closeIds),
        (leafId) =>
          requiresTerminalCloseConfirmation(
            leafHasKnownActivity(leafId),
            confirmRunningTerminal(),
            () => leafHasForegroundProcess(leafId),
          ),
        true,
      ),
    [captureCloseMany],
  );

  const planCloseMany = useCallback(
    (kind: CloseManyKind, anchorId: number) => {
      if (kind === "right") {
        const { viewSpaces, stripEntries } = useSpaces.getState();
        const ordered = projectStripEntries({
          tabs: tabsRef.current, viewSpaces, stripEntries,
        }).flatMap((item) => item.kind === "space" ? item.tabs : [item.tab]);
        return planCloseTabsToRight(ordered, anchorId, activeIdRef.current);
      }
      if (kind === "other") {
        return planCloseOtherTabs(tabsRef.current, anchorId, activeIdRef.current);
      }
      return planCloseAllTabs(tabsRef.current, anchorId, activeIdRef.current);
    },
    [],
  );

  const withCurrentActive = useCallback(
    (plan: CloseTabsPlan): CloseTabsPlan => ({
      closeIds: plan.closeIds.filter((id) =>
        tabsRef.current.some((tab) => tab.id === id && !tab.locked),
      ),
      nextActiveId: activeIdRef.current,
    }),
    [],
  );

  const handleCloseMany = useCallback(
    async (
      kind: CloseManyKind,
      anchorId: number,
      terminalIds?: readonly number[],
    ) => {
      const plan = terminalIds
        ? planTerminalSubsetClose(tabsRef.current, terminalIds, activeIdRef.current)
        : planCloseMany(kind, anchorId);
      if (plan.closeIds.length === 0) return;
      const requestId = ++closeManyRequestRef.current;
      const hazards = await evaluateCloseMany(plan.closeIds);
      if (requestId !== closeManyRequestRef.current) return;
      if (hasCloseManyHazards(hazards)) {
        setPendingCloseMany({ kind, anchorId, plan, ...hazards });
        return;
      }
      disposeTabs(anchorId, withCurrentActive(plan));
    },
    [disposeTabs, evaluateCloseMany, planCloseMany, withCurrentActive],
  );

  const handleClose = useCallback(
    async (id: number, terminalIds?: readonly number[]) => {
      if (terminalIds) return handleCloseMany("other", id, terminalIds);
      const t = tabs.find((x) => x.id === id);
      if (t?.locked) {
        const { toast } = await import("sonner");
        const { t: translate } = await import("@/modules/i18n");
        toast.warning(
          translate("tabs.tabIsLockedWarning"),
          { id: `tab-locked-${id}` },
        );
        return;
      }
      if (t?.kind === "editor" && t.dirty) {
        setPendingCloseTab(id);
        return;
      }
      if (t?.kind === "terminal") {
        const leaves = leafIds(t.paneTree);
        const confirmForeground = confirmRunningTerminal();
        const checks = await Promise.all(
          leaves.map((leafId) =>
            requiresTerminalCloseConfirmation(
              leafHasKnownActivity(leafId),
              confirmForeground,
              () => leafHasForegroundProcess(leafId),
            ),
          ),
        );
        if (checks.some(Boolean)) {
          setPendingTerminalCloseTab(id);
          return;
        }
      }
      disposeTab(id);
    },
    [tabs, disposeTab, handleCloseMany],
  );

  const handleCloseTabsToRight = useCallback(
    (anchorId: number) => {
      void handleCloseMany("right", anchorId);
    },
    [handleCloseMany],
  );

  const handleCloseOtherTabs = useCallback(
    (anchorId: number) => {
      void handleCloseMany("other", anchorId);
    },
    [handleCloseMany],
  );

  const handleCloseAllTabs = useCallback(
    (anchorId?: number) => {
      const id = anchorId ?? activeIdRef.current;
      void handleCloseMany("all", id);
    },
    [handleCloseMany],
  );

  const confirmCloseMany = useCallback(async () => {
    if (pendingCloseMany === null) return;
    const requestId = ++closeManyRequestRef.current;
    setCloseManyConfirming(true);
    const hazards = await evaluateCloseMany(pendingCloseMany.plan.closeIds);
    if (requestId !== closeManyRequestRef.current) return;
    if (hasNewCloseManyHazards(pendingCloseMany, hazards)) {
      setPendingCloseMany({ ...pendingCloseMany, ...hazards });
      setCloseManyConfirming(false);
      return;
    }
    disposeTabs(
      pendingCloseMany.anchorId,
      withCurrentActive(pendingCloseMany.plan),
    );
    setPendingCloseMany(null);
    setCloseManyConfirming(false);
  }, [pendingCloseMany, disposeTabs, evaluateCloseMany, withCurrentActive]);

  const cancelCloseMany = useCallback(() => {
    closeManyRequestRef.current += 1;
    setPendingCloseMany(null);
    setCloseManyConfirming(false);
  }, []);

  const confirmClose = useCallback(() => {
    if (pendingCloseTab !== null) {
      disposeTab(pendingCloseTab);
      setPendingCloseTab(null);
    }
  }, [pendingCloseTab, disposeTab]);

  const cancelClose = useCallback(() => {
    setPendingCloseTab(null);
  }, []);

  const confirmTerminalClose = useCallback(() => {
    if (
      pendingTerminalCloseTab !== null &&
      tabsRef.current.some((tab) =>
        tab.id === pendingTerminalCloseTab && tab.kind === "terminal" && !tab.locked,
      )
    ) disposeTab(pendingTerminalCloseTab);
    setPendingTerminalCloseTab(null);
  }, [pendingTerminalCloseTab, disposeTab]);

  const cancelTerminalClose = useCallback(() => {
    setPendingTerminalCloseTab(null);
  }, []);

  const confirmDeleteClose = useCallback(() => {
    if (pendingDeleteTabs !== null) {
      for (const id of pendingDeleteTabs) disposeTab(id);
      setPendingDeleteTabs(null);
    }
  }, [pendingDeleteTabs, disposeTab]);

  const cancelDeleteClose = useCallback(() => {
    setPendingDeleteTabs(null);
  }, []);

  const handlePathDeleted = useCallback(
    (path: string) => {
      const dirty: number[] = [];
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path !== path && !t.path.startsWith(`${path}/`)) continue;
        if (t.dirty) {
          dirty.push(t.id);
        } else {
          disposeTab(t.id);
        }
      }
      if (dirty.length > 0) setPendingDeleteTabs(dirty);
    },
    [tabs, disposeTab],
  );

  return {
    pendingCloseTab,
    pendingTerminalCloseTab,
    pendingDeleteTabs,
    pendingCloseMany,
    closeManyConfirming,
    handleClose,
    handleCloseTabsToRight,
    handleCloseOtherTabs,
    handleCloseAllTabs,
    confirmClose,
    cancelClose,
    confirmTerminalClose,
    cancelTerminalClose,
    confirmDeleteClose,
    cancelDeleteClose,
    confirmCloseMany,
    cancelCloseMany,
    handlePathDeleted,
  };
}
