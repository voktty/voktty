import { Check, CircleDot, GitPullRequest } from "./icons";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { InboxKind } from "../lib/githubTasks";
import {
  DEFAULT_INBOX_FILTERS,
  hasActiveInboxFilters,
  type InboxFilters,
  type InboxSource,
  type InboxTimeFilter,
} from "../lib/inboxFilters";
import { ProjectLogoIcon } from "./ProjectLogoIcon";

export const INBOX_FILTER_MENU_WIDTH = 228;

type ProjectOption = {
  path: string;
  name: string;
  logoPath: string | null;
};

type Props = {
  x: number;
  y: number;
  projects: ProjectOption[];
  source: InboxSource;
  filters: InboxFilters;
  onChange: (filters: InboxFilters) => void;
  onClose: () => void;
};

const TIME_OPTIONS: { id: InboxTimeFilter; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

const KIND_OPTIONS: {
  id: InboxKind;
  label: string;
  icon: ReactNode;
}[] = [
  {
    id: "issue",
    label: "Issues",
    icon: <CircleDot className="size-3.5 shrink-0" strokeWidth={1.75} />,
  },
  {
    id: "pr",
    label: "Pull requests",
    icon: <GitPullRequest className="size-3.5 shrink-0" strokeWidth={1.75} />,
  },
];

export function InboxFiltersMenu({
  x,
  y,
  projects,
  source,
  filters,
  onChange,
  onClose,
}: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const hiddenProjects = new Set(filters.hiddenProjects);
  const hiddenKinds = new Set(filters.hiddenKinds);

  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = window.innerWidth - rect.width - pad;
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = window.innerHeight - rect.height - pad;
    }
    setPos({
      left: Math.max(pad, left),
      top: Math.max(pad, top),
    });
  }, [x, y, projects.length, filters]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onCloseRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  const toggleAssigned = () => {
    onChange({ ...filters, assignedToMe: !filters.assignedToMe });
  };

  const toggleKind = (kind: InboxKind) => {
    const next = new Set(hiddenKinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    onChange({ ...filters, hiddenKinds: [...next] });
  };

  const toggleProject = (path: string) => {
    const next = new Set(hiddenProjects);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onChange({ ...filters, hiddenProjects: [...next] });
  };

  const setTime = (time: InboxTimeFilter) => {
    onChange({ ...filters, time });
  };

  const toggleStatus = (key: keyof InboxFilters["status"]) => {
    onChange({
      ...filters,
      status: { ...filters.status, [key]: !filters.status[key] },
    });
  };

  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label="Filter inbox"
      onContextMenu={(event) => event.preventDefault()}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: INBOX_FILTER_MENU_WIDTH,
        zIndex: 80,
      }}
      className="max-h-[min(70vh,480px)] overflow-y-auto rounded-lg border border-content/10 bg-content/10 p-1 shadow-xl backdrop-blur-xl outline-none"
    >
      <FilterItem
        label="Assigned to me"
        checked={filters.assignedToMe}
        onClick={toggleAssigned}
      />

      <SectionLabel>Status</SectionLabel>
      <FilterItem
        label="Open"
        checked={filters.status.open}
        onClick={() => toggleStatus("open")}
      />
      {source === "github" ? (
        <FilterItem
          label="Draft"
          checked={filters.status.draft}
          onClick={() => toggleStatus("draft")}
        />
      ) : null}
      <FilterItem
        label="Closed"
        checked={filters.status.closed}
        onClick={() => toggleStatus("closed")}
      />
      {source === "github" ? (
        <FilterItem
          label="Merged"
          checked={filters.status.merged}
          onClick={() => toggleStatus("merged")}
        />
      ) : null}

      <SectionLabel>Time</SectionLabel>
      {TIME_OPTIONS.map((option) => (
        <FilterItem
          key={option.id}
          label={option.label}
          checked={filters.time === option.id}
          onClick={() => setTime(option.id)}
        />
      ))}

      {source === "github" ? (
        <>
          <SectionLabel>Type</SectionLabel>
          {KIND_OPTIONS.map((option) => (
            <FilterItem
              key={option.id}
              label={option.label}
              checked={!hiddenKinds.has(option.id)}
              icon={option.icon}
              onClick={() => toggleKind(option.id)}
            />
          ))}
        </>
      ) : null}

      {source === "github" && projects.length > 0 ? (
        <>
          <SectionLabel>Projects</SectionLabel>
          {projects.map((project) => (
            <FilterItem
              key={project.path}
              label={project.name}
              checked={!hiddenProjects.has(project.path)}
              icon={
                project.logoPath ? (
                  <ProjectLogoIcon
                    path={project.logoPath}
                    className="size-3.5 shrink-0 rounded-sm"
                    imageClassName="size-3.5"
                  />
                ) : undefined
              }
              onClick={() => toggleProject(project.path)}
            />
          ))}
        </>
      ) : null}

      {hasActiveInboxFilters(filters, source) ? (
        <>
          <div role="separator" className="my-1 h-px bg-content/10" />
          <button
            type="button"
            role="menuitem"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(DEFAULT_INBOX_FILTERS)}
            className="flex h-7 w-full items-center rounded-lg px-2 text-left text-[13px] leading-none text-content/70 hover:bg-content/5 hover:text-content"
          >
            Clear filters
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-content/40">
      {children}
    </div>
  );
}

function FilterItem({
  label,
  checked,
  icon,
  onClick,
}: {
  label: string;
  checked: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] leading-none text-content hover:bg-content/5"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked ? (
        <Check className="size-3.5 shrink-0" strokeWidth={2.25} />
      ) : null}
    </button>
  );
}
