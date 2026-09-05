import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  Copy01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import {
  formatConsoleErrorPrompt,
  usePreviewDevtoolsStore,
  type ConsoleFilter,
} from "../store/previewDevtoolsStore";
import type { ConsoleEntry } from "../types";

export function PreviewConsoleDrawer() {
  const entries = usePreviewDevtoolsStore((s) => s.consoleEntries);
  const filter = usePreviewDevtoolsStore((s) => s.consoleFilter);
  const search = usePreviewDevtoolsStore((s) => s.consoleSearch);
  const isOpen = usePreviewDevtoolsStore((s) => s.isConsoleOpen);

  const clearConsole = usePreviewDevtoolsStore((s) => s.clearConsole);
  const setFilter = usePreviewDevtoolsStore((s) => s.setConsoleFilter);
  const setSearch = usePreviewDevtoolsStore((s) => s.setConsoleSearch);
  const toggleConsole = usePreviewDevtoolsStore((s) => s.toggleConsole);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const errorCount = entries.filter((e) => e.level === "error").length;
  const warnCount = entries.filter((e) => e.level === "warn").length;
  const logCount = entries.filter(
    (e) => e.level === "log" || e.level === "info",
  ).length;

  const filteredEntries = entries.filter((e) => {
    if (filter === "error" && e.level !== "error") return false;
    if (filter === "warn" && e.level !== "warn") return false;
    if (filter === "log" && e.level !== "log" && e.level !== "info")
      return false;
    if (
      search &&
      !e.message.toLowerCase().includes(search.toLowerCase()) &&
      !e.stack?.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const handleCopyPrompt = (entry: ConsoleEntry) => {
    const prompt = formatConsoleErrorPrompt(entry);
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(prompt);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleJumpToSource = (file?: string, line?: number, column?: number) => {
    if (!file) return;
    window.dispatchEvent(
      new CustomEvent("voktty:jump-to-component", {
        detail: { path: file, line, column },
      }),
    );
  };

  return (
    <div
      className={cn(
        "flex flex-col border-t border-border/70 bg-card/95 backdrop-blur-md transition-all duration-200 ease-out z-20",
        isOpen ? "h-64 shadow-2xl" : "h-7",
      )}
    >
      {/* Console Header Bar */}
      <div className="flex h-7 shrink-0 items-center justify-between px-2 bg-muted/40 select-none border-b border-border/40">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleConsole()}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/90 hover:text-foreground"
          >
            <span className="font-mono text-xs">{isOpen ? "▼" : "▲"}</span>
            <span>Consola</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              ({entries.length})
            </span>
          </button>

          {/* Quick Badges */}
          <div className="flex items-center gap-1 text-[10px] font-mono">
            {errorCount > 0 ? (
              <span
                onClick={() => {
                  setFilter("error");
                  if (!isOpen) toggleConsole(true);
                }}
                className="cursor-pointer rounded bg-red-500/15 px-1.5 py-0.2 text-red-400 hover:bg-red-500/25 border border-red-500/30"
              >
                🔴 {errorCount}
              </span>
            ) : null}

            {warnCount > 0 ? (
              <span
                onClick={() => {
                  setFilter("warn");
                  if (!isOpen) toggleConsole(true);
                }}
                className="cursor-pointer rounded bg-amber-500/15 px-1.5 py-0.2 text-amber-400 hover:bg-amber-500/25 border border-amber-500/30"
              >
                🟡 {warnCount}
              </span>
            ) : null}

            {logCount > 0 ? (
              <span
                onClick={() => {
                  setFilter("all");
                  if (!isOpen) toggleConsole(true);
                }}
                className="cursor-pointer rounded bg-slate-500/15 px-1.5 py-0.2 text-slate-300 hover:bg-slate-500/25 border border-slate-500/30"
              >
                ⚪ {logCount}
              </span>
            ) : null}
          </div>
        </div>

        {isOpen ? (
          <div className="flex items-center gap-1.5">
            {/* Filter Tabs */}
            <div className="flex items-center rounded-md bg-muted/60 p-0.5 text-[10px]">
              {(["all", "error", "warn", "log"] as ConsoleFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded px-2 py-0.5 capitalize transition-colors font-medium",
                    filter === f
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f === "all"
                    ? "Todos"
                    : f === "error"
                      ? "Errores"
                      : f === "warn"
                        ? "Avisos"
                        : "Logs"}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <Input
              type="text"
              placeholder="Filtrar mensajes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-5 w-32 border-border/40 bg-background/60 px-1.5 text-[10px] placeholder:text-muted-foreground/60 shadow-none"
            />

            {/* Clear Button */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={clearConsole}
              title="Limpiar consola"
              className="size-5 rounded text-muted-foreground hover:text-foreground"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} />
            </Button>
          </div>
        ) : null}
      </div>

      {/* Console Log Stream (When open) */}
      {isOpen ? (
        <div className="flex-1 overflow-y-auto font-mono text-[11px] divide-y divide-border/30 bg-background/80">
          {filteredEntries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground/60 text-xs italic py-8">
              {entries.length === 0
                ? "No hay mensajes en consola todavía."
                : "No hay mensajes que coincidan con el filtro."}
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "group flex items-start gap-2 px-3 py-1.5 hover:bg-accent/40 transition-colors",
                  entry.level === "error" &&
                    "bg-red-500/5 text-red-300 dark:text-red-200 border-l-2 border-l-red-500",
                  entry.level === "warn" &&
                    "bg-amber-500/5 text-amber-300 dark:text-amber-200 border-l-2 border-l-amber-500",
                  (entry.level === "log" || entry.level === "info") &&
                    "text-foreground/90 border-l-2 border-l-transparent",
                )}
              >
                {/* Level Icon */}
                <span className="shrink-0 text-xs mt-0.5">
                  {entry.level === "error"
                    ? "❌"
                    : entry.level === "warn"
                      ? "⚠️"
                      : "›"}
                </span>

                {/* Repeat Count */}
                {entry.count > 1 ? (
                  <span className="shrink-0 rounded-full bg-foreground/15 px-1.5 py-0.2 text-[9px] font-bold text-foreground">
                    {entry.count}
                  </span>
                ) : null}

                {/* Message & Stack */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="whitespace-pre-wrap break-words leading-relaxed font-mono">
                    {entry.message}
                  </div>

                  {entry.stack ? (
                    <details className="mt-1 text-[10px] text-muted-foreground/80">
                      <summary className="cursor-pointer hover:text-foreground">
                        Ver Stack Trace
                      </summary>
                      <pre className="mt-1 max-h-32 overflow-x-auto whitespace-pre rounded bg-black/40 p-2 text-[10px] text-muted-foreground font-mono">
                        {entry.stack}
                      </pre>
                    </details>
                  ) : null}
                </div>

                {/* Source File Location */}
                {entry.source?.file ? (
                  <button
                    type="button"
                    onClick={() =>
                      handleJumpToSource(
                        entry.source?.file,
                        entry.source?.line,
                        entry.source?.column,
                      )
                    }
                    className="shrink-0 text-[10px] text-cyan-400 hover:underline hover:text-cyan-300 truncate max-w-[130px]"
                    title={`Abrir ${entry.source.file}`}
                  >
                    {entry.source.file.replace(/^.*[\\/]/, "")}
                    {entry.source.line ? `:${entry.source.line}` : ""}
                  </button>
                ) : null}

                {/* Timestamp */}
                <span className="shrink-0 text-[10px] text-muted-foreground/50 tabular-nums">
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>

                {/* AI Error Solver Action Button */}
                {entry.level === "error" || entry.level === "warn" ? (
                  <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyPrompt(entry)}
                      className="h-5 gap-1 rounded px-1.5 text-[10px] font-medium bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-500/30"
                      title="Copiar prompt completo para resolver este error con la IA"
                    >
                      <HugeiconsIcon
                        icon={copiedId === entry.id ? Copy01Icon : SparklesIcon}
                        size={10}
                      />
                      <span>
                        {copiedId === entry.id ? "Copiado!" : "Resolver con IA"}
                      </span>
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
