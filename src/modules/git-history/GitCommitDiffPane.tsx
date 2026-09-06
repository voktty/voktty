import { native, type GitCommitFileChange } from "@/modules/ai/lib/native";
import type { WorkspaceEnv } from "@/modules/workspace";
import { forEachConcurrent } from "@/modules/harness/lib/concurrent";
import {
  buildUnifiedFile,
  type UnifiedFileDiff,
} from "@/modules/harness/lib/unifiedDiff";
import {
  UnifiedDiffView,
  type UnifiedDiffFileModel,
} from "@/modules/harness/surfaces/UnifiedDiffView";
import { useTranslation } from "@/modules/i18n";
import { Spinner } from "@/components/ui/spinner";
import { useEffect, useMemo, useState } from "react";

type Props = {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  workspaceEnv?: WorkspaceEnv;
};

type LoadedDiff = {
  binary: boolean;
  truncated: boolean;
  unified: UnifiedFileDiff | null;
  error?: string;
};

const DIFF_LOAD_CONCURRENCY = 4;

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/** Every file of one commit in a single unified diff, so reading a ten file
 * commit does not mean opening ten tabs. Contents come from the same pair of
 * blobs the per-file view uses, one commit-scoped call per file. */
export function GitCommitDiffPane({
  repoRoot,
  sha,
  shortSha,
  subject,
  workspaceEnv,
}: Props) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<GitCommitFileChange[] | null>(null);
  const [diffs, setDiffs] = useState<Map<string, LoadedDiff>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setFiles(null);
    setDiffs(new Map());
    setError(null);

    native
      .gitCommitFiles(repoRoot, sha, workspaceEnv)
      .then(async (entries) => {
        if (disposed) return;
        setFiles(entries);
        await forEachConcurrent(
          entries,
          DIFF_LOAD_CONCURRENCY,
          async (file) => {
            let loaded: LoadedDiff;
            try {
              const diff = await native.gitCommitFileDiff(
                repoRoot,
                sha,
                file.path,
                file.originalPath,
                workspaceEnv,
              );
              loaded = {
                binary: diff.isBinary,
                truncated: diff.truncated,
                unified: diff.isBinary
                  ? null
                  : buildUnifiedFile(
                      diff.originalContent,
                      diff.modifiedContent,
                    ),
              };
            } catch (caught: unknown) {
              loaded = {
                binary: false,
                truncated: false,
                unified: null,
                error: normalizeError(caught),
              };
            }
            if (disposed) return;
            setDiffs((existing) => {
              const next = new Map(existing);
              next.set(file.path, loaded);
              return next;
            });
          },
          () => !disposed,
        );
      })
      .catch((caught: unknown) => {
        if (disposed) return;
        setError(normalizeError(caught));
        setFiles([]);
      });

    return () => {
      disposed = true;
    };
  }, [repoRoot, sha, workspaceEnv]);

  const models = useMemo<UnifiedDiffFileModel[]>(() => {
    if (!files) return [];
    return files.map((file) => {
      const loaded = diffs.get(file.path);
      const unified = loaded?.unified ?? null;
      return {
        id: file.path,
        path: file.path,
        label: file.path,
        binary: loaded?.binary ?? file.isBinary,
        tooLarge: loaded?.truncated,
        emptyMessage:
          loaded == null
            ? t("gitHistory.loadingFiles")
            : loaded.error
              ? loaded.error
              : undefined,
        additions: unified?.additions ?? file.added,
        deletions: unified?.deletions ?? file.removed,
        blocks: unified?.blocks ?? [],
      };
    });
  }, [diffs, files, t]);

  const totals = useMemo(
    () =>
      models.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [models],
  );

  const anyTruncated = useMemo(
    () => [...diffs.values()].some((entry) => entry.truncated),
    [diffs],
  );

  if (error) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-[12px] text-destructive">
        {error}
      </div>
    );
  }

  if (files === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[12px] text-muted-foreground">
        <Spinner className="size-4" />
        {t("gitHistory.loadingFiles")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/45 px-3 py-2">
        <span className="shrink-0 rounded bg-muted/65 px-1.5 py-0.5 font-mono text-[10.5px] leading-none tabular-nums text-muted-foreground">
          {shortSha}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold leading-snug text-foreground">
          {subject || t("gitHistory.noSubject")}
        </span>
        <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/85">
          {t("gitHistory.filesChangedCount", { count: files.length })}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {files.length === 0 ? (
          <div className="grid h-full place-items-center text-[12px] text-muted-foreground">
            {t("gitHistory.noFileChanges")}
          </div>
        ) : (
          <UnifiedDiffView
            files={models}
            totals={totals}
            truncated={anyTruncated}
            initialExpansion="all"
            fill
          />
        )}
      </div>
    </div>
  );
}
