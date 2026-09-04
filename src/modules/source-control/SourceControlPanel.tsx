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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useAiAvailable } from "@/modules/ai/lib/runtimeAvailability";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { type GitBranchEntry, native } from "@/modules/ai/lib/native";
import {
  copyToClipboard,
  revealInFinder,
} from "@/modules/explorer/lib/contextActions";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  COMPACT_CONTENT,
  COMPACT_ITEM,
} from "@/modules/explorer/lib/menuItemClass";
import { useTranslation } from "@/modules/i18n";
import { joinPath } from "@/modules/explorer/lib/useFileTree";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setGitCommitMessageUseEditorLanguage,
  setSourceControlViewMode,
} from "@/modules/settings/store";
import {
  AiContentGenerator02Icon,
  Alert02Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  CheckListIcon,
  CheckmarkCircle01Icon,
  Download01Icon,
  Folder01Icon,
  FolderCloudIcon,
  FolderGitTwoIcon,
  FolderTreeIcon,
  GitBranchIcon,
  Refresh01Icon,
  RemoveSquareIcon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { GitCloneModal } from "./GitCloneModal";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  repositoryTargetIsPending,
  type SourceControlRepositoryTarget,
} from "./repositoryTarget";
import {
  flattenSourceControlTree,
  type SourceControlTreeRow,
} from "./lib/tree";
import type { SourceControlSummary } from "./useSourceControl";
import {
  useSourceControlPanel,
  type CheckState,
  type SourceControlFileEntry,
} from "./useSourceControlPanel";
import type { SemanticCommitGroup } from "./lib/semanticStaging";

type Props = {
  open: boolean;
  sourceControl: SourceControlSummary;
  onOpenGitGraph?: () => void;
  onOpenDiff: (input: {
    path: string;
    repoRoot: string;
    mode: "+" | "-";
    originalPath: string | null;
    title?: string;
  }) => void;
  onOpenFile?: (absolutePath: string) => void;
  onNavigateToPath?: (path: string) => void;
  repositoryTarget: SourceControlRepositoryTarget;
  onFollowRepositoryContext: () => void;
  dirtyPaths?: readonly string[];
};

const SOURCE_CONTROL_TOOLTIP_CLASS =
  "border border-border/70 bg-zinc-950 text-zinc-100 shadow-lg shadow-black/30 dark:border-border/60 dark:bg-zinc-950 dark:text-zinc-100";

const ROW_HEIGHTS = {
  banner: 32,
  header: 30,
  entry: 30,
} as const;

type RowDescriptor =
  | { kind: "banner-diverged"; key: string }
  | { kind: "list-header"; key: string; count: number }
  | { kind: "entry"; key: string; entry: SourceControlFileEntry; depth: number }
  | Extract<SourceControlTreeRow, { kind: "folder" }>;

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  return normalized.slice(0, index);
}

function entryPathLabel(entry: SourceControlFileEntry): string {
  if (entry.originalPath) return `${entry.originalPath} → ${entry.path}`;
  return dirname(entry.path);
}

function upstreamBadgeLabel(upstream: string | null | undefined): string {
  if (!upstream) return "No upstream";
  return upstream;
}

function statusAccent(code: string): string {
  switch (code) {
    case "A":
      return "bg-emerald-500/85";
    case "U":
      return "bg-teal-500/85";
    case "M":
      return "bg-amber-500/85";
    case "D":
      return "bg-rose-500/85";
    case "R":
      return "bg-sky-500/85";
    default:
      return "bg-muted-foreground/40";
  }
}

function commitTypeBadge(type: string): string {
  switch (type) {
    case "feat":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30";
    case "fix":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30";
    case "refactor":
      return "bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30";
    case "perf":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30";
    case "test":
      return "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30";
    case "docs":
      return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30";
    default:
      return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border border-zinc-500/30";
  }
}

