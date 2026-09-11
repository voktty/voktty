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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type GitDiscardEntry, native } from "@/modules/ai/lib/native";
import { GitDiffPane } from "@/modules/editor/GitDiffPane";
import {
  EMPTY_COMMENTS,
  GitHubReviewDialog,
  GitWalkthroughDialog,
  ReviewHandoffDialog,
  sessionKey,
  useGitReviewStore,
} from "@/modules/git-review";
import { useTranslation } from "@/modules/i18n";
import {
  buildGitReviewEntries,
  type GitReviewEntry,
} from "@/modules/source-control/lib/reviewQueue";
import { useSourceControl } from "@/modules/source-control/useSourceControl";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { openPath } from "@tauri-apps/plugin-opener";
import { ExplorerMenu, type ExplorerMenuItem } from "@/modules/harness/chrome/ExplorerMenu";
import { copyText } from "@/modules/harness/lib/clipboard";
import { basename, revealPath } from "@/modules/harness/lib/fs";
import { IS_MAC, IS_WIN } from "@/modules/harness/lib/platform";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BotIcon,
  CheckmarkCircle02Icon,
  Comment01Icon,
  Delete02Icon,
  FolderGitTwoIcon,
  GitBranchIcon,
  GitCompareIcon,
  GithubIcon,
  Refresh01Icon,
  RemoveSquareIcon,
  Search01Icon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { TabSummary } from "../lib/agentHandoff";

type Props = {
  onRunCommand?: (command: string) => void;
  cwd?: string | null;
  tabs?: TabSummary[];
  onActivateAgent?: (tabId: number, leafId: number) => void;
};

function reviewFileMenuItems(t: (key: string) => string): ExplorerMenuItem[] {
  const revealLabel = IS_MAC
    ? t("harness.chrome.revealInFinder")
    : IS_WIN
      ? t("harness.chrome.revealInFileExplorer")
      : t("harness.chrome.openContainingFolder");

  return [
    { kind: "item", id: "open-file", label: t("harness.chrome.openFile") },
    { kind: "item", id: "open-default", label: t("harness.chrome.openInDefaultApp") },
    { kind: "item", id: "reveal", label: revealLabel },
    { kind: "sep" },
    { kind: "item", id: "copy-path", label: t("harness.chrome.copyPath") },
    { kind: "item", id: "copy-relative-path", label: t("harness.chrome.copyRelativePath") },
    { kind: "item", id: "copy-name", label: t("harness.chrome.copyFileName") },
    { kind: "sep" },
    { kind: "item", id: "open-git-history", label: t("harness.chrome.viewFileHistory") },
  ];
}

function statusBadge(statusCode: string) {
  const norm = statusCode.toUpperCase();
  if (norm === "A" || norm === "U" || norm === "?") {
    return {
      label: norm === "U" ? "U" : "A",
      bg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    };
  }
  if (norm === "D") {
    return {
      label: "D",
      bg: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
    };
  }
  if (norm === "R" || norm === "C") {
    return {
      label: "R",
      bg: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
    };
  }
  return {
    label: "M",
    bg: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  };
}

