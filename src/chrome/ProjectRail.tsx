import {
  Inbox,
  Pin,
  PinOff,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useSortable } from "../hooks/useSortable";
import { useTabGroupLogos } from "../hooks/useTabGroupLogos";
import {
  loadProjectRailWidth,
  PROJECT_RAIL_WIDTH_DEFAULT,
  PROJECT_RAIL_WIDTH_MAX,
  PROJECT_RAIL_WIDTH_MIN,
  saveProjectRailWidth,
} from "../lib/appearance";
import { basename } from "../lib/fs";
import { IS_MAC } from "../lib/platform";
import { projectName } from "../lib/paths";
import {
  collectRailProjects,
  loadPinnedProjects,
  loadProjectRailOrder,
  projectRailSections,
  sameProjectPath,
  savePinnedProjects,
  saveProjectRailOrder,
  syncProjectRailOrder,
  type RecentProject,
} from "../lib/recents";
import { resolveTabGroupLogo } from "../lib/tabGroups";
import { FileTypeIcon } from "./FileTypeIcon";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { TerminalSpinner } from "./TerminalSpinner";
import { TabVisitNav } from "./TitleBar";
import { SidebarUpdate } from "./SidebarUpdate";

type Props = {
  cwd: string;
  recents: RecentProject[];
  busyPaths?: Iterable<string>;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onNew?: () => void;
  onSearch?: () => void;
  onInbox?: () => void;
  inboxOpen?: boolean;
  inboxCount?: number;
  onSelectProject: (path: string) => void;
  onOpenProject: () => void;
};

