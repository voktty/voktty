import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader } from "../chrome/icons";
import {
  gitDiffIndex,
  gitDiscardFile,
  gitFileDiff,
  gitStageContents,
  gitStageFile,
  notifyGitChanged,
  subscribeGitChanged,
  type GitChangedFile,
} from "../lib/fs";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import { stageChunkText } from "./editorGit";
import {
  UnifiedDiffView,
  type UnifiedDiffFileModel,
} from "./UnifiedDiffView";

type Props = {
  cwd: string;
  focusPath?: string;
};

type LoadedDiff = {
  file: GitChangedFile;
  binary: boolean;
  tooLarge: boolean;
  original: string;
  current: string;
};

export function WorkingTreeDiff({ cwd, focusPath }: Props) {
  const [files, setFiles] = useState<GitChangedFile[] | null>(null);
  const [diffs, setDiffs] = useState<Map<string, LoadedDiff>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [totals, setTotals] = useState({ additions: 0, deletions: 0 });

  useEffect(() => {
    if (!cwd || cwd === "~") {
      setFiles([]);
      setDiffs(new Map());
      return;
    }

    let disposed = false;
    let generation = 0;

    const run = () => {
      const current = ++generation;
      void gitDiffIndex(cwd)
        .then(async (index) => {
          if (disposed || current !== generation) return;
          setTotals({
            additions: index.additions,
            deletions: index.deletions,
          });
          setFiles(index.files);
          setError(null);
          const entries = await Promise.all(
            index.files.map(async (file) => {
              try {
                const diff = await gitFileDiff(cwd, file.relative);
                return [
                  file.relative,
                  {
                    file,
                    binary: diff.binary,
                    tooLarge: diff.tooLarge,
                    original: diff.original,
                    current: diff.current,
                  } satisfies LoadedDiff,
                ] as const;
              } catch {
                return [
                  file.relative,
                  {
                    file,
                    binary: false,
                    tooLarge: false,
                    original: "",
                    current: "",
                  } satisfies LoadedDiff,
                ] as const;
              }
            }),
          );
          if (disposed || current !== generation) return;
          setDiffs(new Map(entries));
        })
        .catch((caught: unknown) => {
          if (disposed || current !== generation) return;
          setError(caught instanceof Error ? caught.message : String(caught));
          setFiles([]);
        });
    };

    run();
    const unsub = subscribeGitChanged(run);
    const onFocus = () => {
      if (!document.hidden) run();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      unsub();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [cwd]);

  const models = useMemo<UnifiedDiffFileModel[]>(() => {
    if (!files) return [];
    return files.map((file) => {
      const loaded = diffs.get(file.relative);
      const unified =
        loaded && !loaded.binary && !loaded.tooLarge
          ? buildUnifiedFile(loaded.original, loaded.current)
          : null;
      const unchanged =
        unified != null &&
        unified.additions === 0 &&
        unified.deletions === 0 &&
        !loaded?.binary;
      return {
        id: file.relative,
        path: file.path,
        label: file.relative,
        binary: loaded?.binary,
        tooLarge: loaded?.tooLarge,
        emptyMessage: unchanged
          ? file.staged
            ? "Staged — no unstaged changes"
            : "No unstaged changes"
          : loaded == null
            ? "Loading…"
            : undefined,
        additions: unified?.additions ?? file.additions,
        deletions: unified?.deletions ?? file.deletions,
        blocks: unchanged ? [] : (unified?.blocks ?? []),
        canStage: file.unstaged,
        canDiscard: file.unstaged,
        canStageHunk: file.unstaged && !loaded?.binary && !loaded?.tooLarge,
      };
    });
  }, [diffs, files]);

  const onStageFile = async (id: string) => {
    setBusyId(id);
    try {
      await gitStageFile(cwd, id);
      notifyGitChanged();
    } finally {
      setBusyId(null);
    }
  };

  const onDiscardFile = async (id: string) => {
    setBusyId(id);
    try {
      await gitDiscardFile(cwd, id);
      notifyGitChanged();
    } finally {
      setBusyId(null);
    }
  };

  const onStageHunk = async (id: string, pos: number) => {
    const loaded = diffs.get(id);
    if (!loaded) return;
    const next = stageChunkText(loaded.original, loaded.current, pos);
    if (next == null) return;
    setBusyId(id);
    try {
      await gitStageContents(cwd, id, next);
      notifyGitChanged();
    } finally {
      setBusyId(null);
    }
  };

  if (!cwd || cwd === "~") {
    return (
      <p className="grid h-full place-items-center text-[13px] text-content/45">
        No project folder
      </p>
    );
  }
  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <AlertCircle className="mx-auto mb-3 size-5 text-red-400" />
        <p className="text-[13px] text-content">Couldn’t load changes</p>
        <p className="mt-1 text-[12px] text-content/50">{error}</p>
      </div>
    );
  }
  if (files == null) {
    return (
      <div className="grid h-full place-items-center text-content/40">
        <Loader className="size-4 animate-spin" strokeWidth={1.75} />
      </div>
    );
  }

  return (
    <UnifiedDiffView
      files={models}
      focusPath={focusPath}
      busyId={busyId}
      totals={totals}
      onStageFile={onStageFile}
      onDiscardFile={onDiscardFile}
      onStageHunk={onStageHunk}
    />
  );
}
