import {
  Check,
  CircleAlert,
  GitBranch,
  ListFilter,
  Plus,
  Search,
} from "lucide-react";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  loadSidebarTabOrder,
  saveSidebarTabOrder,
  type SidebarLayout,
  type SidebarTabId,
} from "../lib/appearance";
import { basename } from "../lib/fs";
import { IS_MAC, MOD } from "../lib/platform";
import { resolveModel } from "../lib/models";
import { projectName } from "../lib/paths";
import { sessionDisplayTitle } from "../lib/session";
import { nextUnseenFinishedSessions } from "../lib/sessionDone";
import {
  filterSessionsByArchive,
  filterSessionsByQuery,
} from "../lib/sessionHistory";
import {
  filterSessionsByHarness,
  filterSessionsByStatus,
  filterSessionsByTime,
  harnessesInSessions,
  hasActiveSessionFilters,
  loadSessionSidebarFilters,
  saveSessionSidebarFilters,
  type SessionSidebarFilters,
} from "../lib/sessionFilters";
import type { HarnessId } from "../lib/session";
import type { SessionSummary } from "../lib/sessionStore";
import { resolveTabGroupLogo } from "../lib/tabGroups";
import { useGitFileStatuses } from "../hooks/useGitFileStatuses";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useProjectDiffStats } from "../hooks/useProjectDiffStats";
import { useSessionDiffStats } from "../hooks/useSessionDiffStats";
import { useSortable } from "../hooks/useSortable";
import { useTabGroupLogos } from "../hooks/useTabGroupLogos";
import type { RecentProject } from "../lib/recents";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { FileTree } from "./FileTree";
import { FileTypeIcon } from "./FileTypeIcon";
import { HarnessIcon } from "./HarnessIcon";
import { ProjectRail } from "./ProjectRail";
import { TerminalSpinner } from "./TerminalSpinner";
import { IconButton, TabVisitNav } from "./TitleBar";
import { ProjectSearch } from "./ProjectSearch";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { SessionFiltersMenu } from "./SessionFiltersMenu";
import { SourceControl } from "./SourceControl";

const MIN_WIDTH = 160;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 260;

let rememberedWidth = DEFAULT_WIDTH;

type SidebarTab = SidebarTabId;

const TAB_LABELS: Record<SidebarTab, string> = {
  sessions: "Sessions",
  files: "Explorer",
  changes: "Changes",
};

type Props = {
  cwd: string;
  open: boolean;
  layout: SidebarLayout;
  sessions: SessionSummary[];
  busySessionIds: Set<string>;
  approvalSessionIds: Set<string>;
  activeSessionId?: string;
  status: "idle" | "loading" | "error";
  onSelectSession: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, title: string) => void;
  onArchiveSession?: (sessionId: string, archived: boolean) => void;
  onDeleteSession?: (sessionId: string) => void;
  onOpenFile: (path: string) => void;
  onOpenTerminal?: (cwd: string) => void;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  filesSearchOpen: boolean;
  onFilesSearchOpenChange: (open: boolean) => void;
  onOpenFilesSearch?: () => void;
  searchFocusToken?: number;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onOpenDiff?: (path: string) => void;
  selectedDiffPath?: string;
  textHarness?: HarnessId;
  onShowSourceControl?: () => void;
  recents?: RecentProject[];
  busyProjectPaths?: Iterable<string>;
  onSelectProject?: (path: string) => void;
  onOpenProject?: () => void;
  onNew?: () => void;
  onSearch?: () => void;
  onGoToFile?: () => void;
  searchActive?: boolean;
  onToggleProjectRail?: () => void;
  projectRailOpen?: boolean;
  unseenFinishedIds?: Set<string>;
};

