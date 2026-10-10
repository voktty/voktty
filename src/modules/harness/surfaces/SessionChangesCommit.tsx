import { openExternalUrl } from "@/lib/external-link";
import { type GitStatusSnapshot, native } from "@/modules/ai/lib/native";
import {
  createGithubPullRequest,
  type GithubPrBranchStatus,
  githubPullRequestBranchStatus,
  isGithubConnected,
} from "@/modules/git-review/lib/githubProvider";
import { useTranslation } from "@/modules/i18n";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CheckpointFile,
  keepSessionChanges,
  notifyReviewChanged,
} from "../lib/checkpoint";
import { invalidateProjectFiles } from "../lib/fileIndex";
import { invalidateWatchedFiles } from "../lib/fileWatch";
import { notifyGitChanged } from "../lib/fs";
import { githubOwnerRepoFromRemote } from "../lib/githubRemote";
import {
  resolveSessionCommitRepositories,
  type SessionCommitNotice,
  type SessionCommitRepository,
  type SessionCommitRepositoryResolution,
} from "../lib/sessionCommit";

type Props = {
  cwd: string;
  sessionId: string;
  files: CheckpointFile[];
  onNotice: (notice: SessionCommitNotice | null) => void;
};

type ResolvedRepositories = {
  files: CheckpointFile[];
  result: SessionCommitRepositoryResolution;
};

type RepositoryGitState = {
  repoRoot: string;
  status: GitStatusSnapshot;
  remoteUrl: string | null;
  ownerRepo: string | null;
  githubConnected: boolean;
  githubStatus: GithubPrBranchStatus | null;
  githubError: string | null;
};

