import { Check, GitBranch, Plus, Search } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  gitCheckout,
  gitCreateBranch,
  notifyGitChanged,
  type GitBranchInfo,
  type GitBranches,
} from "../lib/fs";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useProjectBranches } from "../hooks/useProjectBranches";

type Props = {
  cwd: string;
  branch?: string;
  enabled?: boolean;
  onChange?: () => void;
  onClose?: () => void;
};

const MENU_WIDTH = 280;

type Row =
  | { kind: "create"; name: string }
  | { kind: "branch"; branch: GitBranchInfo };

function menuStyle(anchor: DOMRect): CSSProperties {
  const width = Math.min(MENU_WIDTH, window.innerWidth - 16);
  const left = Math.min(
    Math.max(8, anchor.left),
    window.innerWidth - width - 8,
  );
  return {
    position: "fixed",
    left,
    bottom: window.innerHeight - anchor.top + 6,
    width,
    height: Math.max(180, Math.min(280, anchor.top - 12)),
    zIndex: 50,
  };
}

export function BranchPicker({
  cwd,
  branch,
  enabled = true,
  onChange,
  onClose,
}: Props) {
  const [info, setInfo] = useState<GitBranches | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<CSSProperties>();
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const inProject = Boolean(cwd) && cwd !== "~";
  const projectBranches = useProjectBranches(cwd, inProject);

  useEffect(() => {
    setInfo(projectBranches);
  }, [projectBranches]);

  const current = branch || info?.current || null;
  const detached = !branch && !!info?.detached;

  const dismiss = (restore: boolean) => {
    setOpen(false);
    setQuery("");
    setError(null);
    setBusy(false);
    if (restore) onCloseRef.current?.();
  };

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(null);
    setActive(0);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (rect) setMenu(menuStyle(rect));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) dismiss(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      dismiss(true);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open, menu]);

  useEffect(() => {
    if (enabled) return;
    setOpen(false);
    setQuery("");
    setError(null);
    setBusy(false);
  }, [enabled]);

  const rows = useMemo((): Row[] => {
    const branches = info?.branches ?? [];
    const name = query.trim();
    const needle = name.toLowerCase();
    const filtered = needle
      ? branches.filter((entry) => {
          const hay = entry.remote
            ? `${entry.name} ${entry.remote}`
            : entry.name;
          return hay.toLowerCase().includes(needle);
        })
      : branches;
    const taken = branches.some(
      (entry) => !entry.remote && entry.name === name,
    );
    const selected = branch || info?.current;
    const create: Row[] =
      name && !taken ? [{ kind: "create", name }] : [];
    return [
      ...create,
      ...filtered.map((entry) => ({
        kind: "branch" as const,
        branch: {
          ...entry,
          current: entry.name === selected && !entry.remote,
        },
      })),
    ];
  }, [branch, info, query]);

  useEffect(() => {
    setActive((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  const run = async (work: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      notifyGitChanged();
      onChangeRef.current?.();
      dismiss(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      search.current?.focus();
    }
  };

  const pick = (row: Row) => {
    if (row.kind === "create") {
      void run(() => gitCreateBranch(cwd, row.name));
      return;
    }
    if (row.branch.current) {
      dismiss(true);
      return;
    }
    void run(() => gitCheckout(cwd, row.branch.name, row.branch.remote));
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length === 0) return;
      setActive((i) => Math.min(rows.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length === 0) return;
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) pick(row);
    }
  };

  if (!inProject || !current) return null;

  const label = detached ? `detached ${current}` : current;

  return (
    <div className="flex max-w-[45%] shrink-0 items-center gap-2.5">
      <div ref={root} className="relative min-w-0">
        <button
          type="button"
          title={label}
          aria-label={`Branch ${label}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={!enabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (!enabled) return;
            if (open) {
              dismiss(true);
              return;
            }
            const rect = root.current?.getBoundingClientRect();
            if (rect) setMenu(menuStyle(rect));
            setOpen(true);
          }}
          className={`flex min-w-0 items-center gap-1.5 ${
            open ? "text-content" : "text-content/50 hover:text-content"
          } disabled:opacity-40 disabled:hover:text-content/50`}
        >
          <GitBranch className="size-3.5 shrink-0" strokeWidth={1.5} />
          <span className="truncate font-mono text-[12px]">{label}</span>
        </button>
        {open && menu ? (
          <div
            role="dialog"
            aria-label="Branch picker"
            data-branch-picker
            style={menu}
            className="flex flex-col overflow-hidden rounded-lg border border-content/10 bg-content/10 shadow-xl backdrop-blur-xl"
          >
            <label className="flex shrink-0 items-center gap-2 border-b border-content/10 px-2 py-2.5 text-content/50">
              <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
              <input
                ref={search}
                type="text"
                value={query}
                placeholder="Search or create a branch..."
                aria-label="Search or create a branch"
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                disabled={busy}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/40 disabled:opacity-60"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                  setError(null);
                }}
                onKeyDown={onSearchKey}
              />
            </label>
            <BranchList
              rows={rows}
              active={active}
              busy={busy}
              emptyLabel={query.trim() ? "No matching branches" : "No branches"}
              onActive={setActive}
              onPick={pick}
            />
            {error ? (
              <p className="max-h-16 shrink-0 overflow-y-auto whitespace-pre-wrap border-t border-content/10 px-2.5 py-2 text-[11px] leading-4 text-red-400/90">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BranchList({
  rows,
  active,
  busy,
  emptyLabel,
  onActive,
  onPick,
}: {
  rows: Row[];
  active: number;
  busy: boolean;
  emptyLabel: string;
  onActive: (index: number) => void;
  onPick: (row: Row) => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (rows.length === 0) {
    return (
      <div className="px-3 py-4 text-[12px] text-content/50">{emptyLabel}</div>
    );
  }

  return (
    <div
      ref={lockOverscroll}
      role="listbox"
      aria-label="Branches"
      className="min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 py-1.5"
    >
      {rows.map((row, index) => {
        const highlighted = index === active;
        const selected = row.kind === "branch" && row.branch.current;
        return (
          <button
            key={
              row.kind === "create"
                ? `create:${row.name}`
                : `${row.branch.remote ?? "local"}:${row.branch.name}`
            }
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onActive(index)}
            onClick={() => onPick(row)}
            className={
              row.kind === "create"
                ? `mb-1 flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left disabled:opacity-60 ${
                    highlighted
                      ? "bg-content/15 text-content"
                      : "bg-content/10 text-content hover:bg-content/15"
                  }`
                : `flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left disabled:opacity-60 ${
                    highlighted || selected
                      ? "bg-content/10 text-content"
                      : "text-content hover:bg-content/5"
                  }`
            }
          >
            {row.kind === "create" ? (
              <>
                <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 truncate text-[12px]">
                  Create and checkout {row.name}
                </span>
              </>
            ) : (
              <>
                {selected ? (
                  <Check className="size-3.5 shrink-0" strokeWidth={1.75} />
                ) : (
                  <GitBranch
                    className="size-3.5 shrink-0 text-content/50"
                    strokeWidth={1.75}
                  />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                  {row.branch.name}
                </span>
                {row.branch.remote ? (
                  <span className="shrink-0 text-[10px] text-content/40">
                    {row.branch.remote}
                  </span>
                ) : null}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
