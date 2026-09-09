import {
  type GitBranchEntry,
  type GitRepoInfo,
  type GitStatusSnapshot,
  native,
} from "@/modules/ai/lib/native";
import { useTranslation } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { GitWorkbenchHeader } from "./components/GitWorkbenchHeader";
import { GitWorkbenchNav } from "./components/GitWorkbenchNav";
import type {
  CommitDiffOpenInput,
  CommitFileDiffOpenInput,
  GitBranchScope,
  GitHistorySearchHandle,
  GitWorkbenchSection,
} from "./types";
import { GitBranchesView } from "./views/GitBranchesView";
import { GitCompareView } from "./views/GitCompareView";
import { GitHistoryView } from "./views/GitHistoryView";
import { GitRemotesView } from "./views/GitRemotesView";
import { GitTagsStashesView } from "./views/GitTagsStashesView";
import { GitWorktreesView } from "./views/GitWorktreesView";

export type { GitHistorySearchHandle };

type Props = {
  repoRoot: string;
  workspaceEnv?: WorkspaceEnv;
  onOpenCommitFile: (input: CommitFileDiffOpenInput) => void;
  onOpenCommitDiff: (input: CommitDiffOpenInput) => void;
  /** Lets the header search bar drive commit filtering for the active pane. */
  onSearchHandle?: (handle: GitHistorySearchHandle | null) => void;
};

export function GitHistoryPane({
  repoRoot,
  workspaceEnv,
  onOpenCommitFile,
  onOpenCommitDiff,
  onSearchHandle,
}: Props) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<GitWorkbenchSection>("history");
  const [branchScope, setBranchScope] = useState<GitBranchScope>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [repoInfo, setRepoInfo] = useState<GitRepoInfo | null>(null);
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null);

  const [isFetching, setIsFetching] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  // Wire external search handle
  useEffect(() => {
    onSearchHandle?.({
      setQuery: (query: string) => setSearchQuery(query),
      clearQuery: () => setSearchQuery(""),
    });
    return () => onSearchHandle?.(null);
  }, [onSearchHandle]);

  const loadMetadata = useCallback(async () => {
    try {
      const [branchRes, panelSnapshot] = await Promise.all([
        native.gitListBranches(repoRoot, workspaceEnv),
        native.gitPanelSnapshot(repoRoot, workspaceEnv).catch(() => null),
      ]);
      setBranches(branchRes.branches || []);
      if (panelSnapshot) {
        setRepoInfo(panelSnapshot.repo);
        setStatus(panelSnapshot.status);
      }
    } catch {
      // Ignored silently during background sync
    }
  }, [repoRoot, workspaceEnv]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata, refreshTick]);

  const handleFetch = useCallback(async () => {
    try {
      setIsFetching(true);
      await native.gitFetch(repoRoot, workspaceEnv);
      toast.success(t("gitHistory.workbench.header.fetchSuccess"));
      await loadMetadata();
      setRefreshTick((t) => t + 1);
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Fetch failed"
      );
    } finally {
      setIsFetching(false);
    }
  }, [loadMetadata, repoRoot, workspaceEnv, t]);

  const handlePull = useCallback(async () => {
    try {
      setIsPulling(true);
      await native.gitPullFfOnly(repoRoot, workspaceEnv);
      toast.success(t("gitHistory.workbench.header.pullSuccess"));
      await loadMetadata();
      setRefreshTick((t) => t + 1);
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Pull failed"
      );
    } finally {
      setIsPulling(false);
    }
  }, [loadMetadata, repoRoot, workspaceEnv, t]);

  const handlePush = useCallback(async () => {
    try {
      setIsPushing(true);
      await native.gitPush(repoRoot, workspaceEnv);
      toast.success(t("gitHistory.workbench.header.pushSuccess"));
      await loadMetadata();
      setRefreshTick((t) => t + 1);
    } catch (err) {
      toast.error(
        typeof err === "string" ? err : (err as Error).message || "Push failed"
      );
    } finally {
      setIsPushing(false);
    }
  }, [loadMetadata, repoRoot, workspaceEnv, t]);

  const handleCheckoutBranch = useCallback(
    async (branchName: string) => {
      try {
        await native.gitCheckoutBranch(repoRoot, branchName, workspaceEnv);
        toast.success(
          t("gitHistory.branches.checkoutSuccess", { branch: branchName })
        );
        await loadMetadata();
        setRefreshTick((t) => t + 1);
      } catch (err) {
        toast.error(
          typeof err === "string" ? err : (err as Error).message || "Checkout failed"
        );
      }
    },
    [loadMetadata, repoRoot, workspaceEnv, t]
  );

  const handleRefresh = useCallback(async () => {
    try {
      setIsRefreshing(true);
      await loadMetadata();
      setRefreshTick((t) => t + 1);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadMetadata]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* 1. Activity Rail */}
      <GitWorkbenchNav
        activeSection={activeSection}
        onSelectSection={setActiveSection}
      />

      {/* 2. Main Area */}
      <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
        {/* Top Header */}
        <GitWorkbenchHeader
          repoRoot={repoRoot}
          repoInfo={repoInfo}
          status={status}
          branches={branches}
          branchScope={branchScope}
          onChangeBranchScope={setBranchScope}
          searchQuery={searchQuery}
          onChangeSearchQuery={setSearchQuery}
          onCheckoutBranch={handleCheckoutBranch}
          onFetch={handleFetch}
          onPull={handlePull}
          onPush={handlePush}
          onRefresh={handleRefresh}
          isFetching={isFetching}
          isPulling={isPulling}
          isPushing={isPushing}
          isRefreshing={isRefreshing}
        />

        {/* View Switcher */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          {activeSection === "history" && (
            <GitHistoryView
              key={`history-${refreshTick}`}
              repoRoot={repoRoot}
              workspaceEnv={workspaceEnv}
              searchQuery={searchQuery}
              branchScope={branchScope}
              onOpenCommitFile={onOpenCommitFile}
              onOpenCommitDiff={onOpenCommitDiff}
              onRefreshNeeded={loadMetadata}
            />
          )}

          {activeSection === "branches" && (
            <GitBranchesView
              repoRoot={repoRoot}
              workspaceEnv={workspaceEnv}
              currentBranch={repoInfo?.branch ?? status?.branch}
              onCheckoutBranch={handleCheckoutBranch}
            />
          )}

          {activeSection === "worktrees" && (
            <GitWorktreesView
              repoRoot={repoRoot}
              workspaceEnv={workspaceEnv}
            />
          )}

          {activeSection === "tags-stashes" && (
            <GitTagsStashesView
              repoRoot={repoRoot}
              workspaceEnv={workspaceEnv}
            />
          )}

          {activeSection === "remotes" && (
            <GitRemotesView
              repoRoot={repoRoot}
              workspaceEnv={workspaceEnv}
              currentBranch={repoInfo?.branch ?? status?.branch}
            />
          )}

          {activeSection === "compare" && (
            <GitCompareView
              repoRoot={repoRoot}
              workspaceEnv={workspaceEnv}
              currentBranch={repoInfo?.branch ?? status?.branch}
              onOpenFileDiff={(file, base, compare) =>
                onOpenCommitFile({
                  repoRoot,
                  sha: compare,
                  shortSha: compare.slice(0, 7),
                  subject: `Compare ${base}..${compare}`,
                  path: file.path,
                  originalPath: file.originalPath,
                  workspaceEnv,
                })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
