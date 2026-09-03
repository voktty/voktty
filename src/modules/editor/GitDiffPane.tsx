import { toast } from "sonner";
import { native } from "@/modules/ai/lib/native";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  GitReviewQueue,
  type GitReviewQueueConfig,
} from "@/modules/source-control/GitReviewQueue";
import {
  EMPTY_COMMENTS,
  fileKey,
  ReviewCommentDialog,
  sessionKey,
  useGitReviewStore,
} from "@/modules/git-review";
import { CheckmarkCircle02Icon, Comment01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { WorkspaceEnv } from "@/modules/workspace";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  commitDiffKey,
  fetchCommitDiff,
  fetchWorkingDiff,
  getCachedDiff,
  workingDiffKey,
} from "./lib/diffCache";
import {
  buildSharedExtensions,
  DEFAULT_INDENT,
  languageCompartment,
} from "./lib/extensions";
import { resolveLanguage, resolveLanguageSync } from "./lib/languageResolver";
import { useEditorThemeExt } from "./lib/useEditorThemeExt";

type WorkingSource = {
  kind: "working";
  repoRoot: string;
  path: string;
  mode: "-" | "+";
  originalPath: string | null;
  workspaceEnv?: WorkspaceEnv;
};

type CommitSource = {
  kind: "commit";
  repoRoot: string;
  sha: string;
  path: string;
  originalPath: string | null;
  workspaceEnv?: WorkspaceEnv;
};

type Props = {
  source: WorkingSource | CommitSource;
  chipLabel?: string;
  active: boolean;
  review?: GitReviewQueueConfig;
};

const LARGE_FILE_THRESHOLD = 256 * 1024;

const SHARED_EXT = buildSharedExtensions();
const READONLY_EXT = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];
const BASIC_SETUP = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  searchKeymap: true,
};
const DIFF_THEME = EditorView.theme({
  "&.cm-merge-b .cm-changedText, .cm-changedText": {
    background: "rgba(110, 200, 120, 0.20) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  ".cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText": {
    background: "rgba(220, 90, 90, 0.22) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  "&.cm-merge-b .cm-changedLine, .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: "rgba(110, 200, 120, 0.05) !important",
  },
  ".cm-deletedChunk": {
    backgroundColor: "rgba(220, 90, 90, 0.05) !important",
    paddingTop: "1px",
    paddingBottom: "1px",
  },
  "&.cm-merge-b .cm-changedLineGutter, .cm-changedLineGutter": {
    background: "rgba(110, 200, 120, 0.55) !important",
  },
  ".cm-deletedLineGutter, &.cm-merge-a .cm-changedLineGutter": {
    background: "rgba(220, 90, 90, 0.5) !important",
  },
  ".cm-changeGutter": {
    width: "2px !important",
    paddingLeft: "0 !important",
  },
  ".cm-collapsedLines": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground, #9ca3af)",
    fontSize: "10.5px",
    padding: "2px 8px",
    opacity: 0.7,
  },
});

function countDiffLines(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (let i = 0; i < patch.length; i++) {
    if (i > 0 && patch.charCodeAt(i - 1) !== 10) continue;
    const c = patch.charCodeAt(i);
    if (c === 43 && patch.charCodeAt(i + 1) !== 43) added++;
    else if (c === 45 && patch.charCodeAt(i + 1) !== 45) removed++;
  }
  if (patch.length > 0 && patch.charCodeAt(0) === 43) added++;
  else if (patch.length > 0 && patch.charCodeAt(0) === 45) removed++;
  return { added, removed };
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "loaded";
      originalContent: string;
      modifiedContent: string;
      isBinary: boolean;
      fallbackPatch: string;
    }
  | { kind: "error"; message: string };

export function normalizeGitRelativePath(
  repoRoot: string,
  filePath: string,
): string {
  if (!filePath) return "";
  const normRepo = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normFile = filePath.replace(/\\/g, "/");

  // Exact match first (POSIX: Linux / macOS / Android / Windows)
  if (normFile === normRepo) return "";
  if (normFile.startsWith(normRepo + "/")) {
    return normFile.slice(normRepo.length + 1);
  }

  // Case-insensitive fallback (Windows / macOS case-insensitive filesystems)
  const normRepoLower = normRepo.toLowerCase();
  const normFileLower = normFile.toLowerCase();
  if (normFileLower === normRepoLower) return "";
  if (normFileLower.startsWith(normRepoLower + "/")) {
    return normFile.slice(normRepo.length + 1);
  }

  return normFile.replace(/^[\\/]+/, "");
}