export function ProjectRail({
  cwd,
  recents,
  busyPaths,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  onNew,
  onSearch,
  onInbox,
  inboxOpen = false,
  inboxCount = 0,
  onSelectProject,
  onOpenProject: _onOpenProject,
}: Props) {
  void _onOpenProject;
  const [width, setWidth] = useState(loadProjectRailWidth);
  const [dragging, setDragging] = useState(false);
  const [railOrder, setRailOrder] = useState(loadProjectRailOrder);
  const [pinnedPaths, setPinnedPaths] = useState(loadPinnedProjects);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const groupLogos = useTabGroupLogos();
  const navRef = useRef<HTMLElement>(null);
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const widthRef = useRef(width);
  const pendingWidth = useRef(width);
  const resizeFrame = useRef<number | null>(null);
  const allProjects = useMemo(
    () => collectRailProjects(recents, cwd),
    [cwd, recents],
  );
  const sections = useMemo(
    () => projectRailSections(recents, cwd, railOrder, pinnedPaths),
    [cwd, pinnedPaths, railOrder, recents],
  );
  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const path of busyPaths ?? []) set.add(path);
    return set;
  }, [busyPaths]);

  useEffect(() => {
    setRailOrder((prev) => {
      const synced = syncProjectRailOrder(prev, allProjects);
      if (synced.join("\0") === prev.join("\0")) return prev;
      saveProjectRailOrder(synced);
      return synced;
    });
  }, [allProjects]);

  useEffect(() => {
    setPinnedPaths((prev) => {
      const next = prev.filter((path) => allProjects.has(path));
      if (next.length === prev.length) return prev;
      savePinnedProjects(next);
      return next;
    });
  }, [allProjects]);

  const clamp = (value: number) => {
    const max = Math.min(
      PROJECT_RAIL_WIDTH_MAX,
      Math.floor(window.innerWidth * 0.35),
    );
    return Math.min(max, Math.max(PROJECT_RAIL_WIDTH_MIN, Math.round(value)));
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
      if (navRef.current) {
        navRef.current.style.width = `${pendingWidth.current}px`;
      }
    });
  };

  const commitWidth = () => {
    if (resizeFrame.current != null) {
      cancelAnimationFrame(resizeFrame.current);
      resizeFrame.current = null;
    }
    const next = pendingWidth.current;
    widthRef.current = next;
    if (navRef.current) navRef.current.style.width = `${next}px`;
    setWidth(next);
    saveProjectRailWidth(next);
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
    pendingWidth.current = PROJECT_RAIL_WIDTH_DEFAULT;
    commitWidth();
  };

  const reorderSubset = (
    fullOrder: string[],
    subsetOrder: string[],
    subsetPaths: Set<string>,
  ) => {
    const next: string[] = [];
    let subsetIndex = 0;
    for (const path of fullOrder) {
      if (!subsetPaths.has(path)) {
        next.push(path);
        continue;
      }
      if (subsetIndex < subsetOrder.length) {
        next.push(subsetOrder[subsetIndex++]);
      }
    }
    return next;
  };

  const onReorderPinned = (ids: string[]) => {
    const subset = new Set(sections.pinned.map((item) => item.path));
    const next = reorderSubset(railOrder, ids, subset);
    setRailOrder(next);
    saveProjectRailOrder(next);
  };

  const onReorderProjects = (ids: string[]) => {
    const subset = new Set(sections.projects.map((item) => item.path));
    const next = reorderSubset(railOrder, ids, subset);
    setRailOrder(next);
    saveProjectRailOrder(next);
  };

  const onTogglePin = (path: string) => {
    const isPinned = pinnedPaths.some((pinned) =>
      sameProjectPath(pinned, path),
    );
    const next = isPinned
      ? pinnedPaths.filter((pinned) => !sameProjectPath(pinned, path))
      : [...pinnedPaths, path];
    setPinnedPaths(next);
    savePinnedProjects(next);
  };

  const pinnedIds = sections.pinned.map((item) => item.path);
  const projectIds = sections.projects.map((item) => item.path);
  const pinnedSortable = useSortable(pinnedIds, onReorderPinned, {
    axis: "y",
    onActivate: onSelectProject,
  });
  const projectSortable = useSortable(projectIds, onReorderProjects, {
    axis: "y",
    onActivate: onSelectProject,
  });
  const hasProjects =
    sections.pinned.length > 0 || sections.projects.length > 0;

  return (
    <nav
      ref={navRef}
      aria-label="Projects"
      style={{ width }}
      className="sidebar-glass relative flex shrink-0 flex-col border-r border-content/10"
    >
      <div
        className="flex h-9.75 shrink-0 items-center pr-1.5"
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
        />
      </div>

      <div className="flex shrink-0 flex-col gap-px px-2 pb-2">
        <RailAction label="New" icon={Plus} onClick={onNew} />
        <RailAction label="Search" icon={Search} onClick={onSearch} />
        <RailAction
          label="Inbox"
          icon={Inbox}
          onClick={onInbox}
          active={inboxOpen}
          badge={inboxCount > 0 ? inboxCount : undefined}
          ariaLabel={
            inboxCount > 0 ? `Inbox, ${inboxCount} notifications` : "Inbox"
          }
        />
      </div>

      <div
        ref={lockOverscroll}
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none pb-2 transition-opacity ${
          inboxOpen ? "opacity-50" : ""
        }`}
      >
        {!hasProjects ? (
          <p className="px-3 py-2 text-[11px] leading-tight text-content/40">
            No projects yet
          </p>
        ) : null}

        {sections.pinned.length > 0 ? (
          <ProjectSection
            label="Pinned"
            items={sections.pinned}
            cwd={cwd}
            inboxOpen={inboxOpen}
            busy={busy}
            groupLogos={groupLogos}
            sortable={pinnedSortable}
            pinned
            onSelect={onSelectProject}
            onTogglePin={onTogglePin}
          />
        ) : null}

        {sections.projects.length > 0 ? (
          <ProjectSection
            label="Projects"
            items={sections.projects}
            cwd={cwd}
            inboxOpen={inboxOpen}
            busy={busy}
            groupLogos={groupLogos}
            sortable={projectSortable}
            pinned={false}
            onSelect={onSelectProject}
            onTogglePin={onTogglePin}
          />
        ) : null}
      </div>
      <SidebarUpdate />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize project sidebar"
        aria-valuenow={width}
        aria-valuemin={PROJECT_RAIL_WIDTH_MIN}
        aria-valuemax={PROJECT_RAIL_WIDTH_MAX}
        className={`absolute inset-y-0 -right-px z-10 w-1.5 cursor-col-resize touch-none ${
          dragging ? "bg-content/15" : "hover:bg-content/10"
        }`}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        onDoubleClick={onResizeDoubleClick}
      />
    </nav>
  );
}

function RailAction({
  label,
  icon: Icon,
  onClick,
  active = false,
  badge,
  ariaLabel,
}: {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  active?: boolean;
  badge?: number;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={ariaLabel ?? label}
      className={`relative flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${
        active
          ? "bg-content/12 text-content"
          : "text-content/75 hover:bg-content/5 hover:text-content"
      } disabled:cursor-default disabled:opacity-40`}
    >
      {badge != null ? (
        <span
          aria-hidden
          className="absolute left-1 top-1/2 grid min-w-4 -translate-y-1/2 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white tabular-nums"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
      <Icon
        className={`size-4 shrink-0 opacity-70 ${badge != null ? "ml-4" : ""}`}
        strokeWidth={1.75}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
        {label}
      </span>
    </button>
  );
}

type SortableHandle = ReturnType<typeof useSortable>;

function ProjectSection({
  label,
  items,
  cwd,
  inboxOpen,
  busy,
  groupLogos,
  sortable,
  pinned,
  onSelect,
  onTogglePin,
}: {
  label: string;
  items: RecentProject[];
  cwd: string;
  inboxOpen: boolean;
  busy: Set<string>;
  groupLogos: ReturnType<typeof useTabGroupLogos>;
  sortable: SortableHandle;
  pinned: boolean;
  onSelect: (path: string) => void;
  onTogglePin: (path: string) => void;
}) {
  return (
    <div className="shrink-0">
      <div className="px-3 pb-1.5 pt-1">
        <span className="px-1 text-xs text-content/50">{label}</span>
      </div>
      <div className="flex flex-col gap-px px-2">
        {items.map((item, index) => (
          <ProjectCard
            key={item.path}
            item={item}
            selected={!inboxOpen && sameProjectPath(item.path, cwd)}
            busy={isBusyPath(item.path, busy)}
            pinned={pinned}
            logoPath={resolveTabGroupLogo(projectName(item.path), groupLogos)}
            sortable={sortable}
            index={index}
            onSelect={onSelect}
            onTogglePin={onTogglePin}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectCard({
  item,
  selected,
  busy,
  pinned,
  logoPath,
  sortable,
  index,
  onSelect,
  onTogglePin,
}: {
  item: RecentProject;
  selected: boolean;
  busy: boolean;
  pinned: boolean;
  logoPath: string | null;
  sortable: SortableHandle;
  index: number;
  onSelect: (path: string) => void;
  onTogglePin: (path: string) => void;
}) {
  const name = basename(item.path);
  const dragging = sortable.draggingId === item.path;
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
      ref={(el) => sortable.setItemRef(item.path, el)}
      className={`group relative flex touch-none items-stretch rounded-lg px-2 py-2 ${
        selected
          ? "bg-content/12 text-content"
          : "text-content/75 hover:bg-content/5 hover:text-content"
      } ${dragging ? "opacity-40" : ""} cursor-default`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        sortable.onItemPointerDown(item.path, event);
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        if (sortable.consumeClick()) return;
        onSelect(item.path);
      }}
    >
      {showStart ? (
        <div className="pointer-events-none absolute inset-x-2 top-0 z-20 h-0.5 rounded-full bg-accent" />
      ) : null}
      {showEnd ? (
        <div className="pointer-events-none absolute inset-x-2 bottom-0 z-20 h-0.5 rounded-full bg-accent" />
      ) : null}
      <button
        type="button"
        title={item.path}
        aria-label={name}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 cursor-default items-center gap-2 text-left"
      >
        <div className="relative size-4 shrink-0">
          <div className="grid size-4 place-items-center transition-opacity group-hover:opacity-0">
            {logoPath ? (
              <ProjectLogoIcon
                path={logoPath}
                className="size-4 rounded-sm"
                imageClassName="size-4"
              />
            ) : (
              <FileTypeIcon name={name} isDir isRoot size={14} />
            )}
          </div>
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
          {name}
        </span>
        {busy ? (
          <span className="grid size-4 shrink-0 place-items-center text-accent">
            <TerminalSpinner className="inline-block w-2.5 select-none text-center text-[9px] leading-none text-accent" />
          </span>
        ) : null}
      </button>
      <button
        type="button"
        data-no-drag
        title={pinned ? "Unpin project" : "Pin project"}
        aria-label={pinned ? "Unpin project" : "Pin project"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onTogglePin(item.path);
        }}
        className="absolute left-2 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-content/55 opacity-0 pointer-events-none transition-opacity hover:text-content group-hover:pointer-events-auto group-hover:opacity-100"
      >
        {pinned ? (
          <PinOff className="size-3.5" strokeWidth={1.75} />
        ) : (
          <Pin className="size-3.5" strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}

function isBusyPath(path: string, busy: Set<string>): boolean {
  for (const other of busy) {
    if (sameProjectPath(path, other)) return true;
  }
  return false;
}
