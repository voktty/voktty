import { native } from "@/modules/ai/lib/native";
import { t as translate } from "@/modules/i18n";
import type { SidebarViewId } from "@/modules/sidebar";
import type { Tab } from "@/modules/tabs";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  activeRepositoryContextPath,
  gitGraphRepositoryPath,
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
  repositoryTarget: SourceControlRepositoryTarget;
  cycleSidebarView: (view: SidebarViewId) => void;
  openCommitHistoryTab: (args: {
    repoRoot: string;
    branch: string | null;
    workspaceEnv?: WorkspaceEnv;
  }) => void;
};

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
  const graphContextPath = gitGraphRepositoryPath({
    contextPath: sourceControlContextPath,
    workspaceFallbackPath:
      workspaceEnv.kind === "local" ? workspaceFallbackPath : null,
    sidebarView,
    target: repositoryTarget,
  });
  const sourceControl = useSourceControl(sourceControlPath, true);

  const toggleSourceControl = useCallback(() => {
    cycleSidebarView("source-control");
  }, [cycleSidebarView]);

  const openGitGraphFromContext = useCallback(async () => {
    const known = sourceControl.hasRepo ? sourceControl.repo : null;
    const fixedTargetIsLoaded =
      sidebarView !== "source-control" ||
      repositoryTarget.mode !== "fixed" ||
      known?.repoRoot === repositoryTarget.repoRoot;
    if (known && fixedTargetIsLoaded) {
      openCommitHistoryTab({
        repoRoot: known.repoRoot,
        branch: sourceControl.status?.branch ?? null,
        workspaceEnv,
      });
      return;
    }
    if (!graphContextPath) {
      toast.info(translate("feedback.noGitRepository"));
      return;
    }
    try {
      const repo = await native.gitResolveRepo(graphContextPath, workspaceEnv);
      if (!repo) {
        toast.info(translate("feedback.noGitRepository"));
        return;
      }
      openCommitHistoryTab({
        repoRoot: repo.repoRoot,
        branch: repo.branch,
        workspaceEnv,
      });
    } catch (error) {
      toast.error(translate("feedback.resolveGitRepositoryFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    openCommitHistoryTab,
    sourceControl.hasRepo,
    sourceControl.repo,
    sourceControl.status?.branch,
    graphContextPath,
    repositoryTarget,
    sidebarView,
    workspaceEnv,
  ]);

  return { sourceControl, toggleSourceControl, openGitGraphFromContext };
}