function cacheKey(source: WorkingSource | CommitSource): string {
  const relPath = normalizeGitRelativePath(source.repoRoot, source.path);
  return source.kind === "working"
    ? workingDiffKey(source.repoRoot, relPath, source.mode)
    : commitDiffKey(source.repoRoot, source.sha, relPath);
}

function loadStateFromCache(source: WorkingSource | CommitSource): LoadState {
  const hit = getCachedDiff(cacheKey(source));
  if (!hit) return { kind: "idle" };
  return {
    kind: "loaded",
    originalContent: hit.originalContent,
    modifiedContent: hit.modifiedContent,
    isBinary: hit.isBinary,
    fallbackPatch: hit.fallbackPatch,
  };
}

export function GitDiffPane({ source, chipLabel, active, review }: Props) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const themeExt = useEditorThemeExt();
  const { t } = useTranslation();
  const [reloadKey, setReloadKey] = useState(0);
  const [authorizing, setAuthorizing] = useState(false);

  const relPath = useMemo(
    () => normalizeGitRelativePath(source.repoRoot, source.path),
    [source.repoRoot, source.path],
  );
  const relOriginalPath = useMemo(
    () =>
      source.originalPath
        ? normalizeGitRelativePath(source.repoRoot, source.originalPath)
        : null,
    [source.repoRoot, source.originalPath],
  );

  const [state, setState] = useState<LoadState>(() =>
    active ? loadStateFromCache(source) : { kind: "idle" },
  );

  const [langExt, setLangExt] = useState<Extension | null>(
    () => resolveLanguageSync(source.path)?.ext ?? null,
  );

  useEffect(() => {
    let cancelled = false;
    resolveLanguage(source.path)
      .then((res) => {
        if (!cancelled && res?.ext) {
          setLangExt(res.ext);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [source.path]);

  const sourceKind = source.kind;
  const sourceRepoRoot = source.repoRoot;
  const sourceMode = source.kind === "working" ? source.mode : undefined;
  const sourceSha = source.kind === "commit" ? source.sha : undefined;
  const sourceEnvKey = source.workspaceEnv
    ? JSON.stringify(source.workspaceEnv)
    : "";
  const cKey = cacheKey(source);

  useEffect(() => {
    if (!active) return;
    const cached = loadStateFromCache(source);
    if (cached.kind === "loaded") {
      setState((prev) => {
        if (
          prev.kind === "loaded" &&
          prev.originalContent === cached.originalContent &&
          prev.modifiedContent === cached.modifiedContent &&
          prev.isBinary === cached.isBinary &&
          prev.fallbackPatch === cached.fallbackPatch
        ) {
          return prev;
        }
        return cached;
      });
      return;
    }

    let cancelled = false;
    setState((prev) => (prev.kind === "loading" ? prev : { kind: "loading" }));
    const promise =
      sourceKind === "working"
        ? fetchWorkingDiff(
            sourceRepoRoot,
            relPath,
            sourceMode!,
            relOriginalPath,
            source.workspaceEnv,
          )
        : fetchCommitDiff(
            sourceRepoRoot,
            sourceSha!,
            relPath,
            relOriginalPath,
            source.workspaceEnv,
          );

    promise
      .then((res) => {
        if (cancelled) return;
        setState({
          kind: "loaded",
          originalContent: res.originalContent,
          modifiedContent: res.modifiedContent,
          isBinary: res.isBinary,
          fallbackPatch: res.fallbackPatch,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    active,
    cKey,
    sourceKind,
    sourceRepoRoot,
    relPath,
    sourceMode,
    sourceSha,
    relOriginalPath,
    sourceEnvKey,
    reloadKey,
  ]);

  const handleAuthorize = async () => {
    setAuthorizing(true);
    try {
      await native.workspaceAuthorize(source.repoRoot);
      toast.success(
        t("git.authorizedSuccess", { defaultValue: "Directorio autorizado" }),
      );
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAuthorizing(false);
    }
  };

  const path = relPath || source.path;
  const repoRoot = source.repoRoot;
  const mode = source.kind === "working" ? source.mode : "+";
  const loaded = state.kind === "loaded" ? state : null;
  const originalContent = loaded?.originalContent ?? "";
  const modifiedContent = loaded?.modifiedContent ?? "";
  const isBinary = loaded?.isBinary ?? false;
  const fallbackPatch = loaded?.fallbackPatch ?? "";

  const fKey = fileKey(repoRoot, "worktree", path);
  const sKey = sessionKey(repoRoot, "worktree");
  const reconciliation = useGitReviewStore((s) => s.reconciliations[fKey]);
  const overview = useGitReviewStore((s) => s.overviews[sKey]);
  const customViewMode = useGitReviewStore((s) => s.viewModes[fKey]);
  const viewMode =
    customViewMode ??
    (reconciliation?.changedSinceReview && reconciliation.reviewedBaseline
      ? "unreviewed"
      : "full");
  const setViewMode = useGitReviewStore((s) => s.setViewMode);
  const markFile = useGitReviewStore((s) => s.markFile);
  const comments = useGitReviewStore(
    (s) => s.comments[sKey] ?? (EMPTY_COMMENTS as unknown as typeof s.comments[string]),
  );
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);

  const fileComments = useMemo(
    () => comments.filter((c) => c.path === path || c.path === source.path),
    [comments, path, source.path],
  );

  const fileReview = overview?.files.find(
    (f) => f.path === path || f.path === source.path,
  );
  const isReviewed = fileReview?.reviewed ?? false;

  const reconciledRef = useRef<string>("");
  useEffect(() => {
    if (active && sourceKind === "working" && state.kind === "loaded") {
      const recKey = `${repoRoot}:${path}:${originalContent.length}:${modifiedContent.length}`;
      if (reconciledRef.current === recKey) return;
      reconciledRef.current = recKey;
      void useGitReviewStore
        .getState()
        .reconcileFile(
          repoRoot,
          "worktree",
          path,
          originalContent,
          modifiedContent,
        );
    }
  }, [
    active,
    state.kind,
    modifiedContent.length,
    originalContent.length,
    path,
    repoRoot,
    sourceKind,
  ]);

  const hasReviewedBaseline = Boolean(
    reconciliation?.changedSinceReview &&
      reconciliation.reviewedBaseline &&
      reconciliation.reviewedBaseline !== originalContent,
  );

  const effectiveOriginal =
    viewMode === "unreviewed" && hasReviewedBaseline
      ? reconciliation!.reviewedBaseline!
      : originalContent;

  const handleToggleReview = useCallback(async () => {
    if (source.kind !== "working" || !loaded) return;
    await markFile(
      repoRoot,
      "worktree",
      path,
      modifiedContent,
      !isReviewed,
    );
  }, [isReviewed, loaded, markFile, modifiedContent, path, repoRoot, source.kind]);

  const isTooLarge =
    originalContent.length > LARGE_FILE_THRESHOLD ||
    modifiedContent.length > LARGE_FILE_THRESHOLD;
  const useFallback = isBinary || isTooLarge;

  const extensions = useMemo(
    () => [
      ...SHARED_EXT,
      DEFAULT_INDENT,
      languageCompartment.of(langExt ?? []),
      ...READONLY_EXT,
      unifiedMergeView({
        original: effectiveOriginal,
        mergeControls: false,
        highlightChanges: true,
        gutter: true,
        syntaxHighlightDeletions: true,
        collapseUnchanged: { margin: 3, minSize: 6 },
      }),
      DIFF_THEME,
    ],
    [effectiveOriginal, langExt],
  );

  const stats = useMemo(
    () =>
      useFallback ? countDiffLines(fallbackPatch) : { added: 0, removed: 0 },
    [useFallback, fallbackPatch],
  );

  return (
    <div dir="ltr" className="flex h-full min-h-0 flex-col bg-background text-left">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wide"
          >
            {chipLabel ?? mode}
          </Badge>
          {isBinary ? (
            <Badge variant="secondary" className="text-[10px]">
              {t("git.diffBinaryFallback")}
            </Badge>
          ) : isTooLarge ? (
            <Badge variant="secondary" className="text-[10px]">
              {t("git.diffLargeFile")}
            </Badge>
          ) : null}
          <span
            className="truncate font-mono text-[11px] text-muted-foreground"
            title={path}
          >
            {path}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10.5px] tabular-nums text-muted-foreground">
          {hasReviewedBaseline ? (
            <div className="flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() =>
                  setViewMode(repoRoot, "worktree", path, "unreviewed")
                }
                className={cn(
                  "rounded px-2 py-0.5 font-medium transition-colors",
                  viewMode === "unreviewed"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t("git.unreviewedDelta")}
              </button>
              <button
                type="button"
                onClick={() =>
                  setViewMode(repoRoot, "worktree", path, "full")
                }
                className={cn(
                  "rounded px-2 py-0.5 font-medium transition-colors",
                  viewMode === "full"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t("git.fullDiff")}
              </button>
            </div>
          ) : null}

          {source.kind === "working" && !useFallback ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 gap-1.5 px-2 text-[10.5px]"
                onClick={() => setCommentDialogOpen(true)}
              >
                <HugeiconsIcon icon={Comment01Icon} size={13} className="text-amber-500" />
                <span>{t("git.addComment")}</span>
                {fileComments.length > 0 ? (
                  <span className="rounded bg-amber-500/20 px-1 py-0.2 font-mono text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                    {fileComments.length}
                  </span>
                ) : null}
              </Button>

              <Button
                type="button"
                size="sm"
                variant={isReviewed ? "outline" : "secondary"}
                className="h-7 gap-1.5 px-2 text-[10.5px]"
                onClick={() => void handleToggleReview()}
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  size={13}
                  className={isReviewed ? "text-emerald-500" : ""}
                />
                <span>
                  {isReviewed ? t("git.reviewed") : t("git.markReviewed")}
                </span>
                <kbd className="hidden sm:inline-block rounded border border-border/60 bg-muted/50 px-1 py-0.2 font-mono text-[9px] text-muted-foreground">
                  R
                </kbd>
              </Button>
            </>
          ) : null}

          <span className="truncate max-w-80 font-mono hidden md:inline-block">
            {repoRoot}
          </span>
          {useFallback ? (
            <>
              <span className="text-emerald-600 dark:text-emerald-400">
                +{stats.added}
              </span>
              <span className="text-rose-600 dark:text-rose-400">
                −{stats.removed}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden">
          {state.kind === "loading" || state.kind === "idle" ? (
            <div className="flex h-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <Spinner className="size-3" />
              {t("common.loading")}
            </div>
          ) : state.kind === "error" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="max-w-md text-[11.5px] text-destructive">
                {state.message}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleAuthorize()}
                  disabled={authorizing}
                  className="h-7 text-[11px]"
                >
                  {authorizing ? <Spinner className="mr-1.5 size-3" /> : null}
                  {t("git.authorizeDirectory", {
                    defaultValue: "Autorizar Directorio",
                  })}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="h-7 text-[11px]"
                >
                  {t("common.retry", { defaultValue: "Reintentar" })}
                </Button>
              </div>
            </div>
          ) : useFallback ? (
            <ScrollArea className="h-full">
              <pre className="min-h-full whitespace-pre-wrap wrap-break-word p-4 font-mono text-[12px] leading-relaxed text-muted-foreground">
                {fallbackPatch || t("git.diffUnavailable")}
              </pre>
            </ScrollArea>
          ) : (
            <CodeMirror
              ref={cmRef}
              value={modifiedContent}
              theme={themeExt}
              extensions={extensions}
              editable={false}
              height="100%"
              className="h-full"
              basicSetup={BASIC_SETUP}
            />
          )}
        </div>
        {source.kind === "working" && review ? (
          <GitReviewQueue
            currentPath={path}
            repoRoot={source.repoRoot}
            {...review}
          />
        ) : null}
      </div>

      <ReviewCommentDialog
        open={commentDialogOpen}
        onOpenChange={setCommentDialogOpen}
        repoRoot={repoRoot}
        target="worktree"
        path={path}
        line={1}
        side="new"
        content={modifiedContent}
      />
    </div>
  );
}

