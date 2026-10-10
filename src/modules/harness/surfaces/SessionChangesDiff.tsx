import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/modules/i18n";
import { AlertCircle, Loader } from "../chrome/icons";
import {
  sessionCheckpointFileDiff,
  sessionCheckpointStatus,
  subscribeReviewChanged,
  type CheckpointFile,
} from "../lib/checkpoint";
import { forEachConcurrent } from "../lib/concurrent";
import type { SessionChangesView } from "../lib/layout";
import type { HarnessId } from "../lib/session";
import type { SessionCommitNotice } from "../lib/sessionCommit";
import { buildUnifiedFile, type UnifiedFileDiff } from "../lib/unifiedDiff";
import { SessionChangesCommit } from "./SessionChangesCommit";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

type Props = {
  cwd: string;
  sessionId: string;
  harness?: HarnessId;
  focusPath?: string;
  initialView?: SessionChangesView;
};

type LoadedDiff = {
  binary: boolean;
  tooLarge: boolean;
  unified: UnifiedFileDiff | null;
  error?: string;
};

const DIFF_LOAD_CONCURRENCY = 4;

/** Read-only review of the exact before/after snapshots owned by one session. */
export function SessionChangesDiff({
  cwd,
  sessionId,
  harness,
  focusPath,
  initialView = "changes",
}: Props) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<CheckpointFile[] | null>(null);
  const [diffs, setDiffs] = useState<Map<string, LoadedDiff>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<SessionChangesView>(initialView);
  const [commitNotice, setCommitNotice] = useState<SessionCommitNotice | null>(
    null,
  );

  useEffect(() => setView(initialView), [initialView]);

  useEffect(() => {
    if (!cwd || cwd === "~" || !sessionId) {
      setFiles([]);
      setDiffs(new Map());
      return;
    }

    let disposed = false;
    let generation = 0;
    const run = () => {
      const current = ++generation;
      setFiles(null);
      setDiffs(new Map());
      void sessionCheckpointStatus(sessionId, cwd)
        .then(async (status) => {
          if (disposed || current !== generation) return;
          setFiles(status.files);
          setError(null);
          if (view === "commit") return;
          await forEachConcurrent(
            prioritizeFile(status.files, focusPath),
            DIFF_LOAD_CONCURRENCY,
            async (file) => {
              let loaded: LoadedDiff;
              try {
                const diff = await sessionCheckpointFileDiff(
                  sessionId,
                  cwd,
                  file.relative,
                );
                loaded = {
                  binary: diff.binary,
                  tooLarge: diff.tooLarge,
                  unified:
                    !diff.binary && !diff.tooLarge
                      ? buildUnifiedFile(diff.original, diff.current)
                      : null,
                };
              } catch (caught: unknown) {
                loaded = {
                  binary: false,
                  tooLarge: false,
                  unified: null,
                  error:
                    caught instanceof Error ? caught.message : String(caught),
                };
              }
              if (disposed || current !== generation) return;
              setDiffs((existing) => {
                const next = new Map(existing);
                next.set(file.relative, loaded);
                return next;
              });
            },
            () => !disposed && current === generation,
          );
        })
        .catch((caught: unknown) => {
          if (disposed || current !== generation) return;
          setError(caught instanceof Error ? caught.message : String(caught));
          setFiles([]);
        });
    };

    run();
    const unsubscribe = subscribeReviewChanged((changedSessionId) => {
      if (!changedSessionId || changedSessionId === sessionId) run();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [cwd, focusPath, sessionId, view]);

  const models = useMemo<UnifiedDiffFileModel[]>(() => {
    if (!files) return [];
    return files.map((file) => {
      const loaded = diffs.get(file.relative);
      const unified = loaded?.unified ?? null;
      return {
        id: file.relative,
        path: file.path,
        label: file.relative,
        binary: loaded?.binary,
        tooLarge: loaded?.tooLarge,
        emptyMessage:
          loaded == null
            ? "Loading…"
            : loaded.error
              ? loaded.error
              : unified != null &&
                  unified.additions === 0 &&
                  unified.deletions === 0 &&
                  !loaded.binary
                ? "No textual diff"
                : undefined,
        additions: unified?.additions ?? file.additions,
        deletions: unified?.deletions ?? file.deletions,
        blocks: unified?.blocks ?? [],
      };
    });
  }, [diffs, files]);

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

  let content: React.ReactNode;
  if (!cwd || cwd === "~") {
    content = (
      <p className="grid h-full place-items-center text-[13px] text-content/45">
        {t("harness.chrome.noProjectFolder")}
      </p>
    );
  } else if (error) {
    content = (
      <div className="grid h-full place-items-center p-6 text-center">
        <AlertCircle className="mx-auto mb-3 size-5 text-red-400" />
        <p className="text-[13px] text-content">
          {t("harness.chrome.couldntLoadSessionChanges")}
        </p>
        <p className="mt-1 text-[12px] text-content/50">{error}</p>
      </div>
    );
  } else if (files == null) {
    content = (
      <div className="grid h-full place-items-center text-content/40">
        <Loader className="size-4 animate-spin" strokeWidth={1.75} />
      </div>
    );
  } else if (view === "commit") {
    content = (
      <SessionChangesCommit
        cwd={cwd}
        sessionId={sessionId}
        harness={harness}
        files={files}
        onNotice={setCommitNotice}
      />
    );
  } else if (files.length === 0) {
    content = (
      <p className="grid h-full place-items-center text-[13px] text-content/45">
        {t("harness.chrome.noSessionChanges")}
      </p>
    );
  } else {
    content = (
      <UnifiedDiffView files={models} focusPath={focusPath} totals={totals} />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <fieldset className="flex h-9 shrink-0 items-center gap-1 border-b border-content/10 px-2 font-sans">
        <legend className="sr-only">
          {t("sessionReview.sessionChangesViews")}
        </legend>
        {(["changes", "commit"] as const).map((nextView) => (
          <button
            key={nextView}
            type="button"
            aria-pressed={view === nextView}
            onClick={() => setView(nextView)}
            className={`h-7 rounded-md px-2.5 text-[11px] font-medium ${
              view === nextView
                ? "bg-content/10 text-content"
                : "text-content/45 hover:bg-content/5 hover:text-content/75"
            }`}
          >
            {t(
              nextView === "changes"
                ? "sessionReview.changesView"
                : "sessionReview.commitView",
            )}
          </button>
        ))}
      </fieldset>
      <div className="flex min-h-0 flex-1 flex-col">
        {view === "commit" && commitNotice ? (
          <p
            role={commitNotice.kind === "success" ? "status" : "alert"}
            className={`shrink-0 px-4 pt-2 text-[12px] ${
              commitNotice.kind === "success"
                ? "text-emerald-300"
                : "text-amber-300"
            }`}
          >
            {commitNotice.message}
          </p>
        ) : null}
        <div className="min-h-0 flex-1">{content}</div>
      </div>
    </div>
  );
}

function prioritizeFile(
  files: readonly CheckpointFile[],
  focusPath: string | undefined,
): CheckpointFile[] {
  if (!focusPath) return [...files];
  const focused = files.find(
    (file) => file.path === focusPath || file.relative === focusPath,
  );
  if (!focused) return [...files];
  return [focused, ...files.filter((file) => file !== focused)];
}
