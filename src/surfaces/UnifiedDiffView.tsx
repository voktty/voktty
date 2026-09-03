import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FoldVertical,
  Undo2,
  UnfoldVertical,
} from "../chrome/icons";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useColorScheme } from "../hooks/useColorScheme";
import { basename } from "../lib/fs";
import {
  highlightDiffFile,
  type SyntaxToken,
} from "./syntaxTokens";
import {
  expandFold,
  type FoldReveal,
  type UnifiedBlock,
  type UnifiedLine,
} from "../lib/unifiedDiff";
import {
  flattenVisibleRows,
  rowsHeight,
  UNIFIED_FOLD_PX,
  UNIFIED_HUNK_PX,
  UNIFIED_LINE_PX,
  UNIFIED_OVERSCAN_PX,
  windowRows,
  type DiffViewRow,
  type RowWindow,
} from "../lib/unifiedDiffWindow";

export type UnifiedDiffFileModel = {
  id: string;
  path: string;
  label: string;
  binary?: boolean;
  tooLarge?: boolean;
  emptyMessage?: string;
  additions: number;
  deletions: number;
  blocks: UnifiedBlock[];
  canStage?: boolean;
  canDiscard?: boolean;
  canStageHunk?: boolean;
};

type Props = {
  files: UnifiedDiffFileModel[];
  truncated?: boolean;
  focusPath?: string;
  busyId?: string | null;
  totals?: { additions: number; deletions: number };
  /** Fill the parent pane and scroll inside. Off when the parent already scrolls. */
  fill?: boolean;
  onStageFile?: (id: string) => void;
  onDiscardFile?: (id: string) => void;
  onStageHunk?: (id: string, pos: number) => void;
};

