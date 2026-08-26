import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  CodeIcon,
  FunctionIcon,
  Refresh01Icon,
  Search01Icon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorPaneHandle } from "../EditorPane";
import { filterSymbols, type IdeSymbol } from "../lib/outlineSymbols";

type Props = {
  active: boolean;
  editorId: number | null;
  path: string | null;
  handle: EditorPaneHandle | null;
  onNavigate: (symbol: IdeSymbol) => void;
};

type Mode = "document" | "workspace";
type LoadState = "idle" | "loading" | "ready" | "unavailable";

function symbolIcon(kind: number) {
  return kind === 6 || kind === 9 || kind === 12
    ? FunctionIcon
    : kind === 2 || kind === 3
      ? SourceCodeIcon
      : CodeIcon;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function SymbolRows({
  symbols,
  collapsed,
  onToggle,
  onNavigate,
  depth = 0,
  showPath = false,
}: {
  symbols: IdeSymbol[];
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onNavigate: (symbol: IdeSymbol) => void;
  depth?: number;
  showPath?: boolean;
}) {
  return symbols.map((symbol) => {
    const hasChildren = symbol.children.length > 0;
    const isCollapsed = collapsed.has(symbol.id);
    return (
      <div key={symbol.id}>
        <div
          className="group flex min-h-7 items-center pr-1 text-xs hover:bg-foreground/[0.045]"
          style={{ paddingLeft: 6 + depth * 13 }}
        >
          <button
            type="button"
            aria-label={hasChildren ? symbol.name : undefined}
            tabIndex={hasChildren ? 0 : -1}
            disabled={!hasChildren}
            onClick={() => onToggle(symbol.id)}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 disabled:opacity-0"
          >
            <HugeiconsIcon
              icon={isCollapsed ? ArrowRight01Icon : ArrowDown01Icon}
              size={11}
              strokeWidth={2}
            />
          </button>
          <button
            type="button"
            onClick={() => onNavigate(symbol)}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <HugeiconsIcon
              icon={symbolIcon(symbol.kind)}
              size={13}
              strokeWidth={1.8}
              className="shrink-0 text-sky-400/90"
            />
            <span className="min-w-0 flex-1 truncate text-foreground/90">
              {symbol.name}
            </span>
            {symbol.detail ? (
              <span className="max-w-24 truncate text-[10px] text-muted-foreground/60">
                {symbol.detail}
              </span>
            ) : null}
            {showPath ? (
              <span className="max-w-24 truncate text-[10px] text-muted-foreground/55">
                {basename(symbol.path)}:{symbol.line}
              </span>
            ) : null}
          </button>
        </div>
        {hasChildren && !isCollapsed ? (
          <SymbolRows
            symbols={symbol.children}
            collapsed={collapsed}
            onToggle={onToggle}
            onNavigate={onNavigate}
            depth={depth + 1}
            showPath={showPath}
          />
        ) : null}
      </div>
    );
  });
}

export function OutlinePanel({
  active,
  editorId,
  path,
  handle,
  onNavigate,
}: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("document");
  const [query, setQuery] = useState("");
  const [symbols, setSymbols] = useState<IdeSymbol[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [source, setSource] = useState<"lsp" | "fallback" | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const requestRef = useRef(0);
  const editorContextRef = useRef(editorId);

  const loadDocument = useCallback(async () => {
    if (!active || !handle || mode !== "document") return;
    const request = ++requestRef.current;
    setState("loading");
    const result = await handle.getDocumentSymbols();
    if (request !== requestRef.current) return;
    setSymbols(result.symbols);
    setSource(result.source);
    setState("ready");
  }, [active, handle, mode]);

  useEffect(() => {
    if (!active || mode !== "document" || !handle) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void loadDocument();
    const unsubscribe = handle.subscribeDocumentChanges(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void loadDocument(), 350);
    });
    return () => {
      requestRef.current += 1;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [active, handle, loadDocument, mode]);

  const loadWorkspace = useCallback(
    async (workspaceQuery: string) => {
      if (!active || !handle || mode !== "workspace") return;
      const request = ++requestRef.current;
      setState("loading");
      const result = await handle.getWorkspaceSymbols(workspaceQuery);
      if (request !== requestRef.current) return;
      if (result === null) {
        setSymbols([]);
        setSource(null);
        setState("unavailable");
        return;
      }
      setSymbols(result);
      setSource("lsp");
      setState("ready");
    },
    [active, handle, mode],
  );

  useEffect(() => {
    if (!active || mode !== "workspace" || !handle) return;
    const trimmed = query.trim();
    if (!trimmed) {
      requestRef.current += 1;
      setSymbols([]);
      setSource(null);
      setState("idle");
      return;
    }
    const timer = setTimeout(() => {
      void loadWorkspace(trimmed);
    }, 250);
    return () => {
      requestRef.current += 1;
      clearTimeout(timer);
    };
  }, [active, handle, loadWorkspace, mode, query]);

  useEffect(() => {
    if (editorContextRef.current === editorId) return;
    editorContextRef.current = editorId;
    setQuery("");
    setCollapsed(new Set());
    setSymbols([]);
    setSource(null);
    setState("idle");
  }, [editorId]);

  const visibleSymbols = useMemo(
    () => (mode === "document" ? filterSymbols(symbols, query) : symbols),
    [mode, query, symbols],
  );
  const toggle = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={t("outline.title")}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/40 px-2.5">
        <HugeiconsIcon
          icon={SourceCodeIcon}
          size={14}
          className="text-sky-400"
        />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {t("outline.title")}
        </span>
        {source ? (
          <span className="rounded bg-foreground/[0.055] px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
            {source === "lsp" ? t("outline.lsp") : t("outline.local")}
          </span>
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={!handle || state === "loading"}
          onClick={() => {
            if (mode === "document") void loadDocument();
            else if (query.trim()) void loadWorkspace(query.trim());
          }}
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
        >
          <HugeiconsIcon icon={Refresh01Icon} size={13} />
        </Button>
      </header>

      <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-border/30 p-1.5">
        {(["document", "workspace"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={mode === candidate}
            onClick={() => {
              setMode(candidate);
              setQuery("");
              setCollapsed(new Set());
              setSymbols([]);
              setSource(null);
              setState("idle");
            }}
            className={cn(
              "h-7 rounded-md text-[11px] font-medium transition-colors",
              mode === candidate
                ? "bg-foreground/[0.08] text-foreground"
                : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
            )}
          >
            {t(`outline.${candidate}`)}
          </button>
        ))}
      </div>

      <div className="relative shrink-0 p-2 pb-1.5">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/60"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            mode === "document"
              ? t("outline.filterDocument")
              : t("outline.searchWorkspace")
          }
          className="h-7 rounded-lg pl-7 text-xs"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!path || !handle ? (
          <p className="px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground">
            {t("outline.openEditor")}
          </p>
        ) : state === "loading" ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            {t("outline.loading")}
          </p>
        ) : state === "unavailable" ? (
          <p className="px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground">
            {t("outline.workspaceUnavailable")}
          </p>
        ) : mode === "workspace" && !query.trim() ? (
          <p className="px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground">
            {t("outline.workspaceHint")}
          </p>
        ) : visibleSymbols.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            {t("outline.noSymbols")}
          </p>
        ) : (
          <SymbolRows
            symbols={visibleSymbols}
            collapsed={collapsed}
            onToggle={toggle}
            onNavigate={onNavigate}
            showPath={mode === "workspace"}
          />
        )}
      </div>
    </section>
  );
}
