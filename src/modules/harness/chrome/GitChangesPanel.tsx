import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  ExternalLink,
  FileDiff,
  FolderTree,
  GitBranch,
  GitPullRequest,
  ListBullet,
  Loader,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
  WandSparkles,
} from "./icons";
import { useTranslation } from "@/modules/i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FileTypeIcon } from "./FileTypeIcon";
import {
  loadChangesView,
  saveChangesView,
  type ChangesView,
} from "../lib/appearance";
import {
  basename,
  gitCommit,
  gitDiffIndex,
  gitDiscardFile,
  gitPrCreate,
  gitPrStatus,
  gitPush,
  gitStageAll,
  gitStageFile,
  gitSync,
  gitUnstageAll,
  gitUnstageFile,
  notifyGitChanged,
  subscribeGitChanged,
  type GitChangedFile,
  type GitDiffIndex,
  type GitPr,
} from "../lib/fs";
import type { HarnessId } from "../lib/session";
import { generateCommitMessage, generatePrContent } from "../lib/harness";
import { invalidateWatchedFiles } from "../lib/fileWatch";
import { MOD } from "../lib/platform";
import { applyProjectDiffStats } from "../hooks/useProjectDiffStats";
import { useLockOverscroll } from "../hooks/useLockOverscroll";

const GIT_POLL_MS = 2000;
let stagedOpen = true;
let changesOpen = true;
let changesView: ChangesView = loadChangesView();
/** Folders the user collapsed in tree view, keyed `<kind>:<dir>`. */
const collapsedDirs = new Set<string>();
const indexByCwd = new Map<string, GitDiffIndex>();
const prByCwd = new Map<string, GitPr | null>();

type Props = {
  cwd: string;
  enabled: boolean;
  textHarness?: HarnessId;
  selectedPath?: string;
  onOpenFile: (path: string) => void;
  onOpenAllChanges?: () => void;
};

