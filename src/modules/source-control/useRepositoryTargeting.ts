import { native } from "@/modules/ai/lib/native";
import { t } from "@/modules/i18n";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  clearRepositoryTargetForSpace,
  repositoryTargetForSpace,
  setRepositoryTargetForSpace,
  type SourceControlRepositoryTargets,
} from "./repositoryTarget";

type RequestCounter = { current: number };

type Params = {
  spaceId: string;
  workspaceKey: string;
  isContextCurrent: (spaceId: string, workspaceKey: string) => boolean;
  openSourceControl: () => void;
  openCommitHistoryTab: (input: {
    repoRoot: string;
    branch: string | null;
    workspaceEnv?: WorkspaceEnv;
  }) => void;
};

export function useRepositoryTargeting({
  spaceId,
  workspaceKey,
  isContextCurrent,
  openSourceControl,
  openCommitHistoryTab,
}: Params) {
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const [targets, setTargets] = useState<SourceControlRepositoryTargets>({});
  const sourceControlRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const requestScope = `${spaceId}\0${workspaceKey}`;
  const requestScopeRef = useRef(requestScope);
  const repositoryTarget = useMemo(
    () => repositoryTargetForSpace(targets, spaceId, workspaceKey),
    [spaceId, targets, workspaceKey],
  );

  useEffect(() => {
    if (requestScopeRef.current === requestScope) return;
    requestScopeRef.current = requestScope;
    sourceControlRequestRef.current += 1;
    historyRequestRef.current += 1;
  }, [requestScope]);

  const resolveRepository = useCallback(
    async (
      path: string,
      requestRef: RequestCounter,
      isCurrent: () => boolean = () => true,
      workspaceOverride?: WorkspaceEnv,
    ) => {
      if (!isCurrent() || !isContextCurrent(spaceId, workspaceKey)) return null;
      const requestId = ++requestRef.current;
      try {
        const repo = await native.gitResolveRepo(path, workspaceOverride ?? workspaceEnv);
        if (
          requestId !== requestRef.current ||
          !isCurrent() ||
          !isContextCurrent(spaceId, workspaceKey)
        ) {
          return null;
        }
        if (!repo) {
          toast.info(t("feedback.noGitRepository"));
        }
        return repo;
      } catch (error) {
        if (
          requestId === requestRef.current &&
          isCurrent() &&
          isContextCurrent(spaceId, workspaceKey)
        ) {
          toast.error(t("feedback.resolveGitRepositoryFailed"), {
            description: String(error),
          });
        }
        return null;
      }
    },
    [isContextCurrent, spaceId, workspaceEnv, workspaceKey],
  );

  const openInSourceControl = useCallback(
    async (
      path: string,
      isCurrent: () => boolean = () => true,
      workspaceOverride?: WorkspaceEnv,
    ) => {
      const current = () => isCurrent() && isContextCurrent(spaceId, workspaceKey);
      const repo = await resolveRepository(path, sourceControlRequestRef, current, workspaceOverride);
      if (!repo || !current()) return;
      setTargets((previous) =>
        current()
          ? setRepositoryTargetForSpace(previous, spaceId, workspaceKey, repo.repoRoot, workspaceOverride)
          : previous,
      );
      if (current()) openSourceControl();
    },
    [isContextCurrent, openSourceControl, resolveRepository, spaceId, workspaceKey],
  );

  const openGitHistory = useCallback(
    async (path: string) => {
      const repo = await resolveRepository(path, historyRequestRef);
      if (!repo) return;
      openCommitHistoryTab({
        repoRoot: repo.repoRoot,
        branch: repo.branch,
        workspaceEnv,
      });
    },
    [openCommitHistoryTab, resolveRepository, workspaceEnv],
  );

  const followActiveContext = useCallback(() => {
    sourceControlRequestRef.current += 1;
    setTargets((current) =>
      clearRepositoryTargetForSpace(current, spaceId, workspaceKey),
    );
  }, [spaceId, workspaceKey]);

  return {
    repositoryTarget,
    openInSourceControl,
    openGitHistory,
    followActiveContext,
  };
}