function SemanticStagingView({
  groups,
  onApplyGroup,
  onClose,
}: {
  groups: SemanticCommitGroup[];
  onApplyGroup: (group: SemanticCommitGroup) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 space-y-2 animate-in fade-in-0 duration-150">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
          <HugeiconsIcon icon={SparklesIcon} size={12} strokeWidth={2} />
          <span>{t("git.semanticStaging")}</span>
          <span className="text-[10px] text-muted-foreground font-normal">
            ({groups.length} {t("git.semanticGroupsCount")})
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-xs p-0.5 rounded cursor-pointer"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
        </button>
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
        {groups.map((g) => (
          <div
            key={g.id}
            className="group/item flex flex-col gap-1 rounded-md border border-border/50 bg-background/85 p-2 text-[11.5px] transition-colors hover:border-primary/40 hover:bg-background"
          >
            <div className="flex items-start justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1 min-w-0">
                <span
                  className={cn(
                    "px-1 py-0.2 rounded text-[9.5px] font-semibold uppercase tracking-wider",
                    commitTypeBadge(g.type),
                  )}
                >
                  {g.type}
                </span>
                {g.scope && (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    ({g.scope})
                  </span>
                )}
                <span
                  className="font-medium text-foreground truncate max-w-44"
                  title={g.message}
                >
                  {g.message.replace(/^[\w]+(\([^)]+\))?:\s*/, "")}
                </span>
              </div>
              <Button
                size="xs"
                variant="outline"
                className="h-5 px-1.5 text-[10px] font-medium shrink-0 cursor-pointer"
                onClick={() => onApplyGroup(g)}
              >
                {t("git.applyGroup")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
              {g.files.map((f) => (
                <span
                  key={f}
                  className="rounded bg-muted/60 px-1 py-0.5 font-mono truncate max-w-40"
                  title={f}
                >
                  {basename(f)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function checkboxValue(state: CheckState): boolean | "indeterminate" {
  if (state === "checked") return true;
  if (state === "indeterminate") return "indeterminate";
  return false;
}

function BranchDropdown({
  repoRoot,
  repoLabel,
  displayRepoRoot,
  repositoryTarget,
  onFollowRepositoryContext,
  onNavigateToPath,
  onRefresh,
}: {
  repoRoot: string | null;
  repoLabel: string;
  displayRepoRoot: string | null;
  repositoryTarget: SourceControlRepositoryTarget;
  onFollowRepositoryContext: () => void;
  onNavigateToPath?: (path: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const requestRef = useRef(0);
  const checkoutInFlight = useRef(false);

  const loadBranches = useCallback(async () => {
    const id = ++requestRef.current;
    if (!repoRoot) {
      setBranches([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await native.gitListBranches(repoRoot, workspaceEnv);
      if (id !== requestRef.current) return;
      setBranches(result.branches);
    } catch (e) {
      if (id !== requestRef.current) return;
      setError(String(e));
      setBranches([]);
    } finally {
      if (id === requestRef.current) {
        setLoading(false);
      }
    }
  }, [repoRoot, workspaceEnv]);

  useEffect(() => {
    if (open) {
      void loadBranches();
    }
  }, [open, loadBranches]);

  const handleCheckout = useCallback(
    async (branch: string) => {
      if (!repoRoot || checkoutInFlight.current) return;
      checkoutInFlight.current = true;
      setCheckingOut(true);
      try {
        await native.gitCheckoutBranch(repoRoot, branch, workspaceEnv);
        setBranches([]);
        setOpen(false);
        onRefresh();
      } catch (e) {
        toast.error(String(e));
      } finally {
        checkoutInFlight.current = false;
        setCheckingOut(false);
      }
    },
    [onRefresh, repoRoot, workspaceEnv],
  );

  const localBranches = useMemo(
    () => branches.filter((b) => b.kind === "local"),
    [branches],
  );
  const worktrees = useMemo(
    () => branches.filter((b) => b.kind === "worktree"),
    [branches],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={checkingOut}
          title={displayRepoRoot ?? repoLabel}
          className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md bg-foreground/5 px-2 py-1 text-[11.5px] font-medium leading-none text-foreground transition-colors hover:bg-foreground/10 disabled:cursor-default disabled:opacity-70"
        >
          <HugeiconsIcon
            icon={FolderGitTwoIcon}
            size={12}
            strokeWidth={1.9}
            className="shrink-0 text-muted-foreground"
          />
          {displayRepoRoot ? (
            <>
              <span className="max-w-22 truncate">
                {basename(displayRepoRoot)}
              </span>
              <span className="text-muted-foreground/60">/</span>
            </>
          ) : null}
          <span className="max-w-24 truncate">{repoLabel}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {displayRepoRoot ? (
          <>
            <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/85">
              {t("git.repository")}
            </DropdownMenuLabel>
            <div
              className="truncate px-2 pb-1.5 text-[11px] text-muted-foreground"
              title={displayRepoRoot}
            >
              {displayRepoRoot}
            </div>
            {repositoryTarget.mode === "fixed" ? (
              <DropdownMenuItem
                onSelect={() => {
                  onFollowRepositoryContext();
                  setOpen(false);
                }}
                className="cursor-pointer text-[12px]"
              >
                {t("git.followActiveContext")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
            <Spinner className="size-3" />
            {t("git.loadingBranches")}
          </div>
        ) : error ? (
          <div className="px-3 py-3 text-[11px] leading-snug text-destructive">
            {error}
          </div>
        ) : (
          <>
            {localBranches.length > 0 && (
              <>
                <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/85">
                  {t("git.localBranches")}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  {localBranches.map((b) => (
                    <DropdownMenuItem
                      key={b.name}
                      onSelect={() => void handleCheckout(b.name)}
                      className="flex cursor-pointer items-center gap-2 text-[12px]"
                    >
                      {b.isHead ? (
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          size={14}
                          strokeWidth={1.8}
                          className="shrink-0"
                        />
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            )}
            {worktrees.length > 0 && (
              <>
                {localBranches.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/85">
                  {t("git.worktrees")}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  {worktrees.map((b) => (
                    <DropdownMenuItem
                      key={b.worktreePath ?? b.name}
                      onSelect={() => {
                        if (b.worktreePath && onNavigateToPath) {
                          onNavigateToPath(b.worktreePath);
                        }
                      }}
                      className="flex cursor-pointer items-center gap-2 text-[12px]"
                    >
                      <HugeiconsIcon
                        icon={Folder01Icon}
                        size={14}
                        strokeWidth={1.5}
                        className="shrink-0 text-muted-foreground"
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{b.name}</span>
                        {b.worktreePath && (
                          <span className="truncate text-[10px] text-muted-foreground">
                            {b.worktreePath}
                          </span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            )}
            {branches.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-muted-foreground">
                {t("git.noBranches")}
              </div>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const SourceControlPanel = memo(function SourceControlPanel({
  open,
  sourceControl,
  onOpenGitGraph,
  onOpenDiff,
  onOpenFile,
  onNavigateToPath,
  repositoryTarget,
  onFollowRepositoryContext,
  dirtyPaths = [],
}: Props) {
  const { t } = useTranslation();
  const aiAvailable = useAiAvailable();
  const viewMode = usePreferencesStore((s) => s.sourceControlViewMode);
  const gitCommitMessageUseEditorLanguage = usePreferencesStore(
    (s) => s.gitCommitMessageUseEditorLanguage,
  );
  const language = usePreferencesStore((s) => s.language);
  const scm = useSourceControlPanel(
    open,
    sourceControl,
    onOpenDiff,
    dirtyPaths,
  );
  const refreshAnimationRef = useRef<number | null>(null);
  const [refreshAnimating, setRefreshAnimating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(),
  );
  const [cloneModalOpen, setCloneModalOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (refreshAnimationRef.current) {
        window.clearTimeout(refreshAnimationRef.current);
      }
    };
  }, []);

  const fixedTargetPending = repositoryTargetIsPending({
    target: repositoryTarget,
    loadedContextPath: sourceControl.contextPath,
    loadedRepoRoot: sourceControl.repo?.repoRoot ?? null,
    isLoading: sourceControl.isLoading,
  });
  const panelState = fixedTargetPending ? "loading" : scm.panelState;
  const isRefreshing = panelState === "loading";
  const repoLabel = useMemo(() => {
    if (fixedTargetPending) return t("common.loading");
    if (!scm.status) return t("sidebar.sourceControl");
    return scm.status.isDetached ? "detached" : scm.status.branch;
  }, [fixedTargetPending, scm.status, t]);

  const commitShortcut = IS_MAC ? "⌘↩" : "Ctrl+Enter";
  const generateShortcut = IS_MAC ? "⌘G" : "Ctrl+G";
  const canCommit =
    scm.stagedEntries.length > 0 &&
    scm.commitMessage.trim().length > 0 &&
    !fixedTargetPending &&
    !scm.actionBusy;
  const commitDisabledReason = scm.actionBusy
    ? t("git.waitActionFinish")
    : scm.stagedEntries.length === 0
      ? t("git.stageToCommit")
      : scm.commitMessage.trim().length === 0
        ? t("git.enterCommitMsg")
        : null;
  const commitHint = canCommit
    ? t("git.commitWithShortcut", { shortcut: commitShortcut })
    : (commitDisabledReason ??
      t("git.commitWithShortcut", { shortcut: commitShortcut }));
  const pushHint = scm.pushHint ?? t("git.pushUnavailable");
  const pushDisabledReason = fixedTargetPending
    ? t("git.waitRepoLoading")
    : scm.actionBusy
      ? t("git.waitActionFinish")
      : pushHint;
  const stagedCount = scm.stagedEntries.length;
  const changedCount = scm.fileEntries.length;
  const pushStatusLabel = upstreamBadgeLabel(scm.status?.upstream);
  const hasUpstream = !!scm.status?.upstream;
  const isDiverged =
    !!scm.status && scm.status.ahead > 0 && scm.status.behind > 0;

  const canPull =
    hasUpstream &&
    !!scm.status &&
    scm.status.behind > 0 &&
    !isDiverged &&
    !fixedTargetPending &&
    !scm.actionBusy &&
    !sourceControl.busyAction;
  const canFetch =
    hasUpstream &&
    !fixedTargetPending &&
    !scm.actionBusy &&
    !sourceControl.busyAction;

  const footerFeedback = useMemo(() => {
    if (scm.actionError)
      return { tone: "error", message: scm.actionError } as const;
    if (scm.remoteError)
      return { tone: "error", message: scm.remoteError } as const;
    if (scm.actionMessage)
      return { tone: "success", message: scm.actionMessage } as const;
    return null;
  }, [scm.actionError, scm.actionMessage, scm.remoteError]);

  const handleCommitShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      canCommit
    ) {
      event.preventDefault();
      void scm.commit();
      return;
    }
    if (
      event.key.toLowerCase() === "g" &&
      (event.metaKey || event.ctrlKey) &&
      scm.canGenerateCommitMessage
    ) {
      event.preventDefault();
      void scm.generateCommitMessage();
    }
  };

  const handleRefresh = useCallback(() => {
    setRefreshAnimating(true);
    if (refreshAnimationRef.current) {
      window.clearTimeout(refreshAnimationRef.current);
    }
    void scm.refresh().finally(() => {
      refreshAnimationRef.current = window.setTimeout(() => {
        setRefreshAnimating(false);
        refreshAnimationRef.current = null;
      }, 450);
    });
  }, [scm]);

  const handleFetch = useCallback(() => {
    void sourceControl.runRemoteAction("fetch");
  }, [sourceControl]);

  const handlePull = useCallback(() => {
    void sourceControl.runRemoteAction("pull");
  }, [sourceControl]);

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const projectedRows = useMemo<RowDescriptor[]>(
    () =>
      viewMode === "tree"
        ? flattenSourceControlTree(scm.fileEntries, collapsedFolders)
        : scm.fileEntries.map((entry) => ({
            kind: "entry" as const,
            key: entry.key,
            entry,
            depth: 0,
          })),
    [collapsedFolders, scm.fileEntries, viewMode],
  );

  const rows = useMemo<RowDescriptor[]>(() => {
    const result: RowDescriptor[] = [];
    if (isDiverged) {
      result.push({ kind: "banner-diverged", key: "banner-diverged" });
    }
    if (changedCount > 0) {
      result.push({
        kind: "list-header",
        key: "list-header",
        count: changedCount,
      });
      result.push(...projectedRows);
    }
    return result;
  }, [changedCount, isDiverged, projectedRows]);

  const rowKeyToIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      map.set(row.key, index);
    });
    return map;
  }, [rows]);

  useEffect(() => {
    if (!focusedRowKey) return;
    if (!rowKeyToIndex.has(focusedRowKey)) {
      setFocusedRowKey(null);
    }
  }, [focusedRowKey, rowKeyToIndex]);

  const focusableIndices = useMemo(() => {
    const out: number[] = [];
    rows.forEach((row, index) => {
      if (row.kind === "entry") out.push(index);
    });
    return out;
  }, [rows]);

  const estimateSize = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return ROW_HEIGHTS.entry;
      switch (row.kind) {
        case "banner-diverged":
          return ROW_HEIGHTS.banner;
        case "list-header":
          return ROW_HEIGHTS.header;
        case "entry":
          return ROW_HEIGHTS.entry;
        case "folder":
          return ROW_HEIGHTS.entry;
      }
    },
    [rows],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 12,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  const moveFocus = useCallback(
    (direction: 1 | -1) => {
      if (focusableIndices.length === 0) return;
      const currentIndex =
        focusedRowKey === null ? -1 : (rowKeyToIndex.get(focusedRowKey) ?? -1);
      let pos = focusableIndices.indexOf(currentIndex);
      if (pos === -1) pos = direction > 0 ? -1 : focusableIndices.length;
      let nextPos = pos + direction;
      if (nextPos < 0) nextPos = 0;
      if (nextPos > focusableIndices.length - 1)
        nextPos = focusableIndices.length - 1;
      const targetRowIndex = focusableIndices[nextPos];
      const target = rows[targetRowIndex];
      if (!target) return;
      setFocusedRowKey(target.key);
      virtualizer.scrollToIndex(targetRowIndex, { align: "auto" });
    },
    [focusableIndices, focusedRowKey, rowKeyToIndex, rows, virtualizer],
  );

  const focusedEntry = useCallback((): SourceControlFileEntry | null => {
    if (!focusedRowKey) return null;
    const index = rowKeyToIndex.get(focusedRowKey);
    if (index === undefined) return null;
    const row = rows[index];
    return row && row.kind === "entry" ? row.entry : null;
  }, [focusedRowKey, rowKeyToIndex, rows]);

  const handlePanelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.closest("button"))
      ) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && (event.key === "r" || event.key === "R")) {
        event.preventDefault();
        handleRefresh();
        return;
      }
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveFocus(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveFocus(-1);
          break;
        case "Enter": {
          const entry = focusedEntry();
          if (entry) {
            event.preventDefault();
            void scm.selectFile(entry);
          }
          break;
        }
        case " ":
        case "s":
        case "S": {
          if (meta) break;
          const entry = focusedEntry();
          if (entry) {
            event.preventDefault();
            void scm.toggleStageFile(entry);
          }
          break;
        }
        case "d":
        case "D": {
          if (meta) break;
          const entry = focusedEntry();
          if (entry?.unstaged) {
            event.preventDefault();
            scm.requestDiscardFile(entry);
          }
          break;
        }
      }
    },
    [focusedEntry, handleRefresh, moveFocus, scm],
  );

  if (!open) return null;

  const fetchBusy = sourceControl.busyAction === "fetch";
  const pullBusy = sourceControl.busyAction === "pull";

  return (
    <TooltipProvider delayDuration={800} skipDelayDuration={300}>
      <aside className="flex h-full min-w-0 flex-col [contain:layout_style]">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 pb-2.5 pt-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <BranchDropdown
              repoRoot={
                fixedTargetPending ? null : (scm.repo?.repoRoot ?? null)
              }
              repoLabel={repoLabel}
              displayRepoRoot={
                repositoryTarget.mode === "fixed"
                  ? repositoryTarget.repoRoot
                  : (scm.repo?.repoRoot ?? null)
              }
              repositoryTarget={repositoryTarget}
              onFollowRepositoryContext={onFollowRepositoryContext}
              onNavigateToPath={onNavigateToPath}
              onRefresh={handleRefresh}
            />
            {scm.status && (scm.status.ahead > 0 || scm.status.behind > 0) ? (
              <div className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold tabular-nums leading-none text-muted-foreground">
                {scm.status.ahead > 0 ? (
                  <span className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1 py-0.5">
                    <HugeiconsIcon
                      icon={ArrowUp01Icon}
                      size={9}
                      strokeWidth={2.2}
                    />
                    {scm.status.ahead}
                  </span>
                ) : null}
                {scm.status.behind > 0 ? (
                  <span className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1 py-0.5">
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      size={9}
                      strokeWidth={2.2}
                    />
                    {scm.status.behind}
                  </span>
                ) : null}
              </div>
            ) : null}
            {scm.status?.isDetached ? (
              <span className="rounded bg-muted/55 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("git.detached")}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <fieldset
              aria-label={t("git.viewMode")}
              className="mr-1 flex items-center rounded-md border border-border/50 p-0.5"
            >
              <button
                type="button"
                aria-label={t("git.listView")}
                aria-pressed={viewMode === "list"}
                onClick={() => void setSourceControlViewMode("list")}
                className={cn(
                  "inline-flex size-6 cursor-pointer items-center justify-center rounded transition-colors",
                  viewMode === "list"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground/65 hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <HugeiconsIcon
                  icon={CheckListIcon}
                  size={13}
                  strokeWidth={1.85}
                />
              </button>
              <button
                type="button"
                aria-label={t("git.treeView")}
                aria-pressed={viewMode === "tree"}
                onClick={() => void setSourceControlViewMode("tree")}
                className={cn(
                  "inline-flex size-6 cursor-pointer items-center justify-center rounded transition-colors",
                  viewMode === "tree"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground/65 hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <HugeiconsIcon
                  icon={FolderTreeIcon}
                  size={13}
                  strokeWidth={1.85}
                />
              </button>
            </fieldset>
            <IconActionButton
              label={fetchBusy ? t("git.fetching") : t("git.fetchRemote")}
              disabled={!canFetch}
              onClick={handleFetch}
              side="bottom"
            >
              {fetchBusy ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon
                  icon={FolderCloudIcon}
                  size={14}
                  strokeWidth={1.85}
                />
              )}
            </IconActionButton>
            <IconActionButton
              label={
                pullBusy
                  ? t("git.pulling")
                  : isDiverged
                    ? t("git.branchDiverged")
                    : !hasUpstream
                      ? t("git.noUpstream")
                      : (scm.status?.behind ?? 0) === 0
                        ? t("git.alreadyUpToDate")
                        : t("git.pullCommits", {
                            count: scm.status?.behind ?? 0,
                          })
              }
              disabled={!canPull}
              onClick={handlePull}
              side="bottom"
            >
              {pullBusy ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon
                  icon={Download01Icon}
                  size={14}
                  strokeWidth={1.9}
                />
              )}
            </IconActionButton>
            <IconActionButton
              label={t("git.refreshSourceControl")}
              disabled={isRefreshing || !!scm.actionBusy}
              onClick={handleRefresh}
              side="bottom"
            >
              {isRefreshing ? (
                <Spinner className="size-3.5" />
              ) : (
                <HugeiconsIcon
                  icon={Refresh01Icon}
                  size={14}
                  strokeWidth={1.9}
                  className={cn(refreshAnimating && "animate-spin")}
                />
              )}
            </IconActionButton>
          </div>
        </header>

        {onOpenGitGraph ? (
          <button
            type="button"
            onClick={() => onOpenGitGraph()}
            className="group flex shrink-0 cursor-pointer items-center gap-2 border-b border-border/40 px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          >
            <HugeiconsIcon
              icon={GitBranchIcon}
              size={13}
              strokeWidth={1.85}
              className="shrink-0"
            />
            <span className="flex-1 text-[12px] font-medium">
              {t("git.commitGraph")}
            </span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={12}
              strokeWidth={2}
              className="shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5"
            />
          </button>
        ) : null}

        {panelState === "loading" ? (
          <PanelCenter title={t("common.loading")} />
        ) : null}

        {panelState === "dubious-ownership" ? (
          <PanelCenter
            icon={
              <HugeiconsIcon
                icon={Alert02Icon}
                size={28}
                className="text-amber-500 mb-1"
              />
            }
            title={t("git.dubiousOwnershipTitle")}
            body={t("git.dubiousOwnershipDesc", {
              path: scm.dubiousOwnershipPath ?? sourceControl.contextPath ?? "",
            })}
            action={
              <div className="flex flex-col sm:flex-row items-center gap-2">
                <Button
                  size="sm"
                  className="gap-1.5 bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 hover:text-amber-400 border border-amber-500/30 font-medium"
                  disabled={isRefreshing || !!scm.actionBusy}
                  onClick={async () => {
                    try {
                      await scm.trustRepository(
                        scm.dubiousOwnershipPath ??
                          sourceControl.contextPath ??
                          undefined,
                      );
                      toast.success(
                        t("git.authorizedSuccess", {
                          defaultValue: t("git.trustRepositorySuccess"),
                        }),
                      );
                    } catch (err) {
                      toast.error(String(err));
                    }
                  }}
                >
                  <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} />
                  {t("git.authorizeDirectory", {
                    defaultValue: t("git.trustRepository"),
                  })}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isRefreshing || !!scm.actionBusy}
                  onClick={handleRefresh}
                >
                  {t("explorer.refresh")}
                </Button>
              </div>
            }
          />
        ) : null}

        {panelState === "no-repo" ? (
          <PanelCenter
            icon={
              <HugeiconsIcon
                icon={FolderGitTwoIcon}
                size={28}
                className="text-muted-foreground/60 mb-1"
              />
            }
            title={t("git.noRepoTitle")}
            body={t("git.noRepoDesc")}
            action={
              <div className="flex flex-col gap-2 w-full max-w-xs">
                <Button
                  size="sm"
                  className="gap-1.5 font-medium shadow-xs"
                  disabled={isRefreshing || !!scm.actionBusy}
                  onClick={async () => {
                    try {
                      await scm.initRepository(
                        sourceControl.contextPath ?? undefined,
                      );
                      toast.success(t("git.initRepoSuccess"));
                    } catch (err) {
                      toast.error(String(err));
                    }
                  }}
                >
                  <HugeiconsIcon icon={FolderGitTwoIcon} size={14} />
                  {t("git.initializeRepo")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 font-medium"
                  disabled={isRefreshing || !!scm.actionBusy}
                  onClick={() => setCloneModalOpen(true)}
                >
                  <HugeiconsIcon icon={GitBranchIcon} size={14} />
                  {t("git.cloneRepo")}
                </Button>
                {sourceControl.contextPath ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    disabled={isRefreshing || !!scm.actionBusy}
                    onClick={async () => {
                      try {
                        await scm.trustRepository(
                          sourceControl.contextPath ?? undefined,
                        );
                        toast.success(
                          t("git.authorizedSuccess", {
                            defaultValue: t("git.trustRepositorySuccess"),
                          }),
                        );
                      } catch (err) {
                        toast.error(String(err));
                      }
                    }}
                  >
                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={13} />
                    {t("git.authorizeDirectory", {
                      defaultValue: t("git.trustRepository"),
                    })}
                  </Button>
                ) : null}
              </div>
            }
          />
        ) : null}

        {panelState === "error" ? (
          <PanelCenter
            title={t("sidebar.sourceControl")}
            body={scm.statusError ?? t("git.unknownSourceControlError")}
            action={
              <div className="flex flex-col sm:flex-row items-center gap-2">
                {sourceControl.contextPath || scm.dubiousOwnershipPath ? (
                  <Button
                    size="sm"
                    className="gap-1.5 font-medium"
                    disabled={isRefreshing || !!scm.actionBusy}
                    onClick={async () => {
                      try {
                        await scm.trustRepository(
                          scm.dubiousOwnershipPath ??
                            sourceControl.contextPath ??
                            undefined,
                        );
                        toast.success(
                          t("git.authorizedSuccess", {
                            defaultValue: t("git.trustRepositorySuccess"),
                          }),
                        );
                      } catch (err) {
                        toast.error(String(err));
                      }
                    }}
                  >
                    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} />
                    {t("git.authorizeDirectory", {
                      defaultValue: t("git.trustRepository"),
                    })}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isRefreshing || !!scm.actionBusy}
                  onClick={() => void scm.refresh()}
                >
                  {t("explorer.refresh")}
                </Button>
              </div>
            }
          />
        ) : null}

        {panelState === "ready" && scm.status ? (
          <>
            <div className="relative shrink-0 space-y-2 border-b border-border/40 bg-gradient-to-b from-card/65 to-card/30 px-2.5 pb-2.5 pt-2.5">
              <div
                className={cn(
                  "relative rounded-lg border bg-background/95 shadow-sm transition-colors",
                  scm.commitMessage.length > 0
                    ? "border-border/70"
                    : "border-border/45",
                  "focus-within:border-primary/45 focus-within:shadow-md focus-within:shadow-primary/5",
                )}
              >
                <Textarea
                  value={scm.commitMessage}
                  onChange={(event) => scm.setCommitMessage(event.target.value)}
                  onKeyDown={handleCommitShortcut}
                  placeholder={t("git.commitPlaceholder")}
                  rows={3}
                  className={cn(
                    "min-h-[72px] border-border resize-none rounded-lg bg-transparent px-3 pb-7 pt-2.5 text-[12.5px] leading-snug shadow-none placeholder:text-muted-foreground/65 focus-visible:ring-0 focus:border-0",
                  )}
                />
                <div className="pointer-events-none absolute inset-x-3 bottom-1.5 flex items-center justify-between p-1 gap-2 text-[10px] tabular-nums text-muted-foreground/55">
                  {scm.commitMessage.length > 0 ? (
                    <span>
                      {t("git.characterCount", {
                        count: scm.commitMessage.length,
                      })}
                    </span>
                  ) : (
                    <span className="flex gap-2 items-center">
                      {commitShortcut}
                    </span>
                  )}
                </div>
                {aiAvailable ? (
                  <div className="absolute right-1 top-1 flex items-center gap-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("git.semanticStagingTitle")}
                          disabled={
                            scm.fileEntries.length === 0 || !!scm.actionBusy
                          }
                          onClick={() => void scm.generateSemanticGroups()}
                          className={cn(
                            "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/65 transition-colors",
                            "hover:bg-foreground/[0.06] hover:text-primary",
                            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/65",
                          )}
                        >
                          {scm.actionBusy === "semantic-staging" ? (
                            <Spinner className="size-3" />
                          ) : (
                            <HugeiconsIcon
                              icon={SparklesIcon}
                              size={13}
                              strokeWidth={1.85}
                            />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="left"
                        className={cn(
                          SOURCE_CONTROL_TOOLTIP_CLASS,
                          "text-[10.5px]",
                        )}
                      >
                        {t("git.semanticStagingTitle")}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${scm.generateCommitMessageHint} (${generateShortcut})`}
                          disabled={!scm.canGenerateCommitMessage}
                          onClick={() => void scm.generateCommitMessage()}
                          className={cn(
                            "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/65 transition-colors",
                            "hover:bg-foreground/[0.06] hover:text-foreground",
                            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/65",
                          )}
                        >
                          {scm.actionBusy === "generate-message" ? (
                            <Spinner className="size-3" />
                          ) : (
                            <HugeiconsIcon
                              icon={AiContentGenerator02Icon}
                              size={14}
                              strokeWidth={1.75}
                            />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="left"
                        className={cn(
                          SOURCE_CONTROL_TOOLTIP_CLASS,
                          "text-[10.5px]",
                        )}
                      >
                        {`${scm.generateCommitMessageHint} (${generateShortcut})`}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ) : null}
              </div>

              {aiAvailable &&
                scm.semanticStagingOpen &&
                scm.semanticGroups.length > 0 && (
                  <SemanticStagingView
                    groups={scm.semanticGroups}
                    onApplyGroup={(g) => void scm.applySemanticGroup(g)}
                    onClose={() => scm.setSemanticStagingOpen(false)}
                  />
                )}

              <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full transition-colors",
                    canCommit
                      ? "bg-foreground/80"
                      : stagedCount > 0
                        ? "bg-muted-foreground/60"
                        : "bg-muted-foreground/30",
                  )}
                />
                <span className="truncate font-medium text-foreground/85">
                  {stagedCount === 0
                    ? t("git.noChanges")
                    : `${stagedCount} ${t("git.stagedChanges").toLowerCase()}`}
                </span>
                <span className="ml-auto shrink-0 truncate text-muted-foreground/65">
                  {pushStatusLabel}
                </span>
              </div>

              <div className="grid w-full grid-cols-2 gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="xs"
                      className="h-7 cursor-pointer text-[11.5px] font-semibold tracking-tight shadow-sm disabled:cursor-not-allowed disabled:shadow-none"
                      disabled={!canCommit}
                      onClick={() => void scm.commit()}
                    >
                      {scm.actionBusy === "commit"
                        ? `${t("git.commit")}…`
                        : t("git.commit")}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className={cn(
                      SOURCE_CONTROL_TOOLTIP_CLASS,
                      "text-[10.5px]",
                    )}
                  >
                    {commitHint}
                  </TooltipContent>
                </Tooltip>
                {!hasUpstream && !scm.status?.isDetached ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="xs"
                        variant="secondary"
                        className="h-7 cursor-pointer text-[11.5px] font-medium disabled:cursor-not-allowed"
                        disabled={
                          fixedTargetPending ||
                          !!scm.actionBusy ||
                          !!sourceControl.busyAction
                        }
                        onClick={() => void sourceControl.runRemoteAction("publish")}
                      >
                        {sourceControl.busyAction === "publish"
                          ? `${t("git.publishing")}…`
                          : t("git.publishBranch")}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className={cn(
                        SOURCE_CONTROL_TOOLTIP_CLASS,
                        "max-w-64 text-[10.5px]",
                      )}
                    >
                      {t("git.publishBranchTooltip")}
                    </TooltipContent>
                  </Tooltip>
                ) : scm.status && scm.status.behind > 0 && !isDiverged ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="xs"
                        variant="secondary"
                        className="h-7 cursor-pointer text-[11.5px] font-medium disabled:cursor-not-allowed"
                        disabled={
                          !canPull || fixedTargetPending || !!scm.actionBusy
                        }
                        onClick={() => void sourceControl.runRemoteAction("pull")}
                      >
                        {sourceControl.busyAction === "pull"
                          ? `${t("git.pulling")}…`
                          : t("git.pullCommits", {
                              count: scm.status.behind,
                            })}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className={cn(
                        SOURCE_CONTROL_TOOLTIP_CLASS,
                        "max-w-64 text-[10.5px]",
                      )}
                    >
                      {t("git.pullTooltip", {
                        count: scm.status.behind,
                      })}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="xs"
                        variant="secondary"
                        className="h-7 cursor-pointer text-[11.5px] font-medium disabled:cursor-not-allowed"
                        disabled={
                          !scm.canPush || fixedTargetPending || !!scm.actionBusy
                        }
                        onClick={() => void scm.push()}
                      >
                        {scm.actionBusy === "push"
                          ? `${t("git.push")}…`
                          : (scm.status?.ahead ?? 0) > 0
                            ? t("git.pushCommits", {
                                count: scm.status?.ahead ?? 0,
                              })
                            : t("git.push")}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className={cn(
                        SOURCE_CONTROL_TOOLTIP_CLASS,
                        "max-w-64 text-[10.5px]",
                      )}
                    >
                      {pushDisabledReason}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              <div className="flex items-center justify-between pt-0.5 gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer select-none text-[10.5px] text-muted-foreground/80 hover:text-foreground transition-colors min-w-0">
                  <input
                    type="checkbox"
                    checked={gitCommitMessageUseEditorLanguage}
                    onChange={(e) => {
                      void setGitCommitMessageUseEditorLanguage(
                        e.target.checked,
                      );
                    }}
                    className="size-3.5 rounded border-border/70 accent-primary cursor-pointer shrink-0"
                  />
                  <span className="truncate">
                    {t("git.generateInEditorLanguage", {
                      lang: language.toUpperCase(),
                    })}
                  </span>
                </label>
                {scm.canUndo ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10.5px] text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                        disabled={!!scm.actionBusy}
                        onClick={() => void scm.undoCommit()}
                      >
                        <HugeiconsIcon
                          icon={ArrowLeft01Icon}
                          size={12}
                          className="mr-1"
                        />
                        {scm.actionBusy === "undo"
                          ? `${t("git.undoingCommit")}…`
                          : t("git.undoCommit")}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className={cn(
                        SOURCE_CONTROL_TOOLTIP_CLASS,
                        "text-[10.5px]",
                      )}
                    >
                      {t("git.undoCommitTooltip")}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>

              <CommitFeedback feedback={footerFeedback} />
            </div>

            {scm.allClean ? (
              <CleanTreeHint repoLabel={repoLabel} />
            ) : (
              <div
                ref={containerRef}
                tabIndex={0}
                role="listbox"
                aria-label={t("git.changedFiles")}
                aria-activedescendant={
                  focusedRowKey ? `scm-row-${focusedRowKey}` : undefined
                }
                onKeyDown={handlePanelKeyDown}
                className="relative min-h-0 flex-1 outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
              >
                <div
                  ref={scrollRef}
                  className="h-full overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
                >
                  <div
                    style={{
                      height: virtualizer.getTotalSize(),
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      if (!row) return null;
                      return (
                        <div
                          key={virtualRow.key}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: virtualRow.size,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          {row.kind === "folder" ? (
                            <FolderRow
                              row={row}
                              onToggle={() => toggleFolder(row.path)}
                              collapseLabel={t("git.collapseFolder", {
                                name: row.name,
                              })}
                              expandLabel={t("git.expandFolder", {
                                name: row.name,
                              })}
                            />
                          ) : (
                            <RowRenderer
                              row={row}
                              focused={focusedRowKey === row.key}
                              selectedPath={scm.selected?.path ?? null}
                              actionBusy={scm.actionBusy}
                              headerCheckState={scm.headerCheckState}
                              repoRoot={scm.repo?.repoRoot ?? null}
                              onFocusRow={setFocusedRowKey}
                              onToggleAll={scm.toggleAll}
                              onSelectFile={scm.selectFile}
                              onToggleStageFile={scm.toggleStageFile}
                              onDiscardFile={scm.requestDiscardFile}
                              onOpenFile={onOpenFile}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : null}
      </aside>

      <AlertDialog
        open={scm.pendingDiscard !== null}
        onOpenChange={(o) => {
          if (!o) scm.cancelPendingDiscard();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("git.discard")}?</AlertDialogTitle>
            <AlertDialogDescription>
              {scm.pendingDiscard?.scope === "all"
                ? t("git.discardAllDescription", {
                    label: scm.pendingDiscard.label,
                  })
                : scm.pendingDiscard
                  ? t("git.discardOneDescription", {
                      label: scm.pendingDiscard.label,
                    })
                  : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => scm.cancelPendingDiscard()}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void scm.confirmPendingDiscard()}>
              {t("git.discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GitCloneModal
        open={cloneModalOpen}
        onOpenChange={setCloneModalOpen}
        defaultParentDir={sourceControl.contextPath}
        onCloned={(path) => {
          onNavigateToPath?.(path);
        }}
      />
    </TooltipProvider>
  );
});

function PanelCenter({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      {icon}
      <div className="text-sm font-medium">{title}</div>
      {body ? (
        <div className="max-w-64 text-[11px] leading-relaxed text-muted-foreground break-all">
          {body}
        </div>
      ) : null}
      {action}
    </div>
  );
}

function CleanTreeHint({ repoLabel }: { repoLabel: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center">
      <div className="flex size-8 items-center justify-center rounded-full border border-border/55 text-muted-foreground">
        <HugeiconsIcon
          icon={CheckmarkCircle01Icon}
          size={16}
          strokeWidth={1.6}
        />
      </div>
      <div className="text-[12px] font-medium text-foreground">
        {t("git.noChanges")}
      </div>
      <div className="text-[10.5px] leading-snug text-muted-foreground">
        {t("git.onRepository", { name: repoLabel })}
      </div>
    </div>
  );
}

function FolderRow({
  row,
  onToggle,
  collapseLabel,
  expandLabel,
}: {
  row: Extract<RowDescriptor, { kind: "folder" }>;
  onToggle: () => void;
  collapseLabel: string;
  expandLabel: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={row.expanded}
      aria-label={row.expanded ? collapseLabel : expandLabel}
      onClick={onToggle}
      style={{ paddingLeft: 8 + row.depth * 14 }}
      className="flex h-[30px] w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 text-left text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground"
    >
      <HugeiconsIcon
        icon={row.expanded ? ArrowDown01Icon : ArrowRight01Icon}
        size={11}
        strokeWidth={2}
        className="shrink-0"
      />
      <HugeiconsIcon
        icon={Folder01Icon}
        size={14}
        strokeWidth={1.7}
        className="shrink-0 text-muted-foreground/80"
      />
      <span className="min-w-0 truncate">{row.name}</span>
    </button>
  );
}

type RowRendererProps = {
  row: RowDescriptor;
  focused: boolean;
  selectedPath: string | null;
  actionBusy: string | null;
  headerCheckState: CheckState;
  repoRoot: string | null;
  onFocusRow: (key: string | null) => void;
  onToggleAll: () => Promise<void> | void;
  onSelectFile: (entry: SourceControlFileEntry) => Promise<void>;
  onToggleStageFile: (entry: SourceControlFileEntry) => Promise<void>;
  onDiscardFile: (entry: SourceControlFileEntry) => void;
  onOpenFile?: (absolutePath: string) => void;
};

const RowRenderer = memo(function RowRenderer(props: RowRendererProps) {
  const { row } = props;
  switch (row.kind) {
    case "banner-diverged":
      return <DivergedBanner />;
    case "list-header":
      return <ListHeader {...props} row={row} />;
    case "entry":
      return <EntryRow {...props} row={row} />;
  }
});

function DivergedBanner() {
  const { t } = useTranslation();
  return (
    <div className="mx-2 mt-1 flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-foreground/[0.04] px-2 text-[10.5px] leading-none text-muted-foreground">
      <HugeiconsIcon
        icon={Alert02Icon}
        size={11}
        strokeWidth={1.9}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground/85">
          {t("git.diverged")}
        </span>
        <span className="ml-1 opacity-75">- {t("git.resolveInTerminal")}</span>
      </span>
    </div>
  );
}

function ListHeader({
  row,
  actionBusy,
  headerCheckState,
  onToggleAll,
}: RowRendererProps & {
  row: Extract<RowDescriptor, { kind: "list-header" }>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-7 items-center gap-2 px-3">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/85">
        {t("git.changes")}
      </span>
      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 px-1 text-[9.5px] font-semibold tabular-nums text-muted-foreground">
        {row.count}
      </span>
      <label className="ml-auto flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground hover:text-foreground">
        <span>{t("git.stageAll")}</span>
        <Checkbox
          aria-label={t("git.stageAll")}
          checked={checkboxValue(headerCheckState)}
          disabled={actionBusy !== null}
          onCheckedChange={() => void onToggleAll()}
          className="size-3.5"
        />
      </label>
    </div>
  );
}

const EntryRow = memo(function EntryRow({
  row,
  focused,
  selectedPath,
  actionBusy,
  repoRoot,
  onFocusRow,
  onSelectFile,
  onToggleStageFile,
  onDiscardFile,
  onOpenFile,
}: RowRendererProps & {
  row: Extract<RowDescriptor, { kind: "entry" }>;
}) {
  const entry = row.entry;
  const isSelected = selectedPath === entry.path;
  const fileName = basename(entry.path);
  const iconUrl = fileIconUrl(fileName);
  const pathLabel = entryPathLabel(entry);
  const showDiscard = entry.unstaged;
  const isStageBusy =
    actionBusy === `stage:${entry.path}` ||
    actionBusy === `unstage:${entry.path}`;
  const isDiscardBusy = actionBusy === `discard:${entry.path}`;
  const disabled = actionBusy !== null;

  const absolutePath = repoRoot
    ? joinPath(repoRoot.replace(/\\/g, "/"), entry.path.replace(/\\/g, "/"))
    : null;
  const isDeleted = entry.statusCode === "D";

  const { t } = useTranslation();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          id={`scm-row-${row.key}`}
          data-focused={focused || undefined}
          data-selected={isSelected || undefined}
          role="option"
          tabIndex={-1}
          aria-selected={isSelected}
          onMouseDown={() => onFocusRow(row.key)}
          style={{ paddingLeft: 8 + row.depth * 14 }}
          className={cn(
            "group relative flex h-[30px] items-center gap-2 rounded-md pr-2 transition-all duration-100",
            focused
              ? "bg-accent/60"
              : isSelected
                ? "bg-accent/55 text-foreground"
                : "hover:bg-accent/30",
          )}
        >
          <span
            className={cn(
              "pointer-events-none absolute inset-y-1 left-0 w-[2px] rounded-full transition-opacity",
              statusAccent(entry.statusCode),
              isSelected || focused
                ? "opacity-100"
                : "opacity-55 group-hover:opacity-95",
            )}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => {
              onFocusRow(row.key);
              void onSelectFile(entry);
            }}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          >
            {iconUrl ? (
              <img src={iconUrl} alt="" className="size-4 shrink-0" />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5 leading-none">
              <span
                className={cn(
                  "truncate text-[12px] leading-tight",
                  isSelected || focused
                    ? "font-semibold text-foreground"
                    : "font-medium text-foreground/95",
                  pathLabel ? "max-w-[58%] shrink-0" : "min-w-0 flex-1",
                )}
              >
                {fileName}
              </span>
              {pathLabel ? (
                <span className="min-w-0 flex-1 truncate text-[10.5px] leading-tight text-muted-foreground/75">
                  {pathLabel}
                </span>
              ) : null}
            </div>
          </button>

          {showDiscard ? (
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 data-[focused=true]:opacity-100 data-[selected=true]:opacity-100">
              <IconActionButton
                label={`${t("git.discard")} ${entry.path}`}
                disabled={disabled}
                side="top"
                onClick={() => onDiscardFile(entry)}
              >
                {isDiscardBusy ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon
                    icon={RemoveSquareIcon}
                    size={11}
                    strokeWidth={1.9}
                  />
                )}
              </IconActionButton>
            </div>
          ) : null}

          <span className="flex size-5 shrink-0 items-center justify-center">
            {isStageBusy ? (
              <Spinner className="size-3" />
            ) : (
              <Checkbox
                aria-label={t("git.stageFile", { name: entry.path })}
                checked={checkboxValue(entry.checkState)}
                disabled={disabled}
                onCheckedChange={() => void onToggleStageFile(entry)}
                className="size-3.5"
              />
            )}
          </span>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className={COMPACT_CONTENT}>
        {/* Open actions */}
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => {
            onFocusRow(row.key);
            void onSelectFile(entry);
          }}
        >
          {t("git.diff")}
        </ContextMenuItem>
        {!isDeleted && onOpenFile && absolutePath ? (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => onOpenFile(absolutePath)}
          >
            {t("common.open")}
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        {/* Stage / Unstage */}
        <ContextMenuItem
          className={COMPACT_ITEM}
          disabled={disabled}
          onSelect={() => void onToggleStageFile(entry)}
        >
          {entry.checkState === "checked" ? t("git.unstage") : t("git.stage")}
        </ContextMenuItem>
        {entry.unstaged ? (
          <ContextMenuItem
            className={COMPACT_ITEM}
            variant="destructive"
            disabled={disabled}
            onSelect={() => onDiscardFile(entry)}
          >
            {t("git.discard")}
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        {/* Copy paths */}
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => void copyToClipboard(entry.path.replace(/\\/g, "/"))}
        >
          {t("explorer.copyRelativePath")}
        </ContextMenuItem>
        {absolutePath ? (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => void copyToClipboard(absolutePath)}
          >
            {t("explorer.copyPath")}
          </ContextMenuItem>
        ) : null}

        {/* Reveal in Finder — only for existing files */}
        {!isDeleted && absolutePath ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => void revealInFinder(absolutePath)}
            >
              {t("explorer.revealInFinder")}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
});

function IconActionButton({
  label,
  disabled,
  side = "left",
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  side?: "left" | "top" | "right" | "bottom";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-6 p-3 cursor-pointer rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className={cn(SOURCE_CONTROL_TOOLTIP_CLASS, "text-[10.5px]")}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function CommitFeedback({
  feedback,
}: {
  feedback: { tone: "error" | "success"; message: string } | null;
}) {
  const [visibleFeedback, setVisibleFeedback] = useState(feedback);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!feedback) {
      setIsVisible(false);
      return;
    }
    setVisibleFeedback(feedback);
    setIsVisible(true);
    const hideTimer = window.setTimeout(() => setIsVisible(false), 3600);
    const clearTimer = window.setTimeout(() => {
      setVisibleFeedback((current) =>
        current?.message === feedback.message && current.tone === feedback.tone
          ? null
          : current,
      );
    }, 3900);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [feedback]);

  if (!visibleFeedback) return null;

  const isError = visibleFeedback.tone === "error";
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-3 top-[calc(100%-0.25rem)] z-20 flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug shadow-lg shadow-black/15 backdrop-blur transition-all duration-200",
        isVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
        isError
          ? "border-destructive/30 bg-card/95 text-destructive"
          : "border-border/70 bg-card/95 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isError ? "bg-destructive" : "bg-foreground/70",
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          isError ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {visibleFeedback.message}
      </span>
    </div>
  );
}
