import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Tab } from "./useTabs";

type Result = {
  explorerRoot: string | null;
  explorerTerminalId: number | null;
  inheritedCwdForNewTab: () => string | undefined;
};

export type WorkspaceCwdSelection = {
  explorerRoot: string | null;
  explorerTerminalId: number | null;
};

export type TerminalSpawnContext = {
  cwd: string | undefined;
  workspaceEnv: WorkspaceEnv;
};

export function selectLocalTerminalSpawnContext(
  localHome: string | null | undefined,
): TerminalSpawnContext {
  return {
    workspaceEnv: LOCAL_WORKSPACE,
    cwd: localHome ?? undefined,
  };
}

export function selectWorkspaceCwd(
  activeTab: Tab | undefined,
  spaceTabs: Tab[],
  fallbackRoot: string | null,
  lastTerminalId: number | undefined,
): WorkspaceCwdSelection {
  if (
    (activeTab?.kind === "terminal" || activeTab?.kind === "harness") &&
    activeTab.cwd
  ) {
    return {
      explorerRoot: activeTab.cwd,
      explorerTerminalId: activeTab.id,
    };
  }

  const lastTerminal = spaceTabs.find(
    (tab) =>
      tab.id === lastTerminalId &&
      (tab.kind === "terminal" || tab.kind === "harness") &&
      Boolean(tab.cwd),
  );
  if (
    (lastTerminal?.kind === "terminal" || lastTerminal?.kind === "harness") &&
    lastTerminal.cwd
  ) {
    return {
      explorerRoot: lastTerminal.cwd,
      explorerTerminalId: lastTerminal.id,
    };
  }

  const anyTerminal = spaceTabs.find(
    (tab) =>
      (tab.kind === "terminal" || tab.kind === "harness") && Boolean(tab.cwd),
  );
  if (
    (anyTerminal?.kind === "terminal" || anyTerminal?.kind === "harness") &&
    anyTerminal.cwd
  ) {
    return {
      explorerRoot: anyTerminal.cwd,
      explorerTerminalId: anyTerminal.id,
    };
  }

  return { explorerRoot: fallbackRoot, explorerTerminalId: null };
}

export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  tabs: Tab[],
  home: string | null,
  spaceId: string,
): Result {
  const lastTerminalId = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (
      (activeTab?.kind === "terminal" || activeTab?.kind === "harness") &&
      activeTab.cwd
    ) {
      lastTerminalId.current.set(spaceId, activeTab.id);
    }
  }, [activeTab, spaceId]);

  const spaceTabs = useMemo(
    () => tabs.filter((tab) => tab.spaceId === spaceId),
    [tabs, spaceId],
  );

  const { explorerRoot, explorerTerminalId } = useMemo(
    () =>
      selectWorkspaceCwd(
        activeTab,
        spaceTabs,
        home,
        lastTerminalId.current.get(spaceId),
      ),
    [activeTab, home, spaceId, spaceTabs],
  );

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    if (
      (activeTab?.kind === "terminal" || activeTab?.kind === "harness") &&
      activeTab.cwd
    )
      return activeTab.cwd;
    const lastTerminal = spaceTabs.find(
      (tab) =>
        tab.id === lastTerminalId.current.get(spaceId) &&
        (tab.kind === "terminal" || tab.kind === "harness") &&
        Boolean(tab.cwd),
    );
    if (
      (lastTerminal?.kind === "terminal" || lastTerminal?.kind === "harness") &&
      lastTerminal.cwd
    ) {
      return lastTerminal.cwd;
    }
    return home ?? undefined;
  }, [activeTab, home, spaceId, spaceTabs]);

  return { explorerRoot, explorerTerminalId, inheritedCwdForNewTab };
}
