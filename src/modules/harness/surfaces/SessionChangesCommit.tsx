import { useEffect, useState } from "react";
import { native } from "@/modules/ai/lib/native";
import { useTranslation } from "@/modules/i18n";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import {
  keepSessionChanges,
  notifyReviewChanged,
  type CheckpointFile,
} from "../lib/checkpoint";
import { invalidateProjectFiles } from "../lib/fileIndex";
import { invalidateWatchedFiles } from "../lib/fileWatch";
import { notifyGitChanged } from "../lib/fs";
import {
  resolveSessionCommitRepositories,
  type SessionCommitNotice,
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

  useEffect(() => {
    let disposed = false;
    setResolved(null);
    void resolveSessionCommitRepositories(files, (directory) =>
      native.gitResolveRepo(directory, workspace),
    ).then((result) => {
      if (!disposed) setResolved({ files, result });
    });
    return () => {
      disposed = true;
    };
  }, [files, workspace]);

  const resolution = resolved?.files === files ? resolved.result : null;
  const repositories = resolution?.repositories ?? [];
  const activeRepo =
    repositories.find((repo) => repo.repoRoot === repoRoot) ?? repositories[0];

  useEffect(() => {
    if (!activeRepo) return;
    setRepoRoot(activeRepo.repoRoot);
    setSelectedPaths(
      new Set(
        activeRepo.files.filter((file) => file.exact).map((file) => file.path),
      ),
    );
  }, [activeRepo]);

  const selectedFiles =
    activeRepo?.files.filter(
      (file) => file.exact && selectedPaths.has(file.path),
    ) ?? [];
  const sharedFileCount = files.filter((file) => !file.exact).length;

  const commit = async () => {
    if (!activeRepo || selectedFiles.length === 0 || !message.trim()) return;
    setCommitting(true);
    setError(null);
    onNotice(null);
    try {
      const result = await native.gitCommit(
        activeRepo.repoRoot,
        message,
        workspace,
        selectedFiles.map((file) => file.path),
      );
      const committedPaths = selectedFiles.map((file) => file.path);
      notifyGitChanged();
      invalidateWatchedFiles(committedPaths);
      invalidateProjectFiles(cwd);

      const checkpointFailures: string[] = [];
      for (const file of selectedFiles) {
        try {
          await keepSessionChanges(sessionId, cwd, file.relative);
        } catch {
          checkpointFailures.push(file.relative);
        }
      }
      notifyReviewChanged(sessionId);
      if (checkpointFailures.length > 0) {
        onNotice({
          kind: "warning",
          message: t("sessionReview.commitCheckpointRefreshFailed"),
        });
      } else {
        onNotice({
          kind: "success",
          message: t("sessionReview.commitSucceeded", {
            sha: result.commitSha.slice(0, 7),
          }),
        });
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
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

  if (files.length === 0) {
    return (
      <p className="grid h-full place-items-center text-[13px] text-content/45">
        {t("harness.chrome.noSessionChanges")}
      </p>
    );
  }

  if (repositories.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <p className="text-[13px] text-content/65">
          {files.every((file) => !file.exact)
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
          onClick={() => void commit()}
          className="h-8 shrink-0 rounded-md bg-content px-3 text-[12px] font-medium text-background-base hover:bg-content/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {committing
            ? t("sessionReview.committing")
            : t("sessionReview.commitSelected", {
                count: selectedFiles.length,
              })}
        </button>
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
