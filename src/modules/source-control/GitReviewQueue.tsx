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
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
  const selected = entries.find((entry) => entry.path === currentPath) ?? null;

  useEffect(() => {
    if (!matchesRepository || busy || entries.length === 0) {
      return;
    }
    const nextPath = reconcileGitReviewPath(entries, currentPath);
    if (nextPath !== currentPath) {
      const next = entries.find((entry) => entry.path === nextPath);
      if (next) openEntry(repoRoot, next, onOpenDiff);
    }
  }, [busy, currentPath, entries, matchesRepository, onOpenDiff, repoRoot]);

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

  return (
    <aside className="flex h-full w-64 min-w-52 max-w-[38%] shrink-0 flex-col border-l border-border/60 bg-card/35">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-2.5">
        <HugeiconsIcon
          icon={GitCompareIcon}
          size={14}
          strokeWidth={1.9}
          className="text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">
          {t("git.changedFiles")}
        </span>
        <Badge
          variant="secondary"
          className="h-5 min-w-5 justify-center px-1.5 text-[10px]"
        >
          {entries.length}
        </Badge>
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          disabled={sourceControl.isLoading || !!busy}
          aria-label={t("git.refreshSourceControl")}
          title={t("git.refreshSourceControl")}
          onClick={() => void sourceControl.refresh({ remote: "never" })}
        >
          {sourceControl.isLoading ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={Refresh01Icon} size={13} strokeWidth={1.9} />
          )}
        </button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div
          className="space-y-0.5 p-1.5"
          role="listbox"
          aria-label={t("git.changedFiles")}
        >
          {entries.map((entry) => {
            const active = entry.path === currentPath;
            const entryBusy = busy?.endsWith(`:${entry.path}`) ?? false;
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
                  <span
                    className="block truncate font-mono text-[10.5px]"
                    title={entry.path}
                  >
                    {entry.path}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[9.5px] opacity-70">
                    <span className="truncate">{entry.statusLabel}</span>
                    {entry.staged ? <span>{t("git.stagedChanges")}</span> : null}
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
      </ScrollArea>

      {selected ? (
        <div className="grid shrink-0 grid-cols-2 gap-1.5 border-t border-border/50 p-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 min-w-0 gap-1.5 px-2 text-[10.5px]"
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
            className="h-8 min-w-0 gap-1.5 px-2 text-[10.5px] text-destructive hover:bg-destructive/10 hover:text-destructive"
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
      ) : null}

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
    </aside>
  );
}