function SidebarComponent({
  cwd,
  open,
  layout,
  sessions,
  busySessionIds,
  approvalSessionIds,
  activeSessionId,
  status,
  onSelectSession,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
  onOpenFile,
  onOpenTerminal,
  onFileMoved,
  onFileDeleted,
  tab,
  onTabChange,
  filesSearchOpen,
  onFilesSearchOpenChange,
  onOpenFilesSearch,
  searchFocusToken = 0,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  onOpenDiff,
  selectedDiffPath,
  textHarness,
  onShowSourceControl,
  recents = [],
  busyProjectPaths,
  onSelectProject,
  onOpenProject,
  onNew,
  onSearch,
  onGoToFile,
  searchActive = false,
  onToggleProjectRail,
  projectRailOpen = true,
  unseenFinishedIds: unseenFinishedIdsProp,
}: Props) {
  const [width, setWidth] = useState(rememberedWidth);
  const [dragging, setDragging] = useState(false);
  const [tabOrder, setTabOrder] = useState<SidebarTab[]>(loadSidebarTabOrder);
  const [now, setNow] = useState(() => Date.now());
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const widthRef = useRef(width);
  const pendingWidth = useRef(width);
  const resizeFrame = useRef<number | null>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const sessionsLock = useLockOverscroll<HTMLDivElement>();
  const sessionsScrollRef = useRef<HTMLDivElement>(null);
  const [sessionMenu, setSessionMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null,
  );
  const [sessionFilters, setSessionFilters] = useState(
    loadSessionSidebarFilters,
  );
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deckLayout = layout === "deck";
  const busyIdsRef = useRef(busySessionIds);
  const focusedSessionIdRef = useRef(activeSessionId);
  const unseenFinishedLocalRef = useRef<Set<string>>(new Set());
  if (
    busyIdsRef.current !== busySessionIds ||
    focusedSessionIdRef.current !== activeSessionId
  ) {
    unseenFinishedLocalRef.current = nextUnseenFinishedSessions({
      previousBusyIds: busyIdsRef.current,
      busyIds: busySessionIds,
      previousUnseenIds: unseenFinishedLocalRef.current,
      focusedSessionId: activeSessionId,
    });
    busyIdsRef.current = busySessionIds;
    focusedSessionIdRef.current = activeSessionId;
  }
  const unseenFinishedIds =
    unseenFinishedIdsProp ?? unseenFinishedLocalRef.current;
  const visibleSessions = filterSessionsByQuery(
    filterSessionsByStatus(
      filterSessionsByTime(
        filterSessionsByHarness(
          filterSessionsByArchive(sessions, sessionFilters.showArchived),
          sessionFilters.hiddenHarnesses,
        ),
        sessionFilters.time,
        now,
      ),
      sessionFilters.status,
      busySessionIds,
      approvalSessionIds,
      unseenFinishedIds,
    ),
    deckLayout || searchOpen ? searchQuery : "",
  );
  const sessionHarnesses = harnessesInSessions(sessions);
  const filtersActive = hasActiveSessionFilters(sessionFilters);
  const sortable = useSortable(tabOrder, (ids) => {
    const next = ids as SidebarTab[];
    setTabOrder(next);
    saveSidebarTabOrder(next);
    if (next[0]) onTabChange(next[0]);
  });
  const visibleTabs = deckLayout
    ? tabOrder
    : tabOrder.filter((itemId) => itemId !== "changes");
  const canDragTabs = visibleTabs.length > 1;
  const showProjectRail =
    deckLayout && Boolean(onSelectProject && onOpenProject);
  const railVisible = showProjectRail && projectRailOpen;
  const sidebarVisible = open && !searchActive;
  const gitStatuses = useGitFileStatuses(cwd, open && tab === "files");
  const changeStats = useProjectDiffStats(cwd, open);
  const groupLogos = useTabGroupLogos();
  const projectLogoPath = resolveTabGroupLogo(projectName(cwd), groupLogos);
  const sessionDiffs = useSessionDiffStats(
    cwd,
    sessions.map((session) => session.id),
    open && tab === "sessions",
  );

  useEffect(() => {
    if (tab !== "sessions") return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [tab]);

  useEffect(() => {
    if (tab !== "sessions") {
      setFilterMenu(null);
      setSearchOpen(false);
      setSearchQuery("");
    }
  }, [tab]);

  useEffect(() => {
    if (!sessionMenu && !filterMenu) return;
    const onScroll = () => {
      setSessionMenu(null);
      setFilterMenu(null);
    };
    const scrollParent = sessionsScrollRef.current ?? window;
    scrollParent.addEventListener("scroll", onScroll, true);
    return () => scrollParent.removeEventListener("scroll", onScroll, true);
  }, [sessionMenu, filterMenu]);

  const menuSession = sessionMenu
    ? sessions.find((session) => session.id === sessionMenu.sessionId)
    : undefined;
  const sessionMenuItems: ExplorerMenuItem[] = [
    ...(onRenameSession
      ? [
          {
            kind: "item" as const,
            id: "rename",
            label: "Rename",
            shortcut: "F2",
          },
        ]
      : []),
    ...(onArchiveSession || onDeleteSession
      ? [
          ...(onRenameSession ? [{ kind: "sep" as const }] : []),
          ...(onArchiveSession
            ? [
                {
                  kind: "item" as const,
                  id: "archive",
                  label: menuSession?.archived ? "Unarchive" : "Archive",
                },
              ]
            : []),
          ...(onDeleteSession
            ? [
                {
                  kind: "item" as const,
                  id: "delete",
                  label: "Delete",
                  shortcut: "⌫",
                  danger: true,
                },
              ]
            : []),
        ]
      : []),
  ];

  const onSessionContextMenu = (
    sessionId: string,
    e: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (!onRenameSession && !onArchiveSession && !onDeleteSession) return;
    e.preventDefault();
    e.stopPropagation();
    setFilterMenu(null);
    setSessionMenu({ x: e.clientX, y: e.clientY, sessionId });
  };

  const onSessionMenuPick = (id: string) => {
    if (!sessionMenu) return;
    const sessionId = sessionMenu.sessionId;
    const archived = !!menuSession?.archived;
    setSessionMenu(null);
    if (id === "rename") {
      setRenamingSessionId(sessionId);
      return;
    }
    if (id === "archive") {
      onArchiveSession?.(sessionId, !archived);
      return;
    }
    if (id === "delete") onDeleteSession?.(sessionId);
  };

  const onSessionFiltersChange = (next: SessionSidebarFilters) => {
    setSessionFilters(next);
    saveSessionSidebarFilters(next);
  };

  const onToggleSessionSearch = () => {
    setFilterMenu(null);
    setSearchOpen((open) => {
      if (open) setSearchQuery("");
      return !open;
    });
  };

  const onFilterButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (filterMenu) {
      setFilterMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setSessionMenu(null);
    setFilterMenu({
      x: rect.right - 228,
      y: rect.bottom + 2,
    });
  };

  const sessionSearchInput = (
    <input
      ref={searchInputRef}
      type="text"
      value={searchQuery}
      placeholder="Search conversations..."
      aria-label="Search conversations"
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      onChange={(event) => setSearchQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (searchQuery) {
          setSearchQuery("");
          return;
        }
        if (!deckLayout) setSearchOpen(false);
      }}
      className={
        deckLayout
          ? "h-full w-full min-w-0 rounded-md bg-transparent py-0 pl-7 pr-2 text-[12px] text-content outline-none placeholder:text-content/35"
          : "w-full px-3 py-2 text-[12px] text-content outline-none placeholder:text-content/35"
      }
    />
  );

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);

  const clamp = (value: number) => {
    const max = Math.min(MAX_WIDTH, Math.floor(window.innerWidth * 0.5));
    return Math.min(max, Math.max(MIN_WIDTH, Math.round(value)));
  };

  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.cursor = previous;
    };
  }, [dragging]);

  useEffect(
    () => () => {
      if (resizeFrame.current != null) {
        cancelAnimationFrame(resizeFrame.current);
      }
    },
    [],
  );

  const paintWidth = (next: number) => {
    pendingWidth.current = next;
    if (resizeFrame.current != null) return;
    resizeFrame.current = requestAnimationFrame(() => {
      resizeFrame.current = null;
      rememberedWidth = pendingWidth.current;
      if (asideRef.current) {
        asideRef.current.style.width = `${pendingWidth.current}px`;
      }
    });
  };

  const commitWidth = () => {
    if (resizeFrame.current != null) {
      cancelAnimationFrame(resizeFrame.current);
      resizeFrame.current = null;
    }
    const next = pendingWidth.current;
    rememberedWidth = next;
    widthRef.current = next;
    if (asideRef.current) asideRef.current.style.width = `${next}px`;
    setWidth(next);
  };

  const onResizePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startW: widthRef.current };
    pendingWidth.current = widthRef.current;
    setDragging(true);
  };

  const onResizePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = clamp(drag.current.startW + (e.clientX - drag.current.startX));
    paintWidth(next);
  };

  const onResizePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    commitWidth();
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onResizeDoubleClick = () => {
    pendingWidth.current = DEFAULT_WIDTH;
    commitWidth();
  };

  const onTabPick = (itemId: SidebarTab) => {
    onTabChange(itemId);
  };

  const workspaceTabItems = visibleTabs.map((itemId, index) => {
    const active = tab === itemId;
    const changeCount = changeStats?.files ?? 0;
    const showChangeBadge = itemId === "changes" && changeCount > 0;
    const draggingTab = sortable.draggingId === itemId;
    const showStart =
      sortable.draggingId &&
      sortable.toIndex === index &&
      sortable.fromIndex !== null &&
      sortable.toIndex < sortable.fromIndex;
    const showEnd =
      sortable.draggingId &&
      sortable.toIndex === index &&
      sortable.fromIndex !== null &&
      sortable.toIndex > sortable.fromIndex;
    return (
      <div
        key={itemId}
        ref={(el) => sortable.setItemRef(itemId, el)}
        className={`relative flex min-w-0 flex-1 touch-none items-stretch ${
          draggingTab ? "opacity-40" : ""
        } ${canDragTabs ? "cursor-grab active:cursor-grabbing" : ""}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          onTabPick(itemId);
          sortable.onItemPointerDown(itemId, event);
        }}
      >
        {showStart ? (
          <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-0.5 bg-accent" />
        ) : null}
        {showEnd ? (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-0.5 bg-accent" />
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={active}
          data-tauri-drag-region="false"
          onClick={() => {
            if (sortable.consumeClick()) return;
            onTabPick(itemId);
          }}
          className={`relative flex min-w-0 flex-1 items-center justify-center px-1 text-[12px] leading-none ${
            deckLayout ? "h-full" : "h-9"
          } ${
            canDragTabs ? "cursor-grab active:cursor-grabbing" : ""
          } ${
            active
              ? "text-content bg-content/10"
              : "text-content/50 hover:text-content"
          }`}
        >
          <span className="relative inline-block min-w-0 max-w-full">
            <span
              className={`block truncate${showChangeBadge ? " pr-2.5" : ""}`}
            >
              {TAB_LABELS[itemId]}
            </span>
            {showChangeBadge ? (
              <span
                aria-hidden
                className="pointer-events-none absolute top-0 left-[calc(100%-4px)] grid min-h-3.5 min-w-3.5 place-items-center rounded-full bg-accent px-0.5 text-[7px] font-semibold leading-none text-white tabular-nums"
              >
                {changeCount > 99 ? "99+" : changeCount}
              </span>
            ) : null}
          </span>
          {active ? (
            <span className="absolute inset-x-0 bottom-0 h-px bg-content" />
          ) : null}
        </button>
      </div>
    );
  });

  const sidebarContent = (
    <aside
      ref={asideRef}
      style={{ width }}
      className="sidebar-glass relative flex h-full min-h-0 shrink-0 flex-col border-r border-content/10"
    >
      {deckLayout && railVisible ? (
        <>
          <div
            className="flex h-10 shrink-0 items-center gap-1 border-b border-content/10 pl-3 pr-1.5"
            data-tauri-drag-region
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
              Workspace
            </span>
            <WorkspaceTitleActions onSearch={onGoToFile} onNew={onNew} />
          </div>
          <div
            role="tablist"
            aria-label="Workspace"
            className="flex h-9 shrink-0 items-stretch border-b border-content/10"
          >
            {workspaceTabItems}
          </div>
        </>
      ) : (
        <>
          {deckLayout ? (
            <div
              className="flex h-10 shrink-0 items-center pr-1.5"
              data-tauri-drag-region
            >
              {IS_MAC ? (
                <div className="w-[78px] shrink-0" data-tauri-drag-region />
              ) : null}
              <div className="min-w-0 flex-1" data-tauri-drag-region />
              <TabVisitNav
                canGoBack={canGoBack}
                canGoForward={canGoForward}
                onGoBack={onGoBack}
                onGoForward={onGoForward}
                onTogglePanel={onToggleProjectRail}
                panelActive={false}
              />
            </div>
          ) : (
            <div
              className="flex h-9.75 shrink-0 items-center justify-end pr-1.5"
              data-tauri-drag-region
            >
              <TabVisitNav
                canGoBack={canGoBack}
                canGoForward={canGoForward}
                onGoBack={onGoBack}
                onGoForward={onGoForward}
              />
            </div>
          )}
          <div
            role="tablist"
            aria-label="Workspace"
            className={`flex shrink-0 overflow-visible border-content/10 ${
              deckLayout ? "h-10 items-stretch border-y" : "border-y"
            }`}
          >
            {workspaceTabItems}
          </div>
        </>
      )}
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
          tab === "files" ? "" : "hidden"
        }`}
      >
        {filesSearchOpen ? (
          <ProjectSearch
            cwd={cwd}
            focusToken={searchFocusToken}
            onOpenFile={onOpenFile}
            onClose={() => onFilesSearchOpenChange(false)}
          />
        ) : cwd && cwd !== "~" ? (
          <div
            ref={lockOverscroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none"
          >
            <FileTree
              key={cwd}
              cwd={cwd}
              deckLayout={deckLayout}
              onOpenFile={onOpenFile}
              onOpenTerminal={onOpenTerminal}
              onFileMoved={onFileMoved}
              onFileDeleted={onFileDeleted}
              onSearch={onOpenFilesSearch}
              gitStatuses={gitStatuses}
              sourceControlActive={open && tab === "changes"}
              onShowSourceControl={onShowSourceControl}
            />
          </div>
        ) : (
          <p className="px-3 py-2 text-[12px] text-content/50">
            No project folder
          </p>
        )}
      </div>
      {deckLayout && tab === "sessions" && cwd && cwd !== "~" ? (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-content/10 px-2">
          <div className="relative flex h-7 min-w-0 flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 size-3 shrink-0 opacity-50" />
            {sessionSearchInput}
          </div>
          <SessionsHeaderButton
            label="Filter sessions"
            active={filtersActive}
            open={!!filterMenu}
            hasPopup
            onClick={onFilterButtonClick}
          >
            <ListFilter className="size-3" strokeWidth={1.75} />
          </SessionsHeaderButton>
        </div>
      ) : null}
      <div
        ref={(el) => {
          sessionsLock(el);
          sessionsScrollRef.current = el;
        }}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-none ${
          tab === "sessions" ? "" : "hidden"
        }`}
      >
        {!cwd || cwd === "~" ? (
          <p className="px-3 py-2 text-[12px] text-content/50">
            No project folder
          </p>
        ) : (
          <div>
            {!deckLayout ? (
              <div className="sticky top-0 z-10 shrink-0 border-b border-content/10 bg-content/5 backdrop-blur-md">
                <div className="flex h-9 items-center px-2 pr-1.5">
                  <div
                    title={cwd}
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5"
                  >
                    {projectLogoPath ? (
                      <ProjectLogoIcon
                        path={projectLogoPath}
                        className="size-4 shrink-0 rounded-sm ml-1.5"
                        imageClassName="size-4"
                      />
                    ) : (
                      <span className="grid size-6 shrink-0 place-items-center">
                        <FileTypeIcon name={basename(cwd)} isDir isRoot />
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-[0.08em] text-content/50 uppercase">
                      {basename(cwd)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-px">
                    <SessionsHeaderButton
                      label="Search conversations"
                      active={searchOpen}
                      open={searchOpen}
                      onClick={onToggleSessionSearch}
                    >
                      <Search className="size-3" strokeWidth={1.75} />
                    </SessionsHeaderButton>
                    <SessionsHeaderButton
                      label="Filter sessions"
                      active={filtersActive}
                      open={!!filterMenu}
                      hasPopup
                      onClick={onFilterButtonClick}
                    >
                      <ListFilter className="size-3" strokeWidth={1.75} />
                    </SessionsHeaderButton>
                  </div>
                </div>
                {searchOpen ? (
                  <div className="relative flex items-center border-y border-content/10 pl-3.5">
                    <Search className="size-3 opacity-50" />
                    {sessionSearchInput}
                  </div>
                ) : null}
              </div>
            ) : null}
            {status === "loading" && sessions.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-content/50">Loading…</p>
            ) : status === "error" && sessions.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-content/50">
                Couldn’t load sessions
              </p>
            ) : visibleSessions.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-content/50">
                {(deckLayout || searchOpen) && searchQuery.trim()
                  ? "No matching sessions"
                  : filtersActive
                    ? "No sessions match these filters"
                    : "No sessions yet"}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5 p-1.5">
                {visibleSessions.map((session) => (
                  <li key={session.id}>
                    {renamingSessionId === session.id && onRenameSession ? (
                      <SessionRenameRow
                        session={session}
                        isActive={session.id === activeSessionId}
                        busy={busySessionIds.has(session.id)}
                        needsApproval={approvalSessionIds.has(session.id)}
                        onCommit={(title) => {
                          onRenameSession(session.id, title);
                          setRenamingSessionId(null);
                        }}
                        onCancel={() => setRenamingSessionId(null)}
                      />
                    ) : (
                      <SessionCard
                        session={session}
                        isActive={session.id === activeSessionId}
                        busy={busySessionIds.has(session.id)}
                        done={unseenFinishedIds.has(session.id)}
                        needsApproval={approvalSessionIds.has(session.id)}
                        now={now}
                        additions={sessionDiffs[session.id]?.additions ?? 0}
                        deletions={sessionDiffs[session.id]?.deletions ?? 0}
                        onSelect={onSelectSession}
                        onContextMenu={
                          onRenameSession || onArchiveSession || onDeleteSession
                            ? (e) => onSessionContextMenu(session.id, e)
                            : undefined
                        }
                        onRename={
                          onRenameSession
                            ? () => setRenamingSessionId(session.id)
                            : undefined
                        }
                        onDelete={
                          onDeleteSession
                            ? () => onDeleteSession(session.id)
                            : undefined
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {deckLayout && tab === "changes" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <SourceControl
            cwd={cwd}
            enabled={open}
            textHarness={textHarness}
            selectedPath={selectedDiffPath}
            onOpenFile={onOpenDiff ?? onOpenFile}
          />
        </div>
      ) : null}
      {sessionMenu ? (
        <ExplorerMenu
          x={sessionMenu.x}
          y={sessionMenu.y}
          items={sessionMenuItems}
          ariaLabel="Session actions"
          onPick={onSessionMenuPick}
          onClose={() => setSessionMenu(null)}
        />
      ) : null}
      {filterMenu ? (
        <SessionFiltersMenu
          x={filterMenu.x}
          y={filterMenu.y}
          harnesses={sessionHarnesses}
          filters={sessionFilters}
          onChange={onSessionFiltersChange}
          onClose={() => setFilterMenu(null)}
        />
      ) : null}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        className={`absolute inset-y-0 -right-px z-10 w-1.5 cursor-col-resize touch-none ${
          dragging ? "bg-content/15" : "hover:bg-content/10"
        }`}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        onDoubleClick={onResizeDoubleClick}
      />
    </aside>
  );

  return (
    <div
      className={`flex h-full shrink-0 ${
        railVisible || sidebarVisible ? "" : "hidden"
      }`}
    >
      {railVisible && onSelectProject && onOpenProject ? (
        <ProjectRail
          cwd={cwd}
          recents={recents}
          busyPaths={busyProjectPaths}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onGoBack={onGoBack}
          onGoForward={onGoForward}
          onNew={onNew}
          onSearch={onSearch}
          searchActive={searchActive}
          onTogglePanel={onToggleProjectRail}
          onSelectProject={onSelectProject}
          onOpenProject={onOpenProject}
        />
      ) : null}
      {sidebarVisible ? sidebarContent : null}
    </div>
  );
}

export const Sidebar = memo(SidebarComponent);

function WorkspaceTitleActions({
  onSearch,
  onNew,
}: {
  onSearch?: () => void;
  onNew?: () => void;
}) {
  if (!onSearch && !onNew) return null;
  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      data-tauri-drag-region="false"
    >
      {onSearch ? (
        <IconButton label={`Go to File (${MOD}P)`} onClick={onSearch}>
          <Search className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      ) : null}
      {onNew ? (
        <IconButton label={`New session (${MOD}T)`} onClick={onNew}>
          <Plus className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      ) : null}
    </div>
  );
}

function SessionsHeaderButton({
  label,
  active = false,
  open = false,
  hasPopup = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  open?: boolean;
  hasPopup?: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={open}
      aria-haspopup={hasPopup ? "menu" : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={`relative z-50 grid size-6 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content ${
        open || active ? "bg-content/10 text-content" : ""
      }`}
    >
      {children}
    </button>
  );
}

function SessionCard({
  session,
  isActive,
  busy,
  done,
  needsApproval,
  now,
  additions,
  deletions,
  onSelect,
  onContextMenu,
  onRename,
  onDelete,
}: {
  session: SessionSummary;
  isActive: boolean;
  busy: boolean;
  done: boolean;
  needsApproval: boolean;
  now: number;
  additions: number;
  deletions: number;
  onSelect: (sessionId: string) => void;
  onContextMenu?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const title = sessionDisplayTitle(session.title, session.harness);
  const gitLabel = formatGitLabel(session.repo, session.branch);
  const time = formatRelative(session.updatedAt, now);
  const model = resolveModel(session.harness, session.model).name;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "F2" && onRename) {
      e.preventDefault();
      onRename();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && onDelete) {
      e.preventDefault();
      onDelete();
    }
  };

  return (
    <button
      type="button"
      title={title}
      aria-current={isActive ? "true" : undefined}
      onClick={() => onSelect(session.id)}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      className={`border flex w-full flex-col rounded-md px-2.5 py-2 text-left ${
        needsApproval
          ? "bg-content/20 text-content border-content/30 border-dashed"
          : isActive
            ? "bg-content/10 text-content border-transparent"
            : "text-content/80 hover:bg-content/5 hover:text-content border-transparent"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <HarnessIcon
            harness={session.harness}
            className="size-3.5 shrink-0"
          />
          <span className="min-w-0 truncate text-[11px] text-content/50">
            {model}
          </span>
        </span>
        <span
          className={`flex shrink-0 items-center gap-1 text-[11px] tabular-nums ${
            needsApproval
              ? "text-amber-400"
              : busy
                ? "text-accent"
                : done
                  ? "text-emerald-400"
                  : "text-content/45"
          }`}
        >
          {needsApproval ? (
            <>
              <CircleAlert className="size-3" strokeWidth={1.75} />
              <span>Need approval</span>
            </>
          ) : busy ? (
            <>
              <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none text-accent" />
              <span>Working...</span>
            </>
          ) : done ? (
            <>
              <Check className="size-3" strokeWidth={2.25} />
              <span>Done</span>
            </>
          ) : (
            <span>{time}</span>
          )}
        </span>
      </span>
      <span className="mt-1 line-clamp-1 text-[13px] font-semibold leading-snug text-content">
        {title}
      </span>
      <span className="mt-1 flex items-center gap-2">
        {gitLabel ? (
          <span className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-content/45">
            <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 truncate">{gitLabel}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <span className="flex shrink-0 items-center gap-1.5">
          <DiffStat additions={additions} deletions={deletions} />
          <HarnessIcon
            harness={session.harness}
            className="size-3.5 shrink-0"
          />
        </span>
      </span>
    </button>
  );
}

function SessionRenameRow({
  session,
  isActive,
  busy,
  needsApproval,
  onCommit,
  onCancel,
}: {
  session: SessionSummary;
  isActive: boolean;
  busy: boolean;
  needsApproval: boolean;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(() =>
    sessionDisplayTitle(session.title, session.harness),
  );

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const finish = (success: boolean) => {
    if (finished.current) return;
    if (success) {
      const trimmed = value.trim();
      if (!trimmed) {
        onCancel();
        return;
      }
      finished.current = true;
      onCommit(trimmed);
      return;
    }
    finished.current = true;
    onCancel();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  };

  return (
    <div
      className={`flex w-full flex-col rounded-md px-2.5 py-2 ${
        needsApproval
          ? "bg-amber-400/10 text-content"
          : isActive
            ? "bg-content/10 text-content"
            : "text-content/80"
      }`}
    >
      <input
        ref={inputRef}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded bg-content/10 px-2 py-1 text-[13px] font-semibold leading-snug text-content outline-none ring-1 ring-accent/40"
      />
    </div>
  );
}

function DiffStat({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions <= 0 && deletions <= 0) return null;

  const label = [
    additions > 0 ? `+${additions}` : "",
    deletions > 0 ? `-${deletions}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      title={`${label} uncommitted`}
      className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-semibold tabular-nums"
    >
      {additions > 0 ? (
        <span className="text-emerald-400">+{additions}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-red-400">-{deletions}</span>
      ) : null}
    </span>
  );
}

function formatGitLabel(repo?: string, branch?: string): string {
  if (repo && branch) return `${repo}/${branch}`;
  return branch || repo || "";
}

function formatRelative(value: number, now: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}
