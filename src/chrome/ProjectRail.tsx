import { Inbox, Plus, Search, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
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
  projectRailItems,
  sameProjectPath,
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
  onInbox?: () => void;
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
  onInbox,
  onSelectProject,
  onOpenProject: _onOpenProject,
}: Props) {
  void _onOpenProject;
  const [width, setWidth] = useState(loadProjectRailWidth);
  const [dragging, setDragging] = useState(false);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const groupLogos = useTabGroupLogos();
  const navRef = useRef<HTMLElement>(null);
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const widthRef = useRef(width);
  const pendingWidth = useRef(width);
  const resizeFrame = useRef<number | null>(null);
  const items = useMemo(() => projectRailItems(recents, cwd), [cwd, recents]);
  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const path of busyPaths ?? []) set.add(path);
    return set;
  }, [busyPaths]);

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
        <RailAction label="Search" icon={Search} onClick={onInbox} />
        <RailAction label="Inbox" icon={Inbox} onClick={onInbox} />
      </div>

      <div className="shrink-0 px-3 pb-1.5">
        <span className="text-xs tracking- text-content/50 px-1">Projects</span>
      </div>

      <div
        ref={lockOverscroll}
        className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto overscroll-none px-2 pb-2"
      >
        {items.length === 0 ? (
          <p className="px-1 py-2 text-[11px] leading-tight text-content/40">
            No projects yet
          </p>
        ) : (
          items.map((item) => (
            <ProjectCard
              key={item.path}
              item={item}
              selected={sameProjectPath(item.path, cwd)}
              busy={isBusyPath(item.path, busy)}
              logoPath={resolveTabGroupLogo(projectName(item.path), groupLogos)}
              onSelect={onSelectProject}
            />
          ))
        )}
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
}: {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="relative flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-content/75 hover:bg-content/5 hover:text-content disabled:cursor-default disabled:opacity-40"
    >
      <Icon className="size-4 shrink-0 opacity-70" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
        {label}
      </span>
    </button>
  );
}

function ProjectCard({
  item,
  selected,
  busy,
  logoPath,
  onSelect,
}: {
  item: RecentProject;
  selected: boolean;
  busy: boolean;
  logoPath: string | null;
  onSelect: (path: string) => void;
}) {
  const name = basename(item.path);
  return (
    <button
      type="button"
      title={item.path}
      aria-label={name}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(item.path)}
      className={`relative flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${
        selected
          ? "bg-content/12 text-content"
          : "text-content/75 hover:bg-content/5 hover:text-content"
      }`}
    >
      {logoPath ? (
        <ProjectLogoIcon
          path={logoPath}
          className="size-4 shrink-0 rounded-sm"
          imageClassName="size-4"
        />
      ) : (
        <FileTypeIcon name={name} isDir isRoot size={14} />
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
        {name}
      </span>
      {busy ? (
        <span className="grid size-4 shrink-0 place-items-center text-accent">
          <TerminalSpinner className="inline-block w-2.5 select-none text-center text-[9px] leading-none text-accent" />
        </span>
      ) : null}
    </button>
  );
}

function isBusyPath(path: string, busy: Set<string>): boolean {
  for (const other of busy) {
    if (sameProjectPath(path, other)) return true;
  }
  return false;
}
