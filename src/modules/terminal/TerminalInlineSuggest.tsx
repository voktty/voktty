import { memo, useCallback, useEffect, useRef } from "react";
import { useTerminalSuggestStore } from "./lib/terminalSuggestStore";
import {
  Cancel01Icon,
  Clock01Icon,
  CommandLineIcon,
  File01Icon,
  Folder01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { submitToLeaf, writeToSession } from "./lib/useTerminalSession";
import { historyList } from "./block/lib/history";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";

type Props = {
  leafId: number;
  visible?: boolean;
};

export const TerminalInlineSuggest = memo(function TerminalInlineSuggest({
  leafId,
  visible = true,
}: Props) {
  const { t } = useTranslation();
  const data = useTerminalSuggestStore((s) => s.suggestByLeaf[leafId]);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSelect = useCallback(
    (cmd: string, execute = false) => {
      if (!data) return;
      const query = data.query;
      if (cmd.startsWith(query)) {
        const remainder = cmd.slice(query.length);
        if (execute) {
          submitToLeaf(leafId, cmd);
        } else {
          if (remainder) writeToSession(leafId, remainder);
        }
      } else {
        const erase = "\x7f".repeat(query.length);
        writeToSession(leafId, erase + cmd + (execute ? "\r" : ""));
      }
      useTerminalSuggestStore.getState().clear(leafId);
    },
    [data, leafId],
  );

  // Auto-focus search input when searchMode opens
  useEffect(() => {
    if (data?.searchMode) {
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 30);
    }
  }, [data?.searchMode]);

  // Scroll active item into view
  useEffect(() => {
    if (data?.selectedIndex !== undefined && listRef.current) {
      const active = listRef.current.querySelector(
        `[data-index="${data.selectedIndex}"]`,
      );
      active?.scrollIntoView({ block: "nearest" });
    }
  }, [data?.selectedIndex]);

  const handleSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val.trim()) {
      useTerminalSuggestStore.getState().setSearchFilter(leafId, "");
      return;
    }
    try {
      const list = await historyList(val, undefined, 20);
      const items = list.map((entry) => entry.cmd);
      useTerminalSuggestStore.getState().setSearchFilter(leafId, val, items);
    } catch {
      useTerminalSuggestStore.getState().setSearchFilter(leafId, val);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!data) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      useTerminalSuggestStore.getState().selectNext(leafId);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      useTerminalSuggestStore.getState().selectPrev(leafId);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = data.items[data.selectedIndex] ?? data.items[0];
      if (item) {
        handleSelect(item, e.shiftKey);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      useTerminalSuggestStore.getState().toggleSearch(leafId, false);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const item = data.items[data.selectedIndex] ?? data.items[0];
      if (item) {
        handleSelect(item, false);
      }
    }
  };

  if (!visible || !data || !data.open || (data.items.length === 0 && !data.searchMode)) {
    return null;
  }

  const {
    query,
    items,
    selectedIndex,
    ghostTail,
    cursorY,
    cellHeight,
    lineX,
    lineY,
    containerWidth,
    containerHeight,
    searchMode,
    searchFilter,
  } = data;

  // Ensure popover doesn't overflow container bounds
  const popoverWidth = Math.min(540, Math.max(320, containerWidth - 40));
  const popoverLeft = Math.max(
    10,
    Math.min(lineX, containerWidth - popoverWidth - 10),
  );

  const isNearBottom = lineY + 240 > containerHeight;
  const popoverTop = isNearBottom
    ? Math.max(10, lineY - cellHeight - 240)
    : lineY + 4;

  const highlightTerm = searchMode && searchFilter ? searchFilter : query;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden font-mono select-none">
      {/* Ghost text inline after cursor */}
      {ghostTail && !searchMode && (
        <div
          className="pointer-events-none absolute whitespace-pre text-muted-foreground/50 select-none"
          style={{
            left: `${lineX}px`,
            top: `${cursorY * cellHeight}px`,
            height: `${cellHeight}px`,
            lineHeight: `${cellHeight}px`,
            fontSize: "var(--terminal-font-size, 13px)",
            fontFamily: "var(--terminal-font-family, monospace)",
          }}
        >
          {ghostTail}
        </div>
      )}

      {/* Suggestion popover list */}
      <div
        className="pointer-events-auto absolute flex flex-col rounded-lg border border-border/80 bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-100"
        style={{
          left: `${popoverLeft}px`,
          top: `${popoverTop}px`,
          width: `${popoverWidth}px`,
          maxHeight: "260px",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Popover Header */}
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-2.5 py-1 text-[11px] font-semibold text-foreground">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <HugeiconsIcon icon={Clock01Icon} size={12} strokeWidth={2} />
            <span className="text-foreground">{t("terminal.history.title")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                useTerminalSuggestStore.getState().toggleSearch(leafId)
              }
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-sans transition-colors cursor-pointer",
                searchMode
                  ? "bg-primary/20 text-primary font-medium"
                  : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              title={t("terminal.history.searchPlaceholder")}
            >
              <HugeiconsIcon icon={Search01Icon} size={10} />
              <span>{searchMode ? t("common.search") : "Alt+F"}</span>
            </button>
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-mono text-primary">
              {items.length}
            </span>
          </div>
        </div>

        {/* Filter Input Bar */}
        {searchMode && (
          <div className="flex items-center gap-1.5 border-b border-border/50 bg-background/90 px-2.5 py-1">
            <HugeiconsIcon
              icon={Search01Icon}
              size={12}
              className="text-primary shrink-0"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchFilter ?? ""}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("terminal.history.searchPlaceholder")}
              className="flex-1 bg-transparent text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground/60"
            />
            {searchFilter && (
              <button
                type="button"
                onClick={() =>
                  useTerminalSuggestStore.getState().setSearchFilter(leafId, "")
                }
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={11} />
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                useTerminalSuggestStore.getState().toggleSearch(leafId, false)
              }
              className="text-muted-foreground hover:text-foreground text-[10px] font-sans px-1 py-0.5 rounded hover:bg-muted cursor-pointer"
            >
              Esc
            </button>
          </div>
        )}

        {/* List of Suggestions */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-1 text-xs">
          {items.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              {t("terminal.history.noResults")}
            </div>
          ) : (
            items.map((cmd, idx) => {
              const selected = idx === selectedIndex;
              const termLower = highlightTerm.toLowerCase();
              const cmdLower = cmd.toLowerCase();
              const matchIdx = termLower ? cmdLower.indexOf(termLower) : -1;
              const struct = data.structuredItems?.[idx];

              const kind = struct?.kind ?? "history";
              const KindIcon =
                kind === "folder"
                  ? Folder01Icon
                  : kind === "file"
                    ? File01Icon
                    : kind === "command"
                      ? CommandLineIcon
                      : Clock01Icon;

              const iconToneClass =
                kind === "folder"
                  ? "text-amber-500/90 dark:text-amber-400/90"
                  : kind === "file"
                    ? "text-sky-500/90 dark:text-sky-400/90"
                    : kind === "command"
                      ? "text-emerald-500/90 dark:text-emerald-400/90"
                      : "text-muted-foreground/70";

              return (
                <button
                  type="button"
                  key={`${idx}-${cmd}`}
                  data-index={idx}
                  onClick={() => handleSelect(cmd, false)}
                  onDoubleClick={() => handleSelect(cmd, true)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[12px] transition-colors cursor-pointer",
                    selected
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-foreground/90 hover:bg-accent/50",
                  )}
                >
                  <span className="shrink-0 text-muted-foreground/60 text-[11px]">
                    {selected ? "❯" : " "}
                  </span>
                  <HugeiconsIcon
                    icon={KindIcon}
                    size={13}
                    className={cn("shrink-0", iconToneClass)}
                  />
                  <span className="flex-1 truncate">
                    {matchIdx !== -1 ? (
                      <>
                        <span>{cmd.slice(0, matchIdx)}</span>
                        <span className="text-primary font-semibold underline decoration-primary/40 underline-offset-2">
                          {cmd.slice(matchIdx, matchIdx + highlightTerm.length)}
                        </span>
                        <span>{cmd.slice(matchIdx + highlightTerm.length)}</span>
                      </>
                    ) : (
                      cmd
                    )}
                  </span>
                  {struct?.detail && (
                    <span className="shrink-0 rounded bg-muted/60 px-1 py-0.2 text-[9px] text-muted-foreground">
                      {struct.detail}
                    </span>
                  )}
                  <span className="shrink-0 text-[10px] text-muted-foreground/60 font-mono">
                    #{idx + 1}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Popover Footer */}
        <div className="flex items-center justify-between border-t border-border/50 bg-muted/20 px-2.5 py-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span>
              <kbd className="rounded bg-muted px-1 py-0.2 border border-border/40 text-[9.5px]">
                Tab
              </kbd>{" "}
              /{" "}
              <kbd className="rounded bg-muted px-1 py-0.2 border border-border/40 text-[9.5px]">
                →
              </kbd>{" "}
              {t("terminal.history.hintInsert")}
            </span>
            <span>
              <kbd className="rounded bg-muted px-1 py-0.2 border border-border/40 text-[9.5px]">
                ↑↓
              </kbd>
            </span>
            <span>
              <kbd className="rounded bg-muted px-1 py-0.2 border border-border/40 text-[9.5px]">
                Alt+F
              </kbd>{" "}
              {t("common.search")}
            </span>
          </span>
          <span>
            <kbd className="rounded bg-muted px-1 py-0.2 border border-border/40 text-[9.5px]">
              Esc
            </kbd>{" "}
            {t("common.close")}
          </span>
        </div>
      </div>
    </div>
  );
});