export function UnifiedDiffView({
  files,
  truncated,
  focusPath,
  busyId,
  totals,
  fill = true,
  onStageFile,
  onDiscardFile,
  onStageHunk,
}: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(files.map((file) => file.id)),
  );
  const [reveals, setReveals] = useState<Record<string, FoldReveal>>({});
  const fileRefs = useRef(new Map<string, HTMLElement>());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileKey = files.map((file) => file.id).join("\n");

  useEffect(() => {
    setOpen(new Set(files.map((file) => file.id)));
    setReveals({});
  }, [fileKey]);

  useEffect(() => {
    if (!focusPath) return;
    const node = fileRefs.current.get(focusPath);
    const scroller = scrollerRef.current;
    if (!node || !scroller) return;
    const top = node.offsetTop - 8;
    scroller.scrollTo({ top: Math.max(0, top) });
  }, [focusPath, fileKey]);

  const bindScroller = (el: HTMLDivElement | null) => {
    scrollerRef.current = el;
    lockOverscroll(el);
  };

  if (files.length === 0) {
    return (
      <p className="px-4 py-6 text-[13px] text-content/45">No file changes</p>
    );
  }

  const fileLabel = files.length === 1 ? "1 file" : `${files.length} files`;
  const additions =
    totals?.additions ?? files.reduce((sum, file) => sum + file.additions, 0);
  const deletions =
    totals?.deletions ?? files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <div
      className={
        fill
          ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden"
          : "flex flex-col"
      }
    >
      <div
        className={`flex h-8 shrink-0 items-center gap-3 border-b border-content/10 px-3 text-[12px]`}
      >
        <span className="text-content/70">{fileLabel}</span>
        <DiffCounts additions={additions} deletions={deletions} />
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            title="Expand all files"
            aria-label="Expand all files"
            onClick={() => setOpen(new Set(files.map((file) => file.id)))}
            className="grid size-7 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
          >
            <UnfoldVertical className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title="Collapse all files"
            aria-label="Collapse all files"
            disabled={open.size === 0}
            onClick={() => setOpen(new Set())}
            className="grid size-7 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
          >
            <FoldVertical className="size-3.5" strokeWidth={1.75} />
          </button>
        </span>
      </div>
      <div
        ref={bindScroller}
        className={
          fill
            ? "unified-diff min-h-0 flex-1 overflow-y-auto overscroll-none"
            : "unified-diff"
        }
      >
        {truncated ? (
          <p className="px-3 py-3 text-[12px] text-content/45">
            Diff is too large to display in full. File list is shown without
            patches.
          </p>
        ) : null}
        <div className="flex flex-col">
          {files.map((file) => (
            <FileSection
              key={file.id}
              file={file}
              expanded={open.has(file.id)}
              focused={focusPath === file.path || focusPath === file.id}
              busy={busyId === file.id}
              reveals={reveals}
              scrollerRef={scrollerRef}
              onToggle={() => {
                setOpen((current) => {
                  const next = new Set(current);
                  if (next.has(file.id)) next.delete(file.id);
                  else next.add(file.id);
                  return next;
                });
              }}
              onReveal={(foldId, direction) => {
                const key = `${file.id}:${foldId}`;
                const block = file.blocks.find(
                  (entry) => entry.kind === "fold" && entry.id === foldId,
                );
                const total = block?.kind === "fold" ? block.lines.length : 0;
                setReveals((current) => ({
                  ...current,
                  [key]: expandFold(current[key], total, direction),
                }));
              }}
              onStageFile={onStageFile}
              onDiscardFile={onDiscardFile}
              onStageHunk={onStageHunk}
              bindRef={(node) => {
                if (node) fileRefs.current.set(file.path, node);
                else fileRefs.current.delete(file.path);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const FileSection = memo(function FileSection({
  file,
  expanded,
  focused,
  busy,
  reveals,
  scrollerRef,
  onToggle,
  onReveal,
  onStageFile,
  onDiscardFile,
  onStageHunk,
  bindRef,
}: {
  file: UnifiedDiffFileModel;
  expanded: boolean;
  focused: boolean;
  busy: boolean;
  reveals: Record<string, FoldReveal>;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onReveal: (foldId: string, direction: "up" | "down" | "all") => void;
  onStageFile?: (id: string) => void;
  onDiscardFile?: (id: string) => void;
  onStageHunk?: (id: string, pos: number) => void;
  bindRef: (node: HTMLElement | null) => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const name = basename(file.path);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  const [tokens, setTokens] = useState<Map<UnifiedLine, SyntaxToken[]> | null>(
    null,
  );
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (!expanded || !near) return;
    let cancelled = false;
    void highlightDiffFile(file, colorScheme).then((next) => {
      if (!cancelled) setTokens(next);
    });
    return () => {
      cancelled = true;
    };
  }, [colorScheme, expanded, file, near]);

  const setSection = (node: HTMLElement | null) => {
    sectionRef.current = node;
    bindRef(node);
  };

  useLayoutEffect(() => {
    if (!expanded) return;
    const section = sectionRef.current;
    if (!section) return;
    const root = scrollerRef.current ?? verticalScrollParent(section);
    setNear(isNearViewport(section, root, 800));
  }, [expanded, scrollerRef, file.id]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !expanded) return;
    const root = scrollerRef.current ?? verticalScrollParent(section);
    const observer = new IntersectionObserver(
      ([entry]) => {
        const next = entry.isIntersecting;
        setNear((current) => (current === next ? current : next));
      },
      { root, rootMargin: "800px 0px", threshold: 0 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [expanded, scrollerRef]);

  return (
    <section
      ref={setSection}
      data-diff-file={file.path}
      className={focused ? "bg-content/[0.03]" : undefined}
    >
      <header
        className="sticky top-0 z-30 flex items-center gap-2 border-b border-content/10 bg-content/2 px-3 py-1.5 backdrop-blur-xl"
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <FileTypeIcon name={name} isDir={false} size={16} />
          <span
            className="min-w-0 flex-1 truncate font-mono text-[12px] text-content/85"
            title={file.label}
          >
            {file.label}
          </span>
          <DiffCounts additions={file.additions} deletions={file.deletions} />
        </button>
        {file.canDiscard && onDiscardFile ? (
          <IconButton
            title="Discard file"
            disabled={busy}
            onClick={() => onDiscardFile(file.id)}
          >
            <Undo2 className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {file.canStage && onStageFile ? (
          <button
            type="button"
            title="Stage file"
            aria-label="Stage file"
            disabled={busy}
            onClick={() => onStageFile(file.id)}
            className="grid size-4 place-items-center rounded-[3px] bg-content text-background-base hover:opacity-80 disabled:opacity-40"
          >
            <Check className="size-2.5" strokeWidth={2.5} />
          </button>
        ) : null}
      </header>
      {expanded ? (
        <FileBody
          file={file}
          reveals={reveals}
          near={near}
          tokens={tokens}
          scrollerRef={scrollerRef}
          onReveal={onReveal}
          onStageHunk={onStageHunk}
        />
      ) : null}
    </section>
  );
});

function FileBody({
  file,
  reveals,
  near,
  tokens,
  scrollerRef,
  onReveal,
  onStageHunk,
}: {
  file: UnifiedDiffFileModel;
  reveals: Record<string, FoldReveal>;
  near: boolean;
  tokens: Map<UnifiedLine, SyntaxToken[]> | null;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  onReveal: (foldId: string, direction: "up" | "down" | "all") => void;
  onStageHunk?: (id: string, pos: number) => void;
}) {
  if (file.binary) return <EmptyBody>Binary file changed</EmptyBody>;
  if (file.tooLarge) return <EmptyBody>Diff is too large to display</EmptyBody>;
  if (file.emptyMessage) return <EmptyBody>{file.emptyMessage}</EmptyBody>;
  if (file.blocks.length === 0) return <EmptyBody>No textual diff</EmptyBody>;

  return (
    <VirtualRows
      fileId={file.id}
      blocks={file.blocks}
      reveals={reveals}
      near={near}
      tokens={tokens}
      canStageHunk={file.canStageHunk}
      scrollerRef={scrollerRef}
      onReveal={onReveal}
      onStageHunk={onStageHunk}
    />
  );
}

function VirtualRows({
  fileId,
  blocks,
  reveals,
  near,
  tokens,
  canStageHunk,
  scrollerRef,
  onReveal,
  onStageHunk,
}: {
  fileId: string;
  blocks: UnifiedBlock[];
  reveals: Record<string, FoldReveal>;
  near: boolean;
  tokens: Map<UnifiedLine, SyntaxToken[]> | null;
  canStageHunk?: boolean;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  onReveal: (foldId: string, direction: "up" | "down" | "all") => void;
  onStageHunk?: (id: string, pos: number) => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const codeRef = useRef<HTMLDivElement | null>(null);
  const mouseYRef = useRef<number | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      flattenVisibleRows(
        blocks,
        (foldId) => reveals[`${fileId}:${foldId}`],
        !!canStageHunk && !!onStageHunk,
      ),
    [blocks, canStageHunk, fileId, onStageHunk, reveals],
  );
  const totalHeight = useMemo(() => rowsHeight(rows), [rows]);
  const minWidthCh = useMemo(() => {
    let max = 40;
    for (const row of rows) {
      if (row.type === "line") {
        max = Math.max(max, row.line.text.length);
      }
    }
    return max + 8;
  }, [rows]);
  const [range, setRange] = useState<RowWindow>(() => ({
    start: 0,
    end: 0,
    padTop: 0,
    padBottom: totalHeight,
  }));

  const updateWindow = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const root = scrollerRef.current ?? verticalScrollParent(body);
    const rootRect = root
      ? root.getBoundingClientRect()
      : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const bodyRect = body.getBoundingClientRect();
    const next = windowRows(
      rows,
      rootRect.top - bodyRect.top,
      rootRect.bottom - bodyRect.top,
      UNIFIED_OVERSCAN_PX,
    );
    setRange((current) =>
      current.start === next.start &&
      current.end === next.end &&
      current.padTop === next.padTop &&
      current.padBottom === next.padBottom
        ? current
        : next,
    );
  }, [rows, scrollerRef]);

  const hoverAtY = useCallback(
    (clientY: number | null) => {
      const body = bodyRef.current;
      if (clientY == null || !body) {
        setHoverKey((current) => (current == null ? current : null));
        return;
      }
      let y = clientY - body.getBoundingClientRect().top - range.padTop;
      if (y < 0) {
        setHoverKey((current) => (current == null ? current : null));
        return;
      }
      for (let index = range.start; index < range.end; index += 1) {
        const row = rows[index];
        if (!row) break;
        if (y < row.height) {
          const key = diffRowKey(row, index);
          setHoverKey((current) => (current === key ? current : key));
          return;
        }
        y -= row.height;
      }
      setHoverKey((current) => (current == null ? current : null));
    },
    [range.end, range.padTop, range.start, rows],
  );

  useLayoutEffect(() => {
    if (!near) return;
    updateWindow();
  }, [near, updateWindow, totalHeight]);

  useLayoutEffect(() => {
    if (!near) return;
    hoverAtY(mouseYRef.current);
  }, [hoverAtY, near]);

  useLayoutEffect(() => {
    if (!near) return;
    const body = bodyRef.current;
    if (!body) return;
    const apply = () => {
      body.style.setProperty("--unified-body-width", `${body.clientWidth}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(body);
    return () => observer.disconnect();
  }, [near, totalHeight]);

  useEffect(() => {
    if (!near) return;
    const body = bodyRef.current;
    const root = scrollerRef.current ?? (body ? verticalScrollParent(body) : null);
    const target: HTMLElement | Window = root ?? window;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateWindow();
        hoverAtY(mouseYRef.current);
      });
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [hoverAtY, near, scrollerRef, updateWindow]);

  useEffect(() => {
    if (!near) return;
    const code = codeRef.current;
    if (!code) return;

    // WebKit can latch a wheel gesture to this horizontal scroller instead of
    // chaining its vertical delta to the surrounding unified diff.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      const ownScroller = scrollerRef.current;
      const verticalScroller =
        ownScroller && ownScroller.scrollHeight > ownScroller.clientHeight + 1
          ? ownScroller
          : verticalScrollParent(code);
      if (!verticalScroller) return;

      const scale =
        event.deltaMode === 1
          ? UNIFIED_LINE_PX
          : event.deltaMode === 2
            ? verticalScroller.clientHeight
            : 1;
      const before = verticalScroller.scrollTop;
      const max = verticalScroller.scrollHeight - verticalScroller.clientHeight;
      const next = Math.min(max, Math.max(0, before + event.deltaY * scale));
      if (next === before) return;

      event.preventDefault();
      verticalScroller.scrollTop = next;
    };

    code.addEventListener("wheel", onWheel, { passive: false });
    return () => code.removeEventListener("wheel", onWheel);
  }, [near, scrollerRef]);

  if (!near) {
    return <div style={{ height: totalHeight }} />;
  }

  const visible = rows.slice(range.start, range.end);
  const lanePad = {
    paddingTop: range.padTop,
    paddingBottom: range.padBottom,
  };

  const renderLane = (lane: Lane) =>
    visible.map((row, index) => {
      const key = diffRowKey(row, range.start + index);
      return (
        <DiffLane
          key={`${lane}-${key}`}
          row={row}
          lane={lane}
          hovered={hoverKey === key}
          tokens={row.type === "line" ? tokens?.get(row.line) : undefined}
          onReveal={
            row.type === "fold"
              ? (direction) => onReveal(row.id, direction)
              : undefined
          }
          onStage={
            row.type === "line" && row.stage && row.line.pos != null
              ? () => onStageHunk?.(fileId, row.line.pos as number)
              : undefined
          }
        />
      );
    });

  return (
    <div
      ref={bodyRef}
      className="flex"
      onMouseMove={(event) => {
        mouseYRef.current = event.clientY;
        hoverAtY(event.clientY);
      }}
      onMouseLeave={() => {
        mouseYRef.current = null;
        hoverAtY(null);
      }}
    >
      <div className="relative z-10 w-12 shrink-0" style={lanePad}>
        {renderLane("gutter")}
      </div>
      <div
        ref={codeRef}
        className="min-w-0 flex-1 overflow-x-auto overscroll-x-none"
      >
        <div style={{ ...lanePad, minWidth: `max(100%, ${minWidthCh}ch)` }}>
          {renderLane("code")}
        </div>
      </div>
    </div>
  );
}

type Lane = "gutter" | "code";

function diffRowKey(row: DiffViewRow, index: number) {
  if (row.type === "fold") return `fold-${row.id}`;
  return `${index}-${row.line.kind}-${row.line.oldNumber ?? "x"}-${row.line.newNumber ?? "x"}`;
}

function DiffLane({
  row,
  lane,
  hovered,
  tokens,
  onReveal,
  onStage,
}: {
  row: DiffViewRow;
  lane: Lane;
  hovered: boolean;
  tokens?: SyntaxToken[];
  onReveal?: (direction: "up" | "down" | "all") => void;
  onStage?: () => void;
}) {
  if (row.type === "fold") {
    if (lane === "gutter") {
      return (
        <div className="relative z-20" style={{ height: UNIFIED_FOLD_PX }}>
          <div
            className="absolute inset-y-0 left-0"
            style={{ width: "var(--unified-body-width, 100%)" }}
          >
            <FoldBar hidden={row.hidden} onReveal={onReveal!} />
          </div>
        </div>
      );
    }
    return <div style={{ height: UNIFIED_FOLD_PX }} />;
  }
  return (
    <DiffLineRow
      line={row.line}
      lane={lane}
      hovered={hovered}
      tokens={tokens}
      onStage={onStage}
    />
  );
}

function FoldBar({
  hidden,
  onReveal,
}: {
  hidden: number;
  onReveal: (direction: "up" | "down" | "all") => void;
}) {
  return (
    <div
      className="flex items-center gap-1 bg-content/8 px-2"
      style={{ height: UNIFIED_FOLD_PX }}
    >
      <button
        type="button"
        title="Expand upward"
        aria-label="Expand unmodified lines upward"
        onClick={() => onReveal("up")}
        className="grid size-5 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
      >
        <ChevronUp className="size-3" strokeWidth={2} />
      </button>
      <button
        type="button"
        title="Expand downward"
        aria-label="Expand unmodified lines downward"
        onClick={() => onReveal("down")}
        className="grid size-5 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
      >
        <ChevronDown className="size-3" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => onReveal("all")}
        className="min-w-0 flex-1 py-1 text-left font-mono text-[11px] text-content/45 hover:text-content/70"
      >
        {hidden} unmodified {hidden === 1 ? "line" : "lines"}
      </button>
    </div>
  );
}

const DiffLineRow = memo(function DiffLineRow({
  line,
  lane,
  hovered,
  tokens,
  onStage,
}: {
  line: UnifiedLine;
  lane: Lane;
  hovered: boolean;
  tokens?: SyntaxToken[];
  onStage?: () => void;
}) {
  if (line.kind === "hunk") {
    return (
      <div className="bg-content/5" style={{ height: UNIFIED_HUNK_PX }}>
        {lane === "code" ? (
          <span className="px-3 font-mono text-[11px] leading-5 text-content/40">
            {line.text}
          </span>
        ) : null}
      </div>
    );
  }
  const added = line.kind === "add";
  const deleted = line.kind === "del";
  const number = deleted ? line.oldNumber : line.newNumber;
  const row = added
    ? "bg-emerald-500/15"
    : deleted
      ? "bg-rose-500/15"
      : "";
  const gutterTint = added
    ? "bg-emerald-500/25"
    : deleted
      ? "bg-rose-500/25"
      : "";
  const gutterText = added
    ? "text-emerald-300"
    : deleted
      ? "text-rose-300"
      : "text-content/35";

  if (lane === "gutter") {
    return (
      <div className={`relative ${row}`} style={{ height: UNIFIED_LINE_PX }}>
        {gutterTint ? (
          <span
            className={`pointer-events-none absolute inset-0 ${gutterTint}`}
          />
        ) : null}
        <span
          className={`relative block pr-2 text-right font-mono text-[11px] tabular-nums ${gutterText}`}
          style={{ lineHeight: `${UNIFIED_LINE_PX}px` }}
        >
          {number ?? ""}
        </span>
        {onStage ? (
          <button
            type="button"
            title="Stage hunk"
            aria-label="Stage hunk"
            onClick={onStage}
            className={`absolute top-0.5 left-full z-10 ml-0.5 grid size-4 place-items-center rounded-[3px] bg-white text-[11px] font-bold text-black ${
              hovered ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            +
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={row} style={{ height: UNIFIED_LINE_PX }}>
      <span
        className={`whitespace-pre px-3 font-mono text-[12px] text-content/80 ${
          line.kind === "context" ? "opacity-70" : ""
        }`}
        style={{ lineHeight: `${UNIFIED_LINE_PX}px` }}
      >
        {renderLineText(line, tokens)}
      </span>
    </div>
  );
});

function renderLineText(line: UnifiedLine, tokens?: SyntaxToken[]) {
  const pieces = tokens && tokens.length > 0 ? tokens : [{ text: line.text }];
  if (pieces.length === 1 && !pieces[0]?.color) {
    return line.text;
  }
  return (
    <>
      {pieces.map((piece, index) => (
        <span
          key={index}
          style={piece.color ? { color: piece.color } : undefined}
        >
          {piece.text}
        </span>
      ))}
    </>
  );
}

function EmptyBody({ children }: { children: string }) {
  return <p className="px-3 py-3 text-[12px] text-content/45">{children}</p>;
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

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function verticalScrollParent(el: HTMLElement): HTMLElement | null {
  let current = el.parentElement;
  while (current) {
    const overflowY = getComputedStyle(current).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight + 1
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function isNearViewport(
  section: HTMLElement,
  root: HTMLElement | null,
  margin: number,
) {
  const bounds = section.getBoundingClientRect();
  const view = root
    ? root.getBoundingClientRect()
    : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  return bounds.bottom + margin > view.top && bounds.top - margin < view.bottom;
}