export function GitReviewTab({ cwd = null }: Props) {
  const { t } = useTranslation();
  const sourceControl = useSourceControl(cwd ?? null);
  const activeWorkspaceEnv = useWorkspaceEnvStore((s) => s.env);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "staged" | "unstaged">("all");
  const [busy, setBusy] = useState<string | null>(null);

  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<GitReviewEntry | null>(null);
  const [discardAllOpen, setDiscardAllOpen] = useState(false);
  const [fileMenu, setFileMenu] = useState<{
    x: number;
    y: number;
    entry: GitReviewEntry;
  } | null>(null);

  const repoRoot = sourceControl.status?.repoRoot ?? cwd ?? "";
  const hasRepo = sourceControl.hasRepo;
  const branchName = sourceControl.status?.branch ?? "";

  const handleMenuPick = useCallback(
    (actionId: string) => {
      if (!fileMenu) return;
      const target = fileMenu.entry;
      setFileMenu(null);
      const fullPath = repoRoot
        ? `${repoRoot.replace(/[/\\]+$/, "")}/${target.path.replace(/^[/\\]+/, "")}`
        : target.path;

      let action: Promise<void> | void;
      switch (actionId) {
        case "open-file":
          window.dispatchEvent(
            new CustomEvent("voktty:open-dropped-path", { detail: fullPath }),
          );
          return;
        case "open-default":
          action = openPath(fullPath);
          break;
        case "reveal":
          action = revealPath(fullPath);
          break;
        case "copy-path":
          action = copyText(fullPath);
          break;
        case "copy-relative-path":
          action = copyText(target.path);
          break;
        case "copy-name":
          action = copyText(basename(target.path));
          break;
        case "open-git-history":
          window.dispatchEvent(
            new CustomEvent("voktty:open-git-graph", {
              detail: {
                repoRoot,
                branch: branchName,
                workspaceEnv: activeWorkspaceEnv,
              },
            }),
          );
          return;
        default:
          return;
      }
      if (action) {
        void action.catch((error) => {
          console.error(`Failed to execute review file action ${actionId}:`, error);
        });
      }
    },
    [activeWorkspaceEnv, branchName, fileMenu, repoRoot],
  );

  const changedFiles = useMemo(
    () => sourceControl.status?.changedFiles ?? [],
    [sourceControl.status?.changedFiles],
  );

  const entries = useMemo(
    () => (sourceControl.status ? buildGitReviewEntries(changedFiles) : []),
    [changedFiles, sourceControl.status],
  );

  const filteredEntries = useMemo(() => {
    let result = entries;
    if (filterMode === "staged") {
      result = result.filter((e) => e.staged);
    } else if (filterMode === "unstaged") {
      result = result.filter((e) => e.unstaged);
    }
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.path.toLowerCase().includes(q) ||
          (e.originalPath && e.originalPath.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [entries, filterMode, filterQuery]);

  useEffect(() => {
    if (entries.length === 0) {
      if (selectedPath !== null) setSelectedPath(null);
      return;
    }
    const currentStillExists = entries.some(
      (e) =>
        e.path === selectedPath ||
        e.path.replace(/\\/g, "/") === selectedPath?.replace(/\\/g, "/"),
    );
    if (!currentStillExists) {
      setSelectedPath(entries[0].path);
    }
  }, [entries, selectedPath]);

  const selectedEntry = useMemo(
    () =>
      entries.find(
        (e) =>
          e.path === selectedPath ||
          e.path.replace(/\\/g, "/") === selectedPath?.replace(/\\/g, "/"),
      ) ?? null,
    [entries, selectedPath],
  );

  const sKey = sessionKey(repoRoot, "worktree");
  const overview = useGitReviewStore((state) => state.overviews[sKey]);
  const comments = useGitReviewStore(
    (state) => state.comments[sKey] ?? (EMPTY_COMMENTS as unknown as typeof state.comments[string]),
  );
  const loadOverview = useGitReviewStore((state) => state.loadOverview);
  const loadComments = useGitReviewStore((state) => state.loadComments);
  const markFile = useGitReviewStore((state) => state.markFile);

  const loadedRepoRef = useRef<string>("");
  useEffect(() => {
    if (repoRoot && loadedRepoRef.current !== repoRoot) {
      loadedRepoRef.current = repoRoot;
      void loadOverview(repoRoot, "worktree");
      void loadComments(repoRoot, "worktree");
    }
  }, [loadComments, loadOverview, repoRoot]);

  const commentsCountByFile = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of comments) {
      const norm = c.path.replace(/\\/g, "/");
      map.set(norm, (map.get(norm) ?? 0) + 1);
    }
    return map;
  }, [comments]);

  const stagedCount = useMemo(() => entries.filter((e) => e.staged).length, [entries]);
  const unstagedCount = useMemo(() => entries.filter((e) => e.unstaged).length, [entries]);

  const handleStage = useCallback(
    async (entry: GitReviewEntry) => {
      if (busy) return;
      setBusy(`stage:${entry.path}`);
      try {
        if (entry.unstaged) {
          await native.gitStage(repoRoot, [entry.path], activeWorkspaceEnv);
        } else {
          await native.gitUnstage(repoRoot, [entry.path], activeWorkspaceEnv);
        }
        await sourceControl.refresh({ remote: "never" });
      } catch (err) {
        toast.error(String(err));
      } finally {
        setBusy(null);
      }
    },
    [activeWorkspaceEnv, busy, repoRoot, sourceControl],
  );

  const handleStageAll = useCallback(async () => {
    if (busy || unstagedCount === 0) return;
    setBusy("stage:all");
    try {
      const unstagedPaths = entries.filter((e) => e.unstaged).map((e) => e.path);
      if (unstagedPaths.length > 0) {
        await native.gitStage(repoRoot, unstagedPaths, activeWorkspaceEnv);
        await sourceControl.refresh({ remote: "never" });
        toast.success(t("notesBoard.stageAll"));
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(null);
    }
  }, [activeWorkspaceEnv, busy, entries, repoRoot, sourceControl, t, unstagedCount]);

  const handleUnstageAll = useCallback(async () => {
    if (busy || stagedCount === 0) return;
    setBusy("unstage:all");
    try {
      const stagedPaths = entries.filter((e) => e.staged).map((e) => e.path);
      if (stagedPaths.length > 0) {
        await native.gitUnstage(repoRoot, stagedPaths, activeWorkspaceEnv);
        await sourceControl.refresh({ remote: "never" });
        toast.success(t("notesBoard.unstageAll"));
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(null);
    }
  }, [activeWorkspaceEnv, busy, entries, repoRoot, sourceControl, stagedCount, t]);

  const handleConfirmDiscard = useCallback(async () => {
    if (!pendingDiscard) return;
    const entry = pendingDiscard;
    setPendingDiscard(null);
    setBusy(`discard:${entry.path}`);
    try {
      const payload: GitDiscardEntry[] = [{ path: entry.path, untracked: entry.untracked }];
      await native.gitDiscard(repoRoot, payload, activeWorkspaceEnv);
      await sourceControl.refresh({ remote: "never" });
      toast.success(t("notesBoard.discardFile"));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(null);
    }
  }, [activeWorkspaceEnv, pendingDiscard, repoRoot, sourceControl, t]);

  const handleConfirmDiscardAll = useCallback(async () => {
    setDiscardAllOpen(false);
    if (entries.length === 0) return;
    setBusy("discard:all");
    try {
      const payloads: GitDiscardEntry[] = entries.map((e) => ({
        path: e.path,
        untracked: e.untracked,
      }));
      await native.gitDiscard(repoRoot, payloads, activeWorkspaceEnv);
      await sourceControl.refresh({ remote: "never" });
      toast.success(t("notesBoard.discardAll"));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(null);
    }
  }, [activeWorkspaceEnv, entries, repoRoot, sourceControl, t]);

  const handleToggleReviewed = useCallback(
    async (entry: GitReviewEntry) => {
      const current = overview?.files.find((f) => f.path === entry.path);
      const isReviewed = current?.reviewed ?? false;
      await markFile(repoRoot, "worktree", entry.path, "", !isReviewed);
    },
    [markFile, overview?.files, repoRoot],
  );

  const handleSelectPrev = useCallback(() => {
    if (filteredEntries.length === 0) return;
    const idx = filteredEntries.findIndex((e) => e.path === selectedPath);
    if (idx > 0) {
      setSelectedPath(filteredEntries[idx - 1].path);
    } else {
      setSelectedPath(filteredEntries[filteredEntries.length - 1].path);
    }
  }, [filteredEntries, selectedPath]);

  const handleSelectNext = useCallback(() => {
    if (filteredEntries.length === 0) return;
    const idx = filteredEntries.findIndex((e) => e.path === selectedPath);
    if (idx >= 0 && idx < filteredEntries.length - 1) {
      setSelectedPath(filteredEntries[idx + 1].path);
    } else {
      setSelectedPath(filteredEntries[0].path);
    }
  }, [filteredEntries, selectedPath]);

  const allChangedPathStrings = useMemo(
    () => entries.map((e) => e.path),
    [entries],
  );

  if (!hasRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center select-none">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground border border-border/50">
          <HugeiconsIcon icon={FolderGitTwoIcon} size={24} />
        </div>
        <div className="flex flex-col gap-1 max-w-sm">
          <h3 className="text-xs font-semibold text-foreground">
            {t("notesBoard.noRepoTitle")}
          </h3>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("notesBoard.noRepoDesc")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-background/85 text-foreground backdrop-blur-xs">
        {/* Top Action & Stats Bar */}
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/50 bg-muted/25 px-2.5 text-[11px] select-none gap-2">
          {/* Left: Branch & Counts */}
          <div className="flex items-center gap-2 min-w-0">
            {branchName && (
              <Badge
                variant="outline"
                className="h-5 gap-1 rounded-md px-1.5 font-mono text-[10px] font-medium border-border/60 bg-background/50 shrink-0"
              >
                <HugeiconsIcon icon={GitBranchIcon} size={11} className="text-primary" />
                <span className="truncate max-w-32">{branchName}</span>
              </Badge>
            )}
            <span className="text-[11px] font-medium text-foreground shrink-0">
              {entries.length}{" "}
              <span className="text-muted-foreground font-normal">
                {t("terminal.gitChanges", { count: entries.length })}
              </span>
            </span>
            {stagedCount > 0 && (
              <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.2 font-mono text-[9.5px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                +{stagedCount} {t("notesBoard.staged")}
              </span>
            )}
            {unstagedCount > 0 && (
              <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 font-mono text-[9.5px] font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                {unstagedCount} {t("notesBoard.unstaged")}
              </span>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {unstagedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStageAll}
                disabled={busy !== null}
                className="h-6 px-2 text-[10.5px] gap-1 cursor-pointer hover:bg-emerald-500/15 hover:text-emerald-600 dark:hover:text-emerald-400"
                title={t("notesBoard.stageAll")}
              >
                <HugeiconsIcon icon={Tick02Icon} size={12} />
                <span>{t("notesBoard.stageAll")}</span>
              </Button>
            )}
            {stagedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleUnstageAll}
                disabled={busy !== null}
                className="h-6 px-2 text-[10.5px] gap-1 cursor-pointer hover:bg-amber-500/15 hover:text-amber-600 dark:hover:text-amber-400"
                title={t("notesBoard.unstageAll")}
              >
                <HugeiconsIcon icon={RemoveSquareIcon} size={12} />
                <span>{t("notesBoard.unstageAll")}</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWalkthroughOpen(true)}
              disabled={entries.length === 0}
              className="h-6 px-2 text-[10.5px] gap-1 cursor-pointer hover:bg-primary/15 hover:text-primary"
              title={t("notesBoard.walkthroughAi")}
            >
              <HugeiconsIcon icon={SparklesIcon} size={12} className="text-primary" />
              <span>{t("notesBoard.walkthroughAi")}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("voktty:open-git-graph", {
                    detail: {
                      repoRoot,
                      branch: branchName,
                      workspaceEnv: activeWorkspaceEnv,
                    },
                  }),
                );
              }}
              className="h-6 px-2 text-[10.5px] gap-1 cursor-pointer hover:bg-muted"
              title={t("gitHistory.openCommitGraph")}
            >
              <HugeiconsIcon icon={FolderGitTwoIcon} size={12} className="text-primary" />
              <span>{t("gitHistory.openCommitGraph")}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setGithubOpen(true)}
              className="h-6 px-2 text-[10.5px] gap-1 cursor-pointer hover:bg-muted"
              title={t("notesBoard.githubPrReview")}
            >
              <HugeiconsIcon icon={GithubIcon} size={12} />
              <span>{t("notesBoard.githubPrReview")}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHandoffOpen(true)}
              disabled={entries.length === 0}
              className="h-6 px-2 text-[10.5px] gap-1 cursor-pointer hover:bg-primary/15 hover:text-primary"
              title={t("notesBoard.sendReviewToAgent")}
            >
              <HugeiconsIcon icon={BotIcon} size={12} />
              <span>{t("notesBoard.sendToAgent")}</span>
            </Button>

            {entries.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDiscardAllOpen(true)}
                disabled={busy !== null}
                className="size-6 text-muted-foreground hover:bg-destructive/15 hover:text-destructive cursor-pointer"
                title={t("notesBoard.discardAll")}
              >
                <HugeiconsIcon icon={Delete02Icon} size={13} />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={() => void sourceControl.refresh({ remote: "never" })}
              disabled={sourceControl.isLoading}
              className="size-6 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
              title={t("common.refresh")}
            >
              <HugeiconsIcon
                icon={Refresh01Icon}
                size={13}
                className={sourceControl.isLoading ? "animate-spin" : undefined}
              />
            </Button>
          </div>
        </div>

        {/* Main Split Layout */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left Panel: File List */}
          <div className="flex w-64 md:w-72 shrink-0 flex-col border-r border-border/50 bg-background/60">
            {/* Filter and search bar */}
            <div className="flex flex-col gap-1.5 p-2 border-b border-border/40">
              <div className="relative flex items-center">
                <HugeiconsIcon
                  icon={Search01Icon}
                  size={12}
                  className="absolute left-2.5 text-muted-foreground"
                />
                <Input
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder={t("notesBoard.filterFiles")}
                  className="h-6.5 pl-7 text-[11px] bg-background/70"
                />
              </div>
              <div className="flex items-center gap-1 text-[10px]">
                {(["all", "unstaged", "staged"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setFilterMode(mode)}
                    className={cn(
                      "flex-1 rounded py-0.5 font-medium transition-colors cursor-pointer text-center",
                      filterMode === mode
                        ? "bg-muted text-foreground font-semibold shadow-2xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {mode === "all"
                      ? t("notesBoard.allChanges")
                      : mode === "staged"
                        ? `${t("notesBoard.staged")} (${stagedCount})`
                        : `${t("notesBoard.unstaged")} (${unstagedCount})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Files Scrollable List */}
            <ScrollArea className="flex-1 min-h-0">
              {filteredEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground text-[11px]">
                  {entries.length === 0
                    ? t("notesBoard.noChangesDesc")
                    : t("notesBoard.noResults")}
                </div>
              ) : (
                <div className="flex flex-col p-1 gap-0.5">
                  {filteredEntries.map((entry) => {
                    const isSelected =
                      selectedEntry?.path === entry.path ||
                      selectedEntry?.path.replace(/\\/g, "/") ===
                        entry.path.replace(/\\/g, "/");
                    const st = statusBadge(entry.statusCode);
                    const fileComments =
                      commentsCountByFile.get(entry.path.replace(/\\/g, "/")) ?? 0;
                    const reviewStatus = overview?.files.find(
                      (f) => f.path === entry.path,
                    );
                    const isReviewed = reviewStatus?.reviewed ?? false;

                    return (
                      <div
                        key={entry.path}
                        onClick={() => setSelectedPath(entry.path)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setFileMenu({ x: e.clientX, y: e.clientY, entry });
                        }}
                        className={cn(
                          "group relative flex items-center justify-between rounded-md px-2 py-1.5 text-[11px] cursor-pointer transition-colors select-none",
                          isSelected
                            ? "bg-accent/90 text-accent-foreground font-medium shadow-2xs"
                            : "hover:bg-muted/50 text-foreground",
                        )}
                      >
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          {/* Reviewed Checkbox Indicator */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleToggleReviewed(entry);
                            }}
                            className={cn(
                              "flex size-3.5 items-center justify-center rounded border transition-colors cursor-pointer shrink-0",
                              isReviewed
                                ? "border-emerald-500 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                                : "border-border/60 text-transparent hover:border-foreground/50",
                            )}
                            title={
                              isReviewed
                                ? t("notesBoard.unmarkReviewed")
                                : t("notesBoard.markReviewed")
                            }
                          >
                            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={10} strokeWidth={2} />
                          </button>

                          {/* Status Badge */}
                          <span
                            className={cn(
                              "flex size-4 items-center justify-center rounded border font-mono text-[9px] font-bold shrink-0",
                              st.bg,
                            )}
                          >
                            {st.label}
                          </span>

                          {/* File Path */}
                          <span
                            className={cn(
                              "truncate font-mono text-[11px]",
                              isReviewed && "line-through text-muted-foreground",
                            )}
                            title={entry.path}
                          >
                            {entry.path}
                          </span>
                        </div>

                        {/* Badges & Hover Actions */}
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {fileComments > 0 && (
                            <span className="flex items-center gap-0.5 rounded-full bg-primary/15 text-primary px-1 py-0.2 font-mono text-[9px] font-semibold">
                              <HugeiconsIcon icon={Comment01Icon} size={9} />
                              {fileComments}
                            </span>
                          )}

                          {/* Hover action icons */}
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleStage(entry);
                              }}
                              disabled={busy !== null}
                              className="size-5 flex items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground cursor-pointer"
                              title={
                                entry.unstaged
                                  ? t("git.stage")
                                  : t("git.unstage")
                              }
                            >
                              <HugeiconsIcon
                                icon={entry.unstaged ? Tick02Icon : RemoveSquareIcon}
                                size={11}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDiscard(entry);
                              }}
                              disabled={busy !== null}
                              className="size-5 flex items-center justify-center rounded text-muted-foreground hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                              title={t("notesBoard.discardFile")}
                            >
                              <HugeiconsIcon icon={Delete02Icon} size={11} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Right Panel: Live Diff Viewer */}
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-background">
            {selectedEntry ? (
              <div className="flex h-full flex-col overflow-hidden">
                {/* File Header Bar */}
                <div
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFileMenu({ x: e.clientX, y: e.clientY, entry: selectedEntry });
                  }}
                  className="flex h-8 shrink-0 items-center justify-between border-b border-border/50 bg-muted/15 px-3 text-[11px] select-none"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs font-semibold text-foreground truncate">
                      {selectedEntry.path}
                    </span>
                    {selectedEntry.originalPath && (
                      <span className="font-mono text-[10px] text-muted-foreground truncate">
                        {t("notesBoard.renamedFrom", {
                          path: selectedEntry.originalPath,
                        })}
                      </span>
                    )}
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.2 font-mono text-[9px] font-semibold uppercase",
                        selectedEntry.unstaged
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {selectedEntry.unstaged ? t("notesBoard.unstaged") : t("notesBoard.staged")}
                    </span>
                  </div>

                  {/* Top file quick actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleSelectPrev}
                      className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                      title={t("notesBoard.prevFile")}
                    >
                      <HugeiconsIcon icon={ArrowLeft01Icon} size={12} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleSelectNext}
                      className="size-6 text-muted-foreground hover:text-foreground cursor-pointer"
                      title={t("notesBoard.nextFile")}
                    >
                      <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
                    </Button>

                    <span className="h-3 w-px bg-border/60 mx-1" />

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleStage(selectedEntry)}
                      disabled={busy !== null}
                      className="h-6 px-2 text-[10.5px] gap-1 cursor-pointer"
                    >
                      <HugeiconsIcon
                        icon={selectedEntry.unstaged ? Tick02Icon : RemoveSquareIcon}
                        size={11}
                      />
                      <span>
                        {selectedEntry.unstaged
                          ? t("git.stage")
                          : t("git.unstage")}
                      </span>
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPendingDiscard(selectedEntry)}
                      disabled={busy !== null}
                      className="size-6 text-muted-foreground hover:bg-destructive/15 hover:text-destructive cursor-pointer"
                      title={t("notesBoard.discardFile")}
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={12} />
                    </Button>
                  </div>
                </div>

                {/* Diff Viewer Area */}
                <div className="relative flex-1 min-h-0 overflow-hidden">
                  <GitDiffPane
                    active={true}
                    source={{
                      kind: "working",
                      repoRoot,
                      path: selectedEntry.path,
                      mode: selectedEntry.unstaged ? "-" : "+",
                      originalPath: selectedEntry.originalPath,
                      workspaceEnv: activeWorkspaceEnv,
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center select-none text-muted-foreground">
                <div className="flex size-10 items-center justify-center rounded-xl bg-muted/40 border border-border/40">
                  <HugeiconsIcon icon={GitCompareIcon} size={20} />
                </div>
                <span className="text-xs font-medium text-foreground">
                  {t("notesBoard.noChangesTitle")}
                </span>
                <span className="text-[11px] text-muted-foreground max-w-xs">
                  {t("notesBoard.noChangesDesc")}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Dialogs */}
        <GitWalkthroughDialog
          open={walkthroughOpen}
          onOpenChange={setWalkthroughOpen}
          repoRoot={repoRoot}
          changedFiles={allChangedPathStrings}
          onNavigateReference={(path) => {
            setSelectedPath(path);
            setWalkthroughOpen(false);
          }}
        />

        <GitHubReviewDialog
          open={githubOpen}
          onOpenChange={setGithubOpen}
          repoRoot={repoRoot}
        />

        <ReviewHandoffDialog
          open={handoffOpen}
          onOpenChange={setHandoffOpen}
          repoRoot={repoRoot}
          totalChangedFiles={entries.length}
        />

        {/* Single File Discard Confirmation */}
        <AlertDialog
          open={pendingDiscard !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDiscard(null);
          }}
        >
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("notesBoard.discardFileConfirm", {
                  file: pendingDiscard?.path ?? "",
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("notesBoard.discardFileDesc")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={handleConfirmDiscard}
              >
                {t("notesBoard.discardFile")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Discard All Confirmation */}
        <AlertDialog
          open={discardAllOpen}
          onOpenChange={setDiscardAllOpen}
        >
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("notesBoard.discardAllConfirm")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("notesBoard.discardAllDesc")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={handleConfirmDiscardAll}
              >
                {t("notesBoard.discardAll")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {fileMenu ? (
          <ExplorerMenu
            x={fileMenu.x}
            y={fileMenu.y}
            items={reviewFileMenuItems(t)}
            onPick={handleMenuPick}
            onClose={() => setFileMenu(null)}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}