export function GitChangesPanel({
  cwd,
  enabled,
  textHarness,
  selectedPath,
  onOpenFile,
  onOpenAllChanges,
}: Props) {
  const { t } = useTranslation();
  const { index, reload } = useDiffIndex(cwd, enabled);
  const files = index?.files ?? [];

  if (!cwd || cwd === "~") {
    return (
      <p className="px-3 py-2 text-[12px] text-content/50">{t("harness.chrome.noProjectFolder")}</p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-content/10 px-3">
        {(index?.additions ?? 0) > 0 || (index?.deletions ?? 0) > 0 ? (
          <DiffCounts
            additions={index?.additions ?? 0}
            deletions={index?.deletions ?? 0}
          />
        ) : (
          <span className="text-[12px] font-medium text-content">
            {t("harness.chrome.changes")}
          </span>
        )}
        {index?.branch ? (
          <span className="ml-auto flex min-w-0 items-center gap-1 text-[11px] text-content/50">
            <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 truncate">{index.branch}</span>
            {index.ahead > 0 ? (
              <span className="shrink-0 tabular-nums text-content/40">
                ↑{index.ahead}
              </span>
            ) : null}
            {index.behind > 0 ? (
              <span className="shrink-0 tabular-nums text-content/40">
                ↓{index.behind}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="ml-auto" />
        )}
      </header>
      <ChangedFiles
        cwd={cwd}
        textHarness={textHarness}
        index={index}
        files={files}
        selected={selectedPath}
        enabled={enabled}
        onOpenFile={onOpenFile}
        onOpenAllChanges={onOpenAllChanges}
        onMutated={(paths) => {
          reload();
          notifyGitChanged();
          invalidateWatchedFiles(paths);
          window.setTimeout(() => invalidateWatchedFiles(paths), 150);
        }}
      />
    </div>
  );
}

function ChangedFiles({
  cwd,
  textHarness,
  index,
  files,
  selected,
  enabled,
  onOpenFile,
  onOpenAllChanges,
  onMutated,
}: {
  cwd: string;
  textHarness?: HarnessId;
  index: GitDiffIndex | null;
  files: GitChangedFile[];
  selected?: string;
  enabled: boolean;
  onOpenFile: (path: string) => void;
  onOpenAllChanges?: () => void;
  onMutated: (paths?: string[]) => void;
}) {
  const { t } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const menuRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [stagedExpanded, setStagedExpanded] = useState(stagedOpen);
  const [changesExpanded, setChangesExpanded] = useState(changesOpen);
  const [view, setView] = useState<ChangesView>(changesView);
  const { pr, reload: reloadPr } = usePrStatus(cwd, index?.branch);

  const toggleView = () => {
    const next: ChangesView = view === "tree" ? "list" : "tree";
    changesView = next;
    saveChangesView(next);
    setView(next);
  };
  const staged = files.filter((file) => file.staged);
  const unstaged = files.filter((file) => file.unstaged);
  const hasRemote = Boolean(index?.remote);
  const hasOpenPr = pr?.state === "open";
  const diverged = (index?.ahead ?? 0) > 0 && (index?.behind ?? 0) > 0;
  const onDefault =
    !!index?.branch &&
    !!index.defaultBranch &&
    index.branch === index.defaultBranch;
  const canGenerate = files.length > 0 && !busy;
  const canCommit = files.length > 0 && message.trim().length > 0 && !busy;
  const canCreatePr =
    hasRemote &&
    !hasOpenPr &&
    !onDefault &&
    !diverged &&
    files.length === 0 &&
    (index?.aheadOfDefault ?? 0) > 0 &&
    (index?.behind ?? 0) === 0;
  const canViewPr = hasOpenPr && !!pr?.url;
  const canPublish = hasRemote && !index?.upstream;
  const canSync =
    hasRemote &&
    Boolean(index?.upstream) &&
    ((index?.ahead ?? 0) > 0 || (index?.behind ?? 0) > 0);
  const canCommitPush = canCommit && hasRemote && !diverged;
  const canCommitPushPr = canCommitPush && !hasOpenPr && !onDefault;
  const canEditMessage = !busy;

  useEffect(() => {
    if (!enabled) return;
    const el = messageRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [message, enabled]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [menuOpen]);

  const fail = (error: unknown) => {
    window.alert(error instanceof Error ? error.message : String(error));
  };

  const confirmDefault = (kind: "push" | "pr") => {
    if (!onDefault || !index?.branch) return true;
    const branch = index.branch;
    return window.confirm(
      kind === "pr"
        ? `Create a pull request from default branch "${branch}"?`
        : `Push to default branch "${branch}"?`,
    );
  };

  const run = async (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
  ) => {
    if (busy) return;
    if (action === "discard") {
      const name = basename(file.relative);
      const ok = window.confirm(
        file.status === "untracked"
          ? `Delete untracked file ${name}?`
          : `Discard changes in ${name}? This cannot be undone.`,
      );
      if (!ok) return;
    }
    setBusy(file.relative);
    try {
      if (action === "stage") await gitStageFile(cwd, file.relative);
      else if (action === "unstage") await gitUnstageFile(cwd, file.relative);
      else await gitDiscardFile(cwd, file.relative);
      onMutated([file.path]);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const runAll = async (action: "stage" | "unstage") => {
    if (busy) return;
    setBusy(action);
    try {
      if (action === "stage") await gitStageAll(cwd);
      else await gitUnstageAll(cwd);
      onMutated();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (!canGenerate) return;
    setBusy("generate");
    try {
      setMessage(await generateCommitMessage(cwd, textHarness));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const commit = async (push: boolean, createPr = false) => {
    if (!canCommit) return;
    if ((push || createPr) && !confirmDefault(createPr ? "pr" : "push")) return;
    setBusy(createPr ? "pr" : "commit");
    setMenuOpen(false);
    try {
      if (staged.length === 0) {
        await gitStageAll(cwd);
      }
      await gitCommit(cwd, message);
      if (push || createPr) await gitPush(cwd);
      setMessage("");
      onMutated();
      if (createPr) {
        await openCreatedPr();
        reloadPr();
      }
    } catch (error) {
      fail(error);
      onMutated();
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    if (!index || !(canSync || canPublish)) return;
    setBusy("sync");
    try {
      await gitSync(cwd);
      onMutated();
      reloadPr();
    } catch (error) {
      fail(error);
      onMutated();
    } finally {
      setBusy(null);
    }
  };

  const openCreatedPr = async () => {
    const content = await generatePrContent(cwd, textHarness);
    if (!content) throw new Error("Could not prepare pull request content");
    const url = await gitPrCreate(
      cwd,
      content.title,
      content.body,
      content.base,
      content.head,
    );
    await openUrl(url.trim());
  };

  const createPr = async () => {
    if (!canCreatePr) return;
    if (!confirmDefault("pr")) return;
    setBusy("pr");
    try {
      if ((index?.ahead ?? 0) > 0) await gitPush(cwd);
      await openCreatedPr();
      onMutated();
      reloadPr();
    } catch (error) {
      fail(error);
      onMutated();
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-content/10 p-2">
        <div className="relative">
          <textarea
            ref={messageRef}
            rows={1}
            value={message}
            placeholder={t("harness.chrome.messageToCommitShortcut", {
              shortcut: MOD,
            })}
            disabled={!canEditMessage}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === "Enter" &&
                canCommit
              ) {
                event.preventDefault();
                void commit(false);
              }
            }}
            className="max-h-40 w-full resize-none overflow-y-auto rounded-md bg-content/10 py-1 pr-8 pl-2 text-[13px] leading-5 text-content outline-none placeholder:text-content/35 disabled:opacity-40"
          />
          <button
            type="button"
            title={t("harness.chrome.generateCommit")}
            aria-label={t("harness.chrome.generateCommit")}
            disabled={!canGenerate}
            onClick={() => void generate()}
            className="absolute top-1 right-1 grid size-5 place-items-center rounded-md text-content bg-content/10 hover:bg-content/20 hover:text-content disabled:opacity-40"
          >
            {busy === "generate" ? (
              <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              <WandSparkles className="size-3" strokeWidth={1} />
            )}
          </button>
        </div>
        <div ref={menuRef} className="relative mt-1.5 flex">
          <button
            type="button"
            disabled={!canCommit}
            onClick={() => void commit(false)}
            className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-l-md bg-content text-[12px] font-medium text-background-base disabled:opacity-40"
          >
            <Check className="size-3.5" strokeWidth={2} />
            {t("harness.chrome.commit")}
          </button>

          <button
            type="button"
            title={t("harness.chrome.commitOptions")}
            aria-label={t("harness.chrome.commitOptions")}
            disabled={!canCommit}
            onClick={() => setMenuOpen((open) => !open)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-r-md border-l border-background-base/10 bg-content text-background-base disabled:opacity-40"
          >
            <ChevronDown className="size-3.5" strokeWidth={2} />
          </button>
          {menuOpen ? (
            <div className="absolute top-full right-0 z-30 mt-1 min-w-48 rounded-md border border-content/10 bg-background-base py-1 shadow-lg">
              <button
                type="button"
                disabled={!canCommitPush}
                onClick={() => void commit(true)}
                className="flex h-7 w-full items-center px-3 text-left text-[12px] text-content hover:bg-content/10 disabled:opacity-40"
              >
                {t("harness.chrome.commitAndPush")}
              </button>
              <button
                type="button"
                disabled={!canCommitPushPr}
                onClick={() => void commit(true, true)}
                className="flex h-7 w-full items-center px-3 text-left text-[12px] text-content hover:bg-content/10 disabled:opacity-40"
              >
                {t("harness.chrome.commitPushCreatePr")}
              </button>
            </div>
          ) : null}
        </div>
        {index ? (
          <GitSyncActions
            index={index}
            pr={pr}
            busy={busy}
            hasRemote={hasRemote}
            hasOpenPr={hasOpenPr}
            onDefault={onDefault}
            canSync={canSync}
            canPublish={canPublish}
            canCreatePr={canCreatePr}
            canViewPr={canViewPr}
            onSync={() => void sync()}
            onCreatePr={() => void createPr()}
            onViewPr={() => {
              if (pr?.url) void openUrl(pr.url);
            }}
          />
        ) : null}
      </div>
      <div
        ref={lockOverscroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-none py-1"
      >
        {files.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-content/45">
            {index
              ? index.ahead > 0 || index.behind > 0
                ? syncStatusLabel(t, index)
                : t("harness.chrome.noUncommittedChanges")
              : t("harness.chrome.loadingChanges")}
          </p>
        ) : (
          <>
            {staged.length > 0 ? (
              <FileSection
                title={t("harness.chrome.stagedChanges")}
                count={staged.length}
                open={stagedExpanded}
                onToggle={() => {
                  stagedOpen = !stagedExpanded;
                  setStagedExpanded(stagedOpen);
                }}
                headerActions={[
                  ...(onOpenAllChanges
                    ? [
                        {
                          title: t("harness.chrome.openAllChanges"),
                          icon: (
                            <FileDiff className="size-3.5" strokeWidth={1.75} />
                          ),
                          onClick: onOpenAllChanges,
                        },
                      ]
                    : []),
                  {
                    title:
                      view === "tree"
                        ? t("harness.chrome.viewAsList")
                        : t("harness.chrome.viewAsTree"),
                    icon:
                      view === "tree" ? (
                        <ListBullet className="size-3.5" strokeWidth={1.75} />
                      ) : (
                        <FolderTree className="size-3.5" strokeWidth={1.75} />
                      ),
                    onClick: toggleView,
                  },
                  {
                    title: t("harness.chrome.unstageAllChanges"),
                    icon: <Minus className="size-3.5" strokeWidth={1.75} />,
                    onClick: () => void runAll("unstage"),
                  },
                ]}
              >
                <ChangeList
                  files={staged}
                  view={view}
                  kind="staged"
                  activePath={selected}
                  busyPath={busy}
                  onOpenFile={onOpenFile}
                  onAction={run}
                />
              </FileSection>
            ) : null}
            {unstaged.length > 0 ? (
              <FileSection
                title={t("harness.chrome.changes")}
                count={unstaged.length}
                open={changesExpanded}
                onToggle={() => {
                  changesOpen = !changesExpanded;
                  setChangesExpanded(changesOpen);
                }}
                headerActions={[
                  ...(staged.length === 0 && onOpenAllChanges
                    ? [
                        {
                          title: t("harness.chrome.openAllChanges"),
                          icon: (
                            <FileDiff className="size-3.5" strokeWidth={1.75} />
                          ),
                          onClick: onOpenAllChanges,
                        },
                      ]
                    : []),
                  ...(staged.length === 0
                    ? [
                        {
                          title:
                            view === "tree"
                              ? t("harness.chrome.viewAsList")
                              : t("harness.chrome.viewAsTree"),
                          icon:
                            view === "tree" ? (
                              <ListBullet
                                className="size-3.5"
                                strokeWidth={1.75}
                              />
                            ) : (
                              <FolderTree
                                className="size-3.5"
                                strokeWidth={1.75}
                              />
                            ),
                          onClick: toggleView,
                        },
                      ]
                    : []),
                  {
                    title: t("harness.chrome.stageAllChanges"),
                    icon: <Plus className="size-3.5" strokeWidth={1.75} />,
                    onClick: () => void runAll("stage"),
                  },
                ]}
              >
                <ChangeList
                  files={unstaged}
                  view={view}
                  kind="unstaged"
                  activePath={selected}
                  busyPath={busy}
                  onOpenFile={onOpenFile}
                  onAction={run}
                />
              </FileSection>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

function usePrStatus(
  cwd: string,
  branch: string | null | undefined,
): { pr: GitPr | null; reload: () => void } {
  const [pr, setPr] = useState<GitPr | null>(() => cachedPr(cwd, branch));
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!cwd || cwd === "~" || !branch) {
      setPr(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      void gitPrStatus(cwd)
        .then((next) => {
          if (cancelled) return;
          prByCwd.set(cwd, next);
          setPr(next);
        })
        .catch(() => {
          if (cancelled) return;
          prByCwd.set(cwd, null);
          setPr(null);
        });
    };
    load();
    const onResume = () => load();
    window.addEventListener("focus", onResume);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onResume);
    };
  }, [branch, cwd, nonce]);

  return { pr, reload };
}

function cachedPr(
  cwd: string,
  branch: string | null | undefined,
): GitPr | null {
  if (!cwd || cwd === "~" || !branch) return null;
  return prByCwd.get(cwd) ?? null;
}

function syncStatusLabel(
  t: ReturnType<typeof useTranslation>["t"],
  index: GitDiffIndex,
): string {
  if (index.ahead > 0 && index.behind > 0) {
    return t("harness.chrome.divergedFrom", {
      upstream: index.upstream ?? "upstream",
    });
  }
  if (index.ahead > 0) {
    return t("harness.chrome.unpushedCommitCount", { count: index.ahead });
  }
  if (index.behind > 0) {
    return t("harness.chrome.incomingCommitCount", { count: index.behind });
  }
  return t("harness.chrome.noFiles");
}

function GitSyncActions({
  index,
  pr,
  busy,
  hasRemote,
  hasOpenPr,
  onDefault,
  canSync,
  canPublish,
  canCreatePr,
  canViewPr,
  onSync,
  onCreatePr,
  onViewPr,
}: {
  index: GitDiffIndex;
  pr: GitPr | null;
  busy: string | null;
  hasRemote: boolean;
  hasOpenPr: boolean;
  onDefault: boolean;
  canSync: boolean;
  canPublish: boolean;
  canCreatePr: boolean;
  canViewPr: boolean;
  onSync: () => void;
  onCreatePr: () => void;
  onViewPr: () => void;
}) {
  const { t } = useTranslation();
  if (!hasRemote) return null;
  const ahead = index.ahead;
  const behind = index.behind;
  const dest =
    index.upstream ?? `${index.remote ?? "origin"}/${index.branch ?? "HEAD"}`;
  const syncing = busy === "sync";
  const syncTitle = syncing
    ? t("harness.chrome.synchronizingChanges")
    : canPublish
      ? index.branch
        ? t("harness.chrome.publishBranchNamed", { branch: index.branch })
        : t("harness.chrome.publishBranch")
      : behind > 0 && ahead > 0
        ? t("harness.chrome.pullAndPushCommits", { ahead, behind, dest })
        : behind > 0
          ? t("harness.chrome.pullCommits", { count: behind, dest })
          : t("harness.chrome.pushCommits", { count: ahead, dest });
  const createTitle = index.defaultBranch
    ? t("harness.chrome.createPrInto", { branch: index.defaultBranch })
    : t("harness.chrome.createPr");
  const viewTitle = pr?.title
    ? t("harness.chrome.viewPrDetails", { number: pr.number, title: pr.title })
    : t("harness.chrome.viewPr");
  const btn =
    "flex h-7 w-full min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium disabled:opacity-40";
  const secondary = `${btn} bg-content/10 text-content hover:bg-content/15`;
  const showCreatePr = !hasOpenPr && !onDefault;
  const showViewPr = hasOpenPr;
  if (!canPublish && !canSync && !showCreatePr && !showViewPr) return null;

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {canPublish ? (
        <button
          type="button"
          title={syncTitle}
          disabled={!!busy}
          onClick={onSync}
          className={secondary}
        >
          {syncing ? (
            <Loader
              className="size-3.5 shrink-0 animate-spin"
              strokeWidth={1.75}
            />
          ) : (
            <CloudUpload className="size-3.5 shrink-0" strokeWidth={1.75} />
          )}
          <span className="min-w-0 truncate">
            {t("harness.chrome.publishBranch")}
          </span>
        </button>
      ) : canSync ? (
        <button
          type="button"
          title={syncTitle}
          disabled={!!busy}
          onClick={onSync}
          className={secondary}
        >
          <RefreshCw
            className={`size-3.5 shrink-0 ${syncing ? "animate-spin" : ""}`}
            strokeWidth={1.75}
          />
          <span className="min-w-0 truncate">
            {t("harness.chrome.syncChanges")}
          </span>
          {behind > 0 ? (
            <span className="shrink-0 tabular-nums text-content/55">
              ↓{behind}
            </span>
          ) : null}
          {ahead > 0 ? (
            <span className="shrink-0 tabular-nums text-content/55">
              ↑{ahead}
            </span>
          ) : null}
        </button>
      ) : null}
      {showCreatePr ? (
        <button
          type="button"
          title={createTitle}
          disabled={!canCreatePr || !!busy}
          onClick={onCreatePr}
          className={secondary}
        >
          {busy === "pr" ? (
            <Loader
              className="size-3.5 shrink-0 animate-spin"
              strokeWidth={1.75}
            />
          ) : (
            <GitPullRequest className="size-3.5 shrink-0" strokeWidth={1.75} />
          )}
          {t("harness.chrome.createPr")}
        </button>
      ) : null}
      {showViewPr ? (
        <button
          type="button"
          title={viewTitle}
          disabled={!canViewPr || !!busy}
          onClick={onViewPr}
          className={secondary}
        >
          <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 truncate">
            {pr?.number
              ? t("harness.chrome.viewPrNumber", { number: pr.number })
              : t("harness.chrome.viewPr")}
          </span>
        </button>
      ) : null}
    </div>
  );
}

function FileSection({
  title,
  count,
  open,
  onToggle,
  headerActions,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  headerActions?: { title: string; icon: ReactNode; onClick: () => void }[];
  children: ReactNode;
}) {
  return (
    <div>
      <div className="group flex h-7 items-center gap-1 px-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          {open ? (
            <ChevronDown
              className="size-3.5 shrink-0 text-content/50"
              strokeWidth={1.75}
            />
          ) : (
            <ChevronRight
              className="size-3.5 shrink-0 text-content/50"
              strokeWidth={1.75}
            />
          )}
          <span className="min-w-0 truncate text-[10px] font-semibold tracking-[0.04em] text-content/55 uppercase">
            {title}
          </span>
          <span className="ml-1 grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-accent/80 px-1 text-[8px] text-white">
            {count}
          </span>
        </button>
        {headerActions && headerActions.length > 0 ? (
          <div className="flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {headerActions.map((action, i) => (
              <IconAction key={i} title={action.title} onClick={action.onClick}>
                {action.icon}
              </IconAction>
            ))}
          </div>
        ) : null}
      </div>
      {open ? children : null}
    </div>
  );
}

type ChangeDir = {
  name: string;
  path: string;
  files: GitChangedFile[];
  dirs: Map<string, ChangeDir>;
};

function buildChangeTree(files: GitChangedFile[]): ChangeDir {
  const root: ChangeDir = { name: "", path: "", files: [], dirs: new Map() };
  for (const file of files) {
    const parts = file.relative.split("/").filter(Boolean);
    parts.pop();
    let curr = root;
    let currPath = "";
    for (const part of parts) {
      currPath = currPath ? `${currPath}/${part}` : part;
      let next = curr.dirs.get(part);
      if (!next) {
        next = { name: part, path: currPath, files: [], dirs: new Map() };
        curr.dirs.set(part, next);
      }
      curr = next;
    }
    curr.files.push(file);
  }
  return root;
}

function sortChangeDir(dir: ChangeDir) {
  dir.files.sort((a, b) =>
    basename(a.relative).localeCompare(basename(b.relative)),
  );
  for (const child of dir.dirs.values()) {
    sortChangeDir(child);
  }
}

function ChangeList({
  files,
  view,
  kind,
  activePath,
  busyPath,
  onOpenFile,
  onAction,
}: {
  files: GitChangedFile[];
  view: ChangesView;
  kind: "staged" | "unstaged";
  activePath?: string;
  busyPath: string | null;
  onOpenFile: (path: string) => void;
  onAction: (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
  ) => void;
}) {
  const tree = useMemo(() => {
    if (view !== "tree") return null;
    const root = buildChangeTree(files);
    sortChangeDir(root);
    return root;
  }, [files, view]);

  if (view === "tree" && tree) {
    return (
      <ChangeDirChildren
        dir={tree}
        depth={0}
        kind={kind}
        activePath={activePath}
        busyPath={busyPath}
        onOpenFile={onOpenFile}
        onAction={onAction}
      />
    );
  }

  return (
    <ul className="flex flex-col">
      {files.map((file) => (
        <ChangeRow
          key={`${kind}:${file.relative}`}
          file={file}
          active={activePath === file.relative}
          busy={busyPath === file.relative}
          kind={kind}
          tree={false}
          onOpenFile={onOpenFile}
          onAction={onAction}
        />
      ))}
    </ul>
  );
}

function ChangeDirChildren({
  dir,
  depth,
  kind,
  activePath,
  busyPath,
  onOpenFile,
  onAction,
}: {
  dir: ChangeDir;
  depth: number;
  kind: "staged" | "unstaged";
  activePath?: string;
  busyPath: string | null;
  onOpenFile: (path: string) => void;
  onAction: (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
  ) => void;
}) {
  const sortedDirs = Array.from(dir.dirs.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return (
    <ul className="flex flex-col">
      {sortedDirs.map((child) => (
        <ChangeDirRow
          key={child.path}
          dir={child}
          depth={depth}
          kind={kind}
          activePath={activePath}
          busyPath={busyPath}
          onOpenFile={onOpenFile}
          onAction={onAction}
        />
      ))}
      {dir.files.map((file) => (
        <ChangeRow
          key={`${kind}:${file.relative}`}
          file={file}
          active={activePath === file.relative}
          busy={busyPath === file.relative}
          kind={kind}
          tree={true}
          depth={depth}
          onOpenFile={onOpenFile}
          onAction={onAction}
        />
      ))}
    </ul>
  );
}

function ChangeDirRow({
  dir,
  depth,
  kind,
  activePath,
  busyPath,
  onOpenFile,
  onAction,
}: {
  dir: ChangeDir;
  depth: number;
  kind: "staged" | "unstaged";
  activePath?: string;
  busyPath: string | null;
  onOpenFile: (path: string) => void;
  onAction: (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
  ) => void;
}) {
  const key = `${kind}:${dir.path}`;
  const [open, setOpen] = useState(!collapsedDirs.has(key));

  const toggle = () => {
    if (open) collapsedDirs.add(key);
    else collapsedDirs.delete(key);
    setOpen(!open);
  };

  return (
    <li>
      <div
        style={{ paddingLeft: 8 + depth * 12 }}
        className="group flex h-7 w-full items-center gap-1 pr-2 leading-none text-content hover:bg-content/5"
      >
        <button
          type="button"
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          {open ? (
            <ChevronDown
              className="size-3.5 shrink-0 text-content/50"
              strokeWidth={1.75}
            />
          ) : (
            <ChevronRight
              className="size-3.5 shrink-0 text-content/50"
              strokeWidth={1.75}
            />
          )}
          <FileTypeIcon name={dir.name} isDir={true} isOpen={open} size={16} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-content/85">
            {dir.name}
          </span>
        </button>
      </div>
      {open ? (
        <ChangeDirChildren
          dir={dir}
          depth={depth + 1}
          kind={kind}
          activePath={activePath}
          busyPath={busyPath}
          onOpenFile={onOpenFile}
          onAction={onAction}
        />
      ) : null}
    </li>
  );
}

function ChangeRow({
  file,
  active,
  busy,
  kind,
  tree = false,
  depth = 0,
  onOpenFile,
  onAction,
}: {
  file: GitChangedFile;
  active: boolean;
  busy: boolean;
  kind: "staged" | "unstaged";
  tree?: boolean;
  depth?: number;
  onOpenFile: (path: string) => void;
  onAction: (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
  ) => void;
}) {
  const { t } = useTranslation();
  const name = basename(file.relative);
  const dir = dirname(file.relative);
  const canOpen = file.status !== "deleted";
  return (
    <li>
      <div
        style={tree ? { paddingLeft: 8 + depth * 12 } : undefined}
        className={`group flex h-7 w-full items-center gap-1 pr-2 leading-none ${
          tree ? "" : "px-2"
        } ${
          active
            ? "bg-content/10 text-content"
            : "text-content hover:bg-content/5"
        }`}
      >
        <button
          type="button"
          title={file.relative}
          onClick={() => {
            if (canOpen) onOpenFile(file.path);
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <FileTypeIcon name={name} isDir={false} size={16} />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-[13px] font-medium">{name}</span>
            {!tree && dir ? (
              <span className="ml-1.5 text-[11px] text-content/40">{dir}</span>
            ) : null}
          </span>
        </button>
        <div
          className={` shrink-0 items-center ${
            active ? "flex" : "hidden group-focus-within:flex group-hover:flex"
          }`}
        >
          {kind === "unstaged" ? (
            <IconAction
              title={t("harness.chrome.discardChanges")}
              disabled={busy}
              onClick={() => onAction(file, "discard")}
            >
              <Undo2 className="size-3.5" strokeWidth={1.75} />
            </IconAction>
          ) : null}
          {kind === "staged" ? (
            <IconAction
              title={t("harness.chrome.unstageChanges")}
              disabled={busy}
              onClick={() => onAction(file, "unstage")}
            >
              <Minus className="size-3.5" strokeWidth={1.75} />
            </IconAction>
          ) : (
            <IconAction
              title={t("harness.chrome.stageChanges")}
              disabled={busy}
              onClick={() => onAction(file, "stage")}
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
            </IconAction>
          )}
        </div>
        <span
          className={`w-3.5 shrink-0 text-right font-mono text-[11px] font-semibold ${statusColor(file.status)}`}
        >
          {statusLetter(file.status)}
        </span>
      </div>
    </li>
  );
}

function IconAction({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="grid size-5 place-items-center rounded text-content/55 hover:bg-content/10 hover:text-content disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function DiffCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions <= 0 && deletions <= 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-semibold tabular-nums">
      {additions > 0 ? (
        <span className="text-emerald-400">+{additions}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-red-400">-{deletions}</span>
      ) : null}
    </span>
  );
}

function dirname(relative: string): string {
  const i = relative.lastIndexOf("/");
  return i > 0 ? relative.slice(0, i) : "";
}

function statusLetter(status: string): string {
  if (status === "untracked") return "U";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  return "M";
}

function statusColor(status: string): string {
  if (status === "untracked") return "text-sky-400";
  if (status === "added") return "text-emerald-400";
  if (status === "deleted") return "text-red-400";
  return "text-amber-400";
}

function useDiffIndex(
  cwd: string,
  enabled: boolean,
): {
  index: GitDiffIndex | null;
  reload: () => void;
} {
  const [index, setIndex] = useState<GitDiffIndex | null>(
    () => cachedIndex(cwd),
  );
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    if (!enabled || !cwd || cwd === "~") {
      return;
    }
    const cached = cachedIndex(cwd);
    if (cached && !sameIndex(indexRef.current, cached)) {
      indexRef.current = cached;
      setIndex(cached);
    }
    let cancelled = false;
    let inFlight = false;
    let pending = false;

    const load = async () => {
      if (inFlight) {
        pending = true;
        return;
      }
      if (document.hidden && nonce === 0) return;
      inFlight = true;
      try {
        const next = await gitDiffIndex(cwd);
        if (cancelled) return;
        const prev = indexRef.current;
        if (sameIndex(prev, next)) return;
        indexByCwd.set(cwd, next);
        indexRef.current = next;
        setIndex(next);
        applyProjectDiffStats(cwd, {
          files: next.files.length,
          additions: next.additions,
          deletions: next.deletions,
        });
        if (prev) {
          const paths = changedFilePaths(prev, next);
          invalidateWatchedFiles(paths);
          notifyGitChanged();
        }
      } catch {
        if (!cancelled) {
          indexByCwd.delete(cwd);
          setIndex(null);
        }
      } finally {
        inFlight = false;
        if (pending && !cancelled) {
          pending = false;
          void load();
        }
      }
    };

    void load();
    const onResume = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(onResume, GIT_POLL_MS);
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    const unsubGit = subscribeGitChanged(onResume);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      unsubGit();
    };
  }, [cwd, enabled, nonce]);

  return { index, reload };
}

function cachedIndex(cwd: string | undefined): GitDiffIndex | null {
  if (!cwd || cwd === "~") return null;
  return indexByCwd.get(cwd) ?? null;
}

function changedFilePaths(prev: GitDiffIndex, next: GitDiffIndex): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const previous = new Map(prev.files.map((file) => [file.relative, file]));
  const current = new Set(next.files.map((file) => file.relative));
  for (const file of next.files) {
    const before = previous.get(file.relative);
    if (
      !before ||
      before.status !== file.status ||
      before.additions !== file.additions ||
      before.deletions !== file.deletions ||
      before.staged !== file.staged ||
      before.unstaged !== file.unstaged
    ) {
      paths.push(file.path);
      seen.add(file.path);
    }
  }
  for (const file of prev.files) {
    if (!current.has(file.relative) && !seen.has(file.path)) {
      paths.push(file.path);
    }
  }
  return paths;
}

function sameIndex(prev: GitDiffIndex | null, next: GitDiffIndex): boolean {
  if (!prev) return false;
  if (
    prev.branch !== next.branch ||
    prev.additions !== next.additions ||
    prev.deletions !== next.deletions ||
    prev.files.length !== next.files.length ||
    prev.remote !== next.remote ||
    prev.upstream !== next.upstream ||
    prev.defaultBranch !== next.defaultBranch ||
    prev.ahead !== next.ahead ||
    prev.behind !== next.behind ||
    prev.aheadOfDefault !== next.aheadOfDefault
  ) {
    return false;
  }
  return prev.files.every((file, i) => {
    const other = next.files[i];
    return (
      other &&
      file.relative === other.relative &&
      file.status === other.status &&
      file.additions === other.additions &&
      file.deletions === other.deletions &&
      file.staged === other.staged &&
      file.unstaged === other.unstaged
    );
  });
}