type Workflow = "commit" | "push" | "commit-push" | "commit-pr" | "pr";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SessionChangesCommit({
  cwd,
  sessionId,
  files,
  onNotice,
}: Props) {
  const { t } = useTranslation();
  const workspace = useWorkspaceEnvStore((state) => state.env);
  const [resolved, setResolved] = useState<ResolvedRepositories | null>(null);
  const [repoRoot, setRepoRoot] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [message, setMessage] = useState(() =>
    t("sessionReview.defaultCommitMessage"),
  );
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repositoryState, setRepositoryState] =
    useState<RepositoryGitState | null>(null);
  const [repositoryLoading, setRepositoryLoading] = useState(false);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [createdPrUrl, setCreatedPrUrl] = useState<string | null>(null);
  const repositoryHistory = useRef<{
    key: string;
    repositories: SessionCommitRepository[];
  }>({ key: "", repositories: [] });

  useEffect(() => {
    let disposed = false;
    const historyKey = `${sessionId}\0${cwd}`;
    if (repositoryHistory.current.key !== historyKey) {
      repositoryHistory.current = { key: historyKey, repositories: [] };
    }
    setResolved(null);
    void (async () => {
      const result = await resolveSessionCommitRepositories(
        files,
        (directory) => native.gitResolveRepo(directory, workspace),
      );
      if (disposed || repositoryHistory.current.key !== historyKey) return;
      let nextResult = result;
      if (result.repositories.length > 0) {
        repositoryHistory.current = {
          key: historyKey,
          repositories: result.repositories,
        };
      } else if (files.length === 0) {
        const previous = repositoryHistory.current.repositories;
        if (previous.length > 0) {
          nextResult = {
            ...result,
            repositories: previous.map((repo) => ({ ...repo, files: [] })),
          };
        } else {
          const repo = await native
            .gitResolveRepo(cwd, workspace)
            .catch(() => null);
          if (disposed || repositoryHistory.current.key !== historyKey) return;
          if (repo) {
            nextResult = {
              ...result,
              repositories: [{ repoRoot: repo.repoRoot, files: [] }],
            };
            repositoryHistory.current = {
              key: historyKey,
              repositories: nextResult.repositories,
            };
          }
        }
      }
      setResolved({ files, result: nextResult });
    })();
    return () => {
      disposed = true;
    };
  }, [cwd, files, sessionId, workspace]);

  const resolution = resolved?.files === files ? resolved.result : null;
  const repositories = resolution?.repositories ?? [];
  const activeRepo =
    repositories.find((repo) => repo.repoRoot === repoRoot) ?? repositories[0];

  const readRepositoryState = useCallback(
    async (targetRepoRoot: string): Promise<RepositoryGitState> => {
      const [status, remoteUrl] = await Promise.all([
        native.gitStatus(targetRepoRoot, workspace),
        native.gitRemoteUrl(targetRepoRoot, "origin", workspace),
      ]);
      const ownerRepo = githubOwnerRepoFromRemote(remoteUrl);
      let githubConnected = false;
      let githubStatus: GithubPrBranchStatus | null = null;
      let githubError: string | null = null;

      if (ownerRepo && status.branch && !status.isDetached) {
        githubConnected = await isGithubConnected();
        if (githubConnected) {
          try {
            githubStatus = await githubPullRequestBranchStatus(
              ownerRepo,
              status.branch,
            );
          } catch (caught: unknown) {
            githubError = errorMessage(caught);
          }
        }
      }

      return {
        repoRoot: targetRepoRoot,
        status,
        remoteUrl,
        ownerRepo,
        githubConnected,
        githubStatus,
        githubError,
      };
    },
    [workspace],
  );

  const refreshRepositoryState = useCallback(
    async (fetch = false) => {
      if (!activeRepo) return;
      setRepositoryLoading(true);
      setRepositoryError(null);
      try {
        if (fetch) await native.gitFetch(activeRepo.repoRoot, workspace);
        setRepositoryState(await readRepositoryState(activeRepo.repoRoot));
      } catch (caught: unknown) {
        setRepositoryError(errorMessage(caught));
      } finally {
        setRepositoryLoading(false);
      }
    },
    [activeRepo, readRepositoryState, workspace],
  );

  useEffect(() => {
    if (!activeRepo) return;
    setRepoRoot(activeRepo.repoRoot);
    setSelectedPaths(
      new Set(
        activeRepo.files.filter((file) => file.exact).map((file) => file.path),
      ),
    );
  }, [activeRepo]);

  useEffect(() => {
    if (!activeRepo) {
      setRepositoryState(null);
      return;
    }
    let disposed = false;
    setRepositoryState(null);
    setRepositoryError(null);
    setRepositoryLoading(true);
    void readRepositoryState(activeRepo.repoRoot)
      .then((state) => {
        if (!disposed) setRepositoryState(state);
      })
      .catch((caught: unknown) => {
        if (!disposed) setRepositoryError(errorMessage(caught));
      })
      .finally(() => {
        if (!disposed) setRepositoryLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [activeRepo, readRepositoryState]);

  const selectedFiles =
    activeRepo?.files.filter(
      (file) => file.exact && selectedPaths.has(file.path),
    ) ?? [];
  const sharedFileCount = files.filter((file) => !file.exact).length;
  const currentRepositoryState =
    repositoryState?.repoRoot === activeRepo?.repoRoot ? repositoryState : null;
  const gitStatus = currentRepositoryState?.status ?? null;
  const githubStatus = currentRepositoryState?.githubStatus ?? null;
  const hasRemote = Boolean(
    currentRepositoryState?.remoteUrl ||
      currentRepositoryState?.status.upstream,
  );
  const branchDiverged = Boolean(gitStatus?.ahead && gitStatus.behind);
  const branchBehind = Boolean((gitStatus?.behind ?? 0) > 0);
  const hasPrCommits = Boolean(
    selectedFiles.length > 0 || (githubStatus?.aheadBy ?? 0) > 0,
  );
  const canPush = Boolean(
    !committing &&
      gitStatus &&
      !gitStatus.isDetached &&
      !branchBehind &&
      hasRemote &&
      (!gitStatus.upstream || gitStatus.ahead > 0),
  );
  const canCreatePr = Boolean(
    !committing &&
      currentRepositoryState?.ownerRepo &&
      currentRepositoryState.githubConnected &&
      githubStatus &&
      gitStatus &&
      !gitStatus.isDetached &&
      !branchDiverged &&
      !branchBehind &&
      githubStatus.behindBy === 0 &&
      hasPrCommits &&
      !githubStatus.pullRequest &&
      gitStatus.branch !== githubStatus.defaultBranch,
  );

  const openPullRequest = (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && parsed.hostname === "github.com") {
        void openExternalUrl(parsed.href);
      }
    } catch {
      setError("GitHub returned an invalid pull request URL");
    }
  };

  const commitSelectedFiles = async () => {
    if (!activeRepo || selectedFiles.length === 0 || !message.trim()) {
      return null;
    }
    const committed = [...selectedFiles];
    const result = await native.gitCommit(
      activeRepo.repoRoot,
      message,
      workspace,
      committed.map((file) => file.path),
    );
    notifyGitChanged();
    invalidateWatchedFiles(committed.map((file) => file.path));
    invalidateProjectFiles(cwd);

    const checkpointFailures: string[] = [];
    for (const file of committed) {
      try {
        await keepSessionChanges(sessionId, cwd, file.relative);
      } catch {
        checkpointFailures.push(file.relative);
      }
    }
    notifyReviewChanged(sessionId);
    onNotice(
      checkpointFailures.length > 0
        ? {
            kind: "warning",
            message: t("sessionReview.commitCheckpointRefreshFailed"),
          }
        : {
            kind: "success",
            message: t("sessionReview.commitSucceeded", {
              sha: result.commitSha.slice(0, 7),
            }),
          },
    );
    return result;
  };

  const preparePush = async () => {
    if (!activeRepo) throw new Error("No Git repository is selected");
    const initial = await native.gitStatus(activeRepo.repoRoot, workspace);
    if (initial.isDetached) throw new Error("Cannot push a detached HEAD");
    if (
      !initial.upstream &&
      !(await native.gitRemoteUrl(activeRepo.repoRoot, "origin", workspace))
    ) {
      throw new Error("No origin remote is configured");
    }
    await native.gitFetch(activeRepo.repoRoot, workspace);
    const latest = await native.gitStatus(activeRepo.repoRoot, workspace);
    if (latest.behind > 0) {
      throw new Error(
        latest.ahead > 0
          ? t("git.remoteIndicator.diverged")
          : t("git.pullBeforePush"),
      );
    }
  };

  const pushCurrentBranch = async () => {
    if (!activeRepo) throw new Error("No Git repository is selected");
    const latest = await native.gitStatus(activeRepo.repoRoot, workspace);
    if (latest.isDetached) throw new Error("Cannot push a detached HEAD");
    if (latest.behind > 0) throw new Error(t("git.pullBeforePush"));
    if (latest.upstream) {
      await native.gitPush(activeRepo.repoRoot, workspace);
    } else {
      const remoteUrl = await native.gitRemoteUrl(
        activeRepo.repoRoot,
        "origin",
        workspace,
      );
      if (!remoteUrl) throw new Error("No origin remote is configured");
      await native.gitPublish(activeRepo.repoRoot, "origin", workspace);
    }
    notifyGitChanged();
  };

  const createPullRequest = async () => {
    if (!activeRepo) throw new Error("No Git repository is selected");
    const status = await native.gitStatus(activeRepo.repoRoot, workspace);
    if (status.isDetached || !status.branch) {
      throw new Error("Checkout a branch before creating a pull request");
    }
    if (status.ahead > 0 && status.behind > 0) {
      throw new Error("Branch has diverged from upstream; sync it first");
    }
    if (status.behind > 0) throw new Error(t("git.pullBeforePush"));
    const remoteUrl = await native.gitRemoteUrl(
      activeRepo.repoRoot,
      "origin",
      workspace,
    );
    const ownerRepo = githubOwnerRepoFromRemote(remoteUrl);
    if (!ownerRepo) throw new Error("No GitHub origin remote is configured");
    if (!(await isGithubConnected())) {
      throw new Error(t("gitHistory.pulls.tokenRequiredTitle"));
    }

    const branchStatus = await githubPullRequestBranchStatus(
      ownerRepo,
      status.branch,
    );
    if (branchStatus.defaultBranch === status.branch) {
      throw new Error(
        `Cannot create a pull request from the default branch "${status.branch}"`,
      );
    }
    if (branchStatus.pullRequest) {
      throw new Error("A pull request is already open for this branch");
    }
    if (branchStatus.behindBy == null || branchStatus.behindBy > 0) {
      throw new Error(
        "Update the branch from the default branch before creating a pull request",
      );
    }
    if (branchStatus.aheadBy == null || branchStatus.aheadBy === 0) {
      throw new Error(
        "Push at least one commit before creating a pull request",
      );
    }

    const title =
      message.trim().split(/\r?\n/g)[0]?.trim().slice(0, 256) ||
      `Update ${status.branch}`;
    return createGithubPullRequest({
      ownerRepo,
      title,
      body: message.trim(),
      base: branchStatus.defaultBranch,
      head: status.branch,
    });
  };

  const runWorkflow = async (workflow: Workflow) => {
    if (!activeRepo || committing) return;
    if (workflow !== "push" && selectedFiles.length > 0 && !message.trim()) {
      return;
    }
    setCommitting(true);
    setError(null);
    onNotice(null);
    let committedSha: string | null = null;
    try {
      if (
        workflow === "push" ||
        workflow === "commit-push" ||
        workflow === "commit-pr" ||
        workflow === "pr"
      ) {
        await preparePush();
      }
      if (workflow !== "push" && selectedFiles.length > 0) {
        const result = await commitSelectedFiles();
        committedSha = result?.commitSha.slice(0, 7) ?? null;
      }
      if (
        workflow === "push" ||
        workflow === "commit-push" ||
        workflow === "commit-pr" ||
        workflow === "pr"
      ) {
        await pushCurrentBranch();
      }
      if (workflow === "commit-pr" || workflow === "pr") {
        const url = await createPullRequest();
        setCreatedPrUrl(url);
        onNotice({
          kind: "success",
          message: `${t("harness.chrome.createPr")}: ${url}`,
        });
        await openExternalUrl(url);
      }
      if (workflow !== "commit") {
        await refreshRepositoryState();
      }
    } catch (caught: unknown) {
      const detail = errorMessage(caught);
      setError(detail);
      if (committedSha) {
        onNotice({
          kind: "warning",
          message: `${t("sessionReview.commitSucceeded", { sha: committedSha })}: ${detail}`,
        });
      }
    } finally {
      setCommitting(false);
    }
  };

  if (resolution == null) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-content/45">
        {t("sessionReview.findingRepositories")}
      </div>
    );
  }

  if (repositories.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <p className="text-[13px] text-content/65">
          {files.length === 0
            ? t("harness.chrome.noSessionChanges")
            : files.every((file) => !file.exact)
              ? t("sessionReview.noExactFilesToCommit")
              : t("sessionReview.noRepositoryForChanges")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 font-sans">
      <div className="flex min-w-0 items-center gap-2">
        {repositories.length > 1 ? (
          <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-content/55">
            <span className="shrink-0">{t("sessionReview.repository")}</span>
            <select
              aria-label={t("sessionReview.repository")}
              value={activeRepo.repoRoot}
              disabled={committing}
              onChange={(event) => setRepoRoot(event.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-content/12 bg-content/5 px-2 text-[12px] text-content outline-none focus:border-content/30"
            >
              {repositories.map((repo) => (
                <option key={repo.repoRoot} value={repo.repoRoot}>
                  {repo.repoRoot}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-content/45">
            {activeRepo.repoRoot}
          </span>
        )}
        <button
          type="button"
          disabled={committing || selectedFiles.length === 0 || !message.trim()}
          onClick={() => void runWorkflow("commit")}
          className="h-8 shrink-0 rounded-md bg-content px-3 text-[12px] font-medium text-background-base hover:bg-content/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {committing
            ? t("sessionReview.committing")
            : t("sessionReview.commitSelected", {
                count: selectedFiles.length,
              })}
        </button>
        {selectedFiles.length > 0 ? (
          <button
            type="button"
            disabled={
              committing ||
              !hasRemote ||
              branchBehind ||
              branchDiverged ||
              !message.trim()
            }
            onClick={() => void runWorkflow("commit-push")}
            className="h-8 shrink-0 rounded-md border border-content/15 px-3 text-[12px] text-content/80 hover:bg-content/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("harness.chrome.commitAndPush")}
          </button>
        ) : canPush ? (
          <button
            type="button"
            disabled={committing}
            onClick={() => void runWorkflow("push")}
            className="h-8 shrink-0 rounded-md border border-content/15 px-3 text-[12px] text-content/80 hover:bg-content/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {gitStatus?.upstream
              ? t("git.push")
              : t("harness.chrome.publishBranch")}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-content/10 px-3 py-2 text-[11px] text-content/55">
        {repositoryLoading ? (
          <span>{t("git.waitRepoLoading")}</span>
        ) : currentRepositoryState ? (
          <>
            <span className="min-w-0 flex-1 truncate font-mono">
              {currentRepositoryState.ownerRepo ?? activeRepo.repoRoot}
            </span>
            <button
              type="button"
              disabled={committing || repositoryLoading || !hasRemote}
              onClick={() => void refreshRepositoryState(true)}
              className="h-7 rounded-md border border-content/15 px-2 text-content/75 hover:bg-content/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("gitHistory.pulls.refresh")}
            </button>
            {currentRepositoryState.ownerRepo ? (
              currentRepositoryState.githubConnected ? (
                currentRepositoryState.githubError ? (
                  <span role="alert" className="w-full text-red-300">
                    {currentRepositoryState.githubError}
                  </span>
                ) : githubStatus?.pullRequest ? (
                  <button
                    type="button"
                    disabled={committing}
                    onClick={() => {
                      const url = githubStatus.pullRequest?.htmlUrl;
                      if (url) openPullRequest(url);
                    }}
                    className="h-7 rounded-md border border-content/15 px-2 text-content/75 hover:bg-content/5 disabled:opacity-40"
                  >
                    {t("harness.chrome.viewPr")}
                  </button>
                ) : canCreatePr ? (
                  <button
                    type="button"
                    disabled={committing}
                    onClick={() =>
                      void runWorkflow(
                        selectedFiles.length > 0 ? "commit-pr" : "pr",
                      )
                    }
                    className="h-7 rounded-md border border-content/15 px-2 text-content/75 hover:bg-content/5 disabled:opacity-40"
                  >
                    {selectedFiles.length > 0
                      ? t("harness.chrome.commitPushCreatePr")
                      : t("harness.chrome.createPr")}
                  </button>
                ) : null
              ) : (
                <span className="w-full">
                  {t("gitHistory.pulls.tokenRequiredTitle")}
                </span>
              )
            ) : (
              <span className="w-full">
                {t("gitHistory.pulls.noRemoteFound")}
              </span>
            )}
            {createdPrUrl ? (
              <button
                type="button"
                disabled={committing}
                onClick={() => openPullRequest(createdPrUrl)}
                className="h-7 rounded-md border border-content/15 px-2 text-content/75 hover:bg-content/5 disabled:opacity-40"
              >
                {t("gitHistory.pulls.openInBrowser")}
              </button>
            ) : null}
          </>
        ) : repositoryError ? (
          <span role="alert" className="text-red-300">
            {repositoryError}
          </span>
        ) : (
          <span>{t("git.waitRepoLoading")}</span>
        )}
        {repositoryError && currentRepositoryState ? (
          <span role="alert" className="w-full text-red-300">
            {repositoryError}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-content/10">
        {activeRepo.files.map((file) => (
          <label
            key={file.path}
            className="flex min-h-9 items-center gap-2 border-b border-content/6 px-3 text-[12px] last:border-b-0"
          >
            <input
              type="checkbox"
              checked={selectedPaths.has(file.path)}
              disabled={!file.exact || committing}
              onChange={(event) => {
                setSelectedPaths((previous) => {
                  const next = new Set(previous);
                  if (event.target.checked) next.add(file.path);
                  else next.delete(file.path);
                  return next;
                });
              }}
              className="accent-content"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-content/75">
              {file.relative}
            </span>
            {!file.exact ? (
              <span className="shrink-0 text-[10px] text-amber-300/75">
                {t("sessionReview.sharedFile")}
              </span>
            ) : null}
          </label>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-[11px] text-content/55">
        <span>{t("sessionReview.commitMessage")}</span>
        <textarea
          value={message}
          disabled={committing}
          onChange={(event) => setMessage(event.target.value)}
          rows={2}
          maxLength={4096}
          className="resize-y rounded-md border border-content/12 bg-content/5 px-2.5 py-2 font-mono text-[12px] text-content outline-none focus:border-content/30 disabled:opacity-50"
        />
      </label>

      {sharedFileCount > 0 ? (
        <p className="text-[11px] text-amber-300/70">
          {t("sessionReview.sharedFilesExcluded", { count: sharedFileCount })}
        </p>
      ) : null}
      {resolution.unresolvedFiles.length > 0 ? (
        <p className="text-[11px] text-content/45">
          {t("sessionReview.unresolvedFilesExcluded", {
            count: resolution.unresolvedFiles.length,
          })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12px] text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
