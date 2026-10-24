import { native } from "@/modules/ai/lib/native";
import { t as translate } from "@/modules/i18n";
import type { SidebarViewId } from "@/modules/sidebar";
import type { Tab } from "@/modules/tabs";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  activeRepositoryContextPath,
  gitGraphTarget,
  type SourceControlRepositoryTarget,
  sourceControlRepositoryPath,
} from "./repositoryTarget";
import { useSourceControl } from "./useSourceControl";

type Params = {
  activeTab: Tab | undefined;
  tabs: Tab[];
  activeTerminalLeafCwd: string | null;
  explorerRoot: string | null;
  launchCwd: string | null;
  launchCwdResolved: boolean;
  home: string | null;
  sidebarView: SidebarViewId;
  explorerGitDecorations: boolean;
  repositoryTarget: SourceControlRepositoryTarget;
  cycleSidebarView: (view: SidebarViewId) => void;
  openCommitHistoryTab: (args: {
    repoRoot: string;
    branch: string | null;
    workspaceEnv?: WorkspaceEnv;
  }) => void;
};

export function shouldKeepSourceControlLive(
  sidebarView: SidebarViewId,
  explorerGitDecorations: boolean,
): boolean {
  return (
    sidebarView === "source-control" ||
    (sidebarView === "explorer" && explorerGitDecorations)
  );
}

/**
 * Resolves the source-control context path off the active tab and feeds the
 * source-control summary. When git is not active the badge tracks a stable
 * per-session path so tab switches / cd don't re-fire git IPC.
 */
export function useSourceControlContext({
  activeTab,
  tabs,
  activeTerminalLeafCwd,
  explorerRoot,
  launchCwd,
  launchCwdResolved,
  home,
  sidebarView,
  explorerGitDecorations,
  repositoryTarget,
  cycleSidebarView,
  openCommitHistoryTab,
}: Params) {
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const workspaceFallbackPath = launchCwdResolved
    ? (launchCwd ?? home ?? null)
    : null;
  const sourceControlContextPath = activeRepositoryContextPath({
    activeTab,
    activeTerminalLeafCwd,
    explorerRoot,
    workspaceFallbackPath,
  });
  const hasOpenGitTab = useMemo(
    () =>
      tabs.some(
        (t) =>
          t.kind === "git-diff" ||
          t.kind === "git-history" ||
          t.kind === "git-commit-file" ||
          t.kind === "git-commit",
      ),
    [tabs],
  );
  // Ambient path tracks the explorer root so the rail badge and explorer git
  // decorations reflect the repo you are actually looking at. cd-within-repo
  // churn is absorbed by the status TTL + reusable-root path in useSourceControl.
  const badgeContextPath = explorerRoot ?? workspaceFallbackPath;
  const sourceControlPath = sourceControlRepositoryPath({
    contextPath: sourceControlContextPath,
    badgeContextPath,
    sidebarView,
    hasOpenGitTab,
    target: repositoryTarget,
  });
  const graphTarget = gitGraphTarget({
    activeTab,
    activeTerminalLeafCwd,
    root: explorerRoot ?? workspaceFallbackPath,
    workspace: workspaceEnv,
    sidebarView,
    target: repositoryTarget,
  });
  const sourceControl = useSourceControl(
    sourceControlPath,
    true,
    shouldKeepSourceControlLive(sidebarView, explorerGitDecorations),
  );

  const toggleSourceControl = useCallback(() => {
    cycleSidebarView("source-control");
  }, [cycleSidebarView]);

  const graphPath = graphTarget?.path;
  const graphWorkspace = graphTarget?.workspace;
  const sourceId = activeTab?.id;
  const sourceKey = activeTab?.tabKey;
  const sourceSpace = activeTab?.spaceId;
  const sourceKind = activeTab?.kind;
  const sourceLeaf =
    activeTab?.kind === "terminal" ? activeTab.activeLeafId : undefined;
  const targetMode = repositoryTarget.mode;
  const graphBinding = useMemo(
    () => ({
      sourceId,
      sourceKey,
      sourceSpace,
      sourceKind,
      sourceLeaf,
      graphPath,
      graphWorkspace,
      sidebarView,
      targetMode,
      openCommitHistoryTab,
    }),
    [
      sourceId,
      sourceKey,
      sourceSpace,
      sourceKind,
      sourceLeaf,
      graphPath,
      graphWorkspace,
      sidebarView,
      targetMode,
      openCommitHistoryTab,
    ],
  );
  const graphOwner = useRef<object | null>(null);
  const graphPending = useRef(new Set<object>());
  useLayoutEffect(() => {
    graphOwner.current = graphBinding;
    return () => {
      if (graphOwner.current === graphBinding) graphOwner.current = null;
    };
  }, [graphBinding]);

  const openGitGraphFromContext = useCallback(async () => {
    const current = () => graphOwner.current === graphBinding;
    if (!current()) return;
    if (!graphPath || !graphWorkspace) {
      toast.info(translate("feedback.noGitRepository"));
      return;
    }
    if (graphPending.current.size >= 256) return;
    const request = {};
    graphPending.current.add(request);
    try {
      const repo = await native.gitResolveRepo(graphPath, graphWorkspace);
      if (!current()) return;
      if (!repo) {
        toast.info(translate("feedback.noGitRepository"));
        return;
      }
      openCommitHistoryTab({
        repoRoot: repo.repoRoot,
        branch: repo.branch,
        workspaceEnv: graphWorkspace,
      });
    } catch (error) {
      if (!current()) return;
      toast.error(translate("feedback.resolveGitRepositoryFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      graphPending.current.delete(request);
    }
  }, [openCommitHistoryTab, graphBinding, graphPath, graphWorkspace]);

  return { sourceControl, toggleSourceControl, openGitGraphFromContext };
}
