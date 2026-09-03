import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { invalidateDiff, workingDiffKey } from "@/modules/editor/lib/diffCache";
import { useTranslation } from "@/modules/i18n";
import {
  GitCompareIcon,
  Refresh01Icon,
  RemoveSquareIcon,
  Tick02Icon,
  CheckmarkCircle02Icon,
  SparklesIcon,
  BotIcon,
  Comment01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { fetchWorkingDiff } from "@/modules/editor/lib/diffCache";
import {
  ReviewHandoffDialog,
  sessionKey,
  useGitReviewStore,
} from "@/modules/git-review";
import { GitWalkthroughDialog } from "@/modules/git-review/components/GitWalkthroughDialog";

import {
  buildGitReviewEntries,
  type GitReviewEntry,
  isGitReviewEntryDirty,
  reconcileGitReviewPath,
  sameGitReviewRepository,
} from "./lib/reviewQueue";
import type { SourceControlSummary } from "./useSourceControl";

type OpenDiffInput = {
  path: string;
  repoRoot: string;
  mode: "+" | "-";
  originalPath: string | null;
  title?: string;
};

export type GitReviewQueueConfig = {
  sourceControl: SourceControlSummary;
  dirtyPaths: readonly string[];
  onOpenDiff: (input: OpenDiffInput) => void;
};

type Props = GitReviewQueueConfig & {
  currentPath: string;
  repoRoot: string;
};

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function openEntry(
  repoRoot: string,
  entry: GitReviewEntry,
  onOpenDiff: (input: OpenDiffInput) => void,
) {
  onOpenDiff({
    path: entry.path,
    repoRoot,
    mode: entry.unstaged ? "-" : "+",
    originalPath: entry.originalPath,
  });
}

export function GitReviewQueue({
  currentPath,
  repoRoot,
  sourceControl,
  dirtyPaths,
  onOpenDiff,
}: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<GitReviewEntry | null>(
    null,
  );
  const matchesRepository = sourceControl.status
    ? sameGitReviewRepository(sourceControl.status.repoRoot, repoRoot)
    : false;
  const entries = useMemo(
    () =>
      matchesRepository
        ? buildGitReviewEntries(sourceControl.status?.changedFiles ?? [])
        : [],
    [matchesRepository, sourceControl.status],
  );
  const selected =
    entries.find(
      (entry) =>
        entry.path === currentPath ||
        entry.path.replace(/\\/g, "/") === currentPath.replace(/\\/g, "/"),
    ) ?? null;

  const invalidateEntry = useCallback(
    (entry: GitReviewEntry) => {
      invalidateDiff(workingDiffKey(repoRoot, entry.path, "+"));
      invalidateDiff(workingDiffKey(repoRoot, entry.path, "-"));
    },
    [repoRoot],
  );

  const toggleStage = useCallback(
    async (entry: GitReviewEntry) => {
      if (busy) return;
      const nextMode: "+" | "-" = entry.unstaged ? "+" : "-";
      setBusy(`stage:${entry.path}`);
      invalidateEntry(entry);
      try {
        if (entry.unstaged) {
          await native.gitStage(repoRoot, [entry.path]);
        } else {
          await native.gitUnstage(repoRoot, [entry.path]);
        }
        await sourceControl.refresh({ remote: "never" });
        onOpenDiff({
          path: entry.path,
          repoRoot,
          mode: nextMode,
          originalPath: entry.originalPath,
        });
      } catch (error) {
        toast.error(errorMessage(error));
        await sourceControl.refresh({ remote: "never" }).catch(() => {});
      } finally {
        setBusy(null);
      }
    },
    [busy, invalidateEntry, onOpenDiff, repoRoot, sourceControl],
  );

  const requestDiscard = useCallback(
    (entry: GitReviewEntry) => {
      if (busy || !entry.unstaged) return;
      if (isGitReviewEntryDirty(repoRoot, entry, dirtyPaths)) {
        toast.error(`${t("explorer.unsavedChanges")}: ${entry.path}`);
        return;
      }
      setPendingDiscard(entry);
    },
    [busy, dirtyPaths, repoRoot, t],
  );

  const confirmDiscard = useCallback(async () => {
    const entry = pendingDiscard;
    setPendingDiscard(null);
    if (!entry || busy) return;
    if (isGitReviewEntryDirty(repoRoot, entry, dirtyPaths)) {
      toast.error(`${t("explorer.unsavedChanges")}: ${entry.path}`);
      return;
    }
    const remaining = entries.filter(
      (candidate) => candidate.path !== entry.path,
    );
    setBusy(`discard:${entry.path}`);
    invalidateEntry(entry);
    try {
      await native.gitDiscard(repoRoot, [
        { path: entry.path, untracked: entry.untracked },
      ]);
      await sourceControl.refresh({ remote: "never" });
      const nextPath = reconcileGitReviewPath(remaining, currentPath);
      const next = remaining.find((candidate) => candidate.path === nextPath);
      if (next) openEntry(repoRoot, next, onOpenDiff);
    } catch (error) {
      toast.error(errorMessage(error));
      await sourceControl.refresh({ remote: "never" }).catch(() => {});
    } finally {
      setBusy(null);
    }
  }, [
    busy,
    currentPath,
    dirtyPaths,
    entries,
    invalidateEntry,
    onOpenDiff,
    pendingDiscard,
    repoRoot,
    sourceControl,
    t,
  ]);

  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"files" | "comments">("files");

  const sKey = sessionKey(repoRoot, "worktree");
  const overview = useGitReviewStore((state) => state.overviews[sKey]);
  const comments = useGitReviewStore((state) => state.comments[sKey] ?? []);
  const loadOverview = useGitReviewStore((state) => state.loadOverview);
  const loadComments = useGitReviewStore((state) => state.loadComments);
  const markFile = useGitReviewStore((state) => state.markFile);
  const deleteComment = useGitReviewStore((state) => state.deleteComment);

  useEffect(() => {
    if (matchesRepository && repoRoot) {
      void loadOverview(repoRoot, "worktree");
      void loadComments(repoRoot, "worktree");
    }
  }, [loadComments, loadOverview, matchesRepository, repoRoot]);

  const selectedReview = selected
    ? overview?.files.find((f) => f.path === selected.path)
    : null;
  const isSelectedReviewed = selectedReview?.reviewed ?? false;

  const toggleReview = useCallback(
    async (entry: GitReviewEntry) => {
      if (busy) return;
      const fileReview = overview?.files.find((f) => f.path === entry.path);
      const currentlyReviewed = fileReview?.reviewed ?? false;
      setBusy(`review:${entry.path}`);
      try {
        const diffData = await fetchWorkingDiff(
          repoRoot,
          entry.path,
          entry.unstaged ? "-" : "+",
          entry.originalPath,
        );
        await markFile(
          repoRoot,
          "worktree",
          entry.path,
          diffData.modifiedContent,
          !currentlyReviewed,
        );
        if (!currentlyReviewed) {
          // Advance to next unreviewed file
          const currentIndex = entries.findIndex((e) => e.path === entry.path);
          const next =
            entries.slice(currentIndex + 1).find((e) => {
              const rev = overview?.files.find((f) => f.path === e.path);
              return !rev?.reviewed;
            }) ??
            entries.find((e) => {
              const rev = overview?.files.find((f) => f.path === e.path);
              return !rev?.reviewed && e.path !== entry.path;
            });
          if (next) {
            openEntry(repoRoot, next, onOpenDiff);
          }
        }
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [busy, entries, markFile, onOpenDiff, overview, repoRoot],
  );

  // Global review shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }
      if (busy) return;

      if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setHandoffOpen(true);
        return;
      }

      if (e.key === "c" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setActiveTab((prev) => (prev === "files" ? "comments" : "files"));
        return;
      }

      if (!selected) return;

      if ((e.key === "r" || e.key === "v") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        void toggleReview(selected);
      } else if ((e.key === "j" || e.key === "ArrowDown") && !e.ctrlKey && !e.metaKey) {
        const currentIndex = entries.findIndex((item) => item.path === currentPath);
        if (currentIndex < entries.length - 1) {
          e.preventDefault();
          openEntry(repoRoot, entries[currentIndex + 1], onOpenDiff);
        }
      } else if ((e.key === "k" || e.key === "ArrowUp") && !e.ctrlKey && !e.metaKey) {
        const currentIndex = entries.findIndex((item) => item.path === currentPath);
        if (currentIndex > 0) {
          e.preventDefault();
          openEntry(repoRoot, entries[currentIndex - 1], onOpenDiff);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, currentPath, entries, onOpenDiff, repoRoot, selected, toggleReview]);

  return (
    <aside className="flex h-full w-64 min-w-52 max-w-[38%] shrink-0 flex-col border-l border-border/60 bg-card/35">
      <header className="flex h-10 shrink-0 items-center justify-between gap-1.5 border-b border-border/50 px-2">
        <div className="flex items-center gap-1 rounded-md bg-muted/40 p-0.5 text-[10.5px]">
          <button
            type="button"
            onClick={() => setActiveTab("files")}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors",
              activeTab === "files"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={GitCompareIcon} size={12} strokeWidth={1.9} />
            <span>{t("git.changedFiles")}</span>
            <span className="ml-0.5 text-[9.5px] tabular-nums opacity-75">
              ({entries.length})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("comments")}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors",
              activeTab === "comments"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <HugeiconsIcon
              icon={Comment01Icon}
              size={12}
              strokeWidth={1.9}
              className={comments.length > 0 ? "text-amber-500" : ""}
            />
            <span>{t("git.reviewComments")}</span>
            {comments.length > 0 ? (
              <span className="ml-0.5 text-[9.5px] font-semibold text-amber-500 tabular-nums">
                ({comments.length})
              </span>
            ) : null}
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            disabled={sourceControl.isLoading || !!busy || entries.length === 0}
            aria-label={t("git.walkthrough")}
            title={t("git.generateWalkthrough")}
            onClick={() => setWalkthroughOpen(true)}
          >
            <HugeiconsIcon icon={SparklesIcon} size={13} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            disabled={sourceControl.isLoading || !!busy}
            aria-label={t("git.refreshSourceControl")}
            title={t("git.refreshSourceControl")}
            onClick={() => {
              void sourceControl.refresh({ remote: "never" });
              void loadComments(repoRoot, "worktree");
            }}
          >
            {sourceControl.isLoading ? (
              <Spinner className="size-3" />
            ) : (
              <HugeiconsIcon icon={Refresh01Icon} size={13} strokeWidth={1.9} />
            )}
          </button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        {activeTab === "files" ? (
          <div
            className="space-y-0.5 p-1.5"
            role="listbox"
            aria-label={t("git.changedFiles")}
          >
            {entries.map((entry) => {
              const active = entry.path === currentPath;
              const entryBusy = busy?.endsWith(`:${entry.path}`) ?? false;
              const fileReview = overview?.files.find((f) => f.path === entry.path);
              const isReviewed = fileReview?.reviewed ?? false;
              const fileComments = comments.filter((c) => c.path === entry.path);

              return (
                <button
                  key={entry.key}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => openEntry(repoRoot, entry, onOpenDiff)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
                    active
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted/65 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded font-mono text-[9px] font-semibold",
                      entry.statusCode === "D"
                        ? "bg-rose-500/12 text-rose-500"
                        : entry.statusCode === "A" || entry.statusCode === "U"
                          ? "bg-emerald-500/12 text-emerald-500"
                          : "bg-amber-500/12 text-amber-500",
                    )}
                  >
                    {entryBusy ? (
                      <Spinner className="size-2.5" />
                    ) : (
                      entry.statusCode
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-1">
                      <span
                        className="block truncate font-mono text-[10.5px]"
                        title={entry.path}
                      >
                        {entry.path}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {fileComments.length > 0 ? (
                          <span
                            className="inline-flex items-center gap-0.5 rounded px-1 py-0.2 bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono text-[9px]"
                            title={`${fileComments.length} ${t("git.commentsCount")}`}
                          >
                            <HugeiconsIcon icon={Comment01Icon} size={9} />
                            {fileComments.length}
                          </span>
                        ) : null}
                        {isReviewed ? (
                          <HugeiconsIcon
                            icon={CheckmarkCircle02Icon}
                            size={12}
                            className="text-emerald-500"
                          />
                        ) : null}
                      </div>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[9.5px] opacity-70">
                      <span className="truncate">{entry.statusLabel}</span>
                      {entry.staged ? <span>{t("git.stagedChanges")}</span> : null}
                      {isReviewed ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          • {t("git.reviewed")}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })}
            {!sourceControl.isLoading && entries.length === 0 ? (
              <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">
                {t("git.noUnstagedChanges")}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1.5 p-2">
            {comments.map((comment) => {
              const lineText =
                comment.endLine && comment.endLine > comment.line
                  ? `${comment.line}-${comment.endLine}`
                  : `${comment.line}`;

              return (
                <div
                  key={comment.id}
                  className="group relative rounded-md border border-border/60 bg-muted/20 p-2 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between gap-1 text-[10px]">
                    <button
                      type="button"
                      onClick={() => {
                        const targetEntry = entries.find((e) => e.path === comment.path);
                        if (targetEntry) openEntry(repoRoot, targetEntry, onOpenDiff);
                      }}
                      className="font-mono text-foreground font-medium hover:underline truncate"
                      title={comment.path}
                    >
                      {comment.path}:{lineText}
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className="px-1 py-0 text-[8.5px]">
                        {comment.side === "new" ? t("git.addedModified") : t("git.original")}
                      </Badge>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await deleteComment(repoRoot, "worktree", comment.id);
                          toast.success(t("git.commentDeleted"));
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-destructive transition-opacity"
                        title={t("git.deleteComment")}
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={12} />
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap line-clamp-3">
                    {comment.comment}
                  </p>
                </div>
              );
            })}
            {comments.length === 0 ? (
              <div className="px-3 py-8 text-center text-[11px] text-muted-foreground space-y-1">
                <HugeiconsIcon icon={Comment01Icon} size={20} className="mx-auto text-muted-foreground/50 mb-2" />
                <p>{t("git.noReviewCommentsYet")}</p>
                <p className="text-[10px] opacity-75">{t("git.addCommentsFromDiffHint")}</p>
              </div>
            ) : null}
          </div>
        )}
      </ScrollArea>

      <div className="flex flex-col gap-1.5 border-t border-border/50 p-2 shrink-0 bg-background/50">
        <Button
          type="button"
          size="sm"
          variant="default"
          className="h-7 w-full gap-1.5 px-2 text-[10.5px] bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => setHandoffOpen(true)}
        >
          <HugeiconsIcon icon={BotIcon} size={13} strokeWidth={1.9} />
          <span className="truncate">{t("git.sendToAgent")}</span>
          <kbd className="ml-auto hidden rounded border border-primary-foreground/20 bg-primary-foreground/10 px-1 py-0.2 font-mono text-[9px] sm:inline-block">
            P
          </kbd>
        </Button>

        {selected && activeTab === "files" ? (
          <>
            <Button
              type="button"
              size="sm"
              variant={isSelectedReviewed ? "outline" : "secondary"}
              className="h-7 w-full gap-1.5 px-2 text-[10.5px]"
              disabled={!!busy}
              onClick={() => void toggleReview(selected)}
            >
              {busy === `review:${selected.path}` ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  size={13}
                  className={isSelectedReviewed ? "text-emerald-500" : ""}
                />
              )}
              <span className="truncate">
                {isSelectedReviewed ? t("git.markUnreviewed") : t("git.markReviewed")}
              </span>
              <kbd className="ml-auto hidden rounded border border-border/60 bg-muted/50 px-1 py-0.2 font-mono text-[9px] text-muted-foreground sm:inline-block">
                R
              </kbd>
            </Button>

            <div className="grid grid-cols-2 gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 min-w-0 gap-1.5 px-2 text-[10.5px]"
                disabled={!!busy}
                onClick={() => void toggleStage(selected)}
              >
                {busy === `stage:${selected.path}` ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2} />
                )}
                <span className="truncate">
                  {selected.unstaged ? t("git.stage") : t("git.unstage")}
                </span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 min-w-0 gap-1.5 px-2 text-[10.5px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={!!busy || !selected.unstaged}
                onClick={() => requestDiscard(selected)}
              >
                <HugeiconsIcon
                  icon={RemoveSquareIcon}
                  size={13}
                  strokeWidth={1.9}
                />
                <span className="truncate">{t("git.discard")}</span>
              </Button>
            </div>
          </>
        ) : null}
      </div>

      <AlertDialog
        open={pendingDiscard !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDiscard(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("git.discard")}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDiscard
                ? t("git.discardOneDescription", { label: pendingDiscard.path })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDiscard()}>
              {t("git.discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GitWalkthroughDialog
        open={walkthroughOpen}
        onOpenChange={setWalkthroughOpen}
        repoRoot={repoRoot}
        changedFiles={entries.map((e) => e.path)}
        onNavigateReference={(path) => {
          const entry = entries.find((e) => e.path === path);
          if (entry) {
            openEntry(repoRoot, entry, onOpenDiff);
          }
        }}
      />

      <ReviewHandoffDialog
        open={handoffOpen}
        onOpenChange={setHandoffOpen}
        repoRoot={repoRoot}
        target="worktree"
        totalChangedFiles={entries.length}
      />
    </aside>
  );
}

