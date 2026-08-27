import { memo, useCallback } from "react";
import { useTerminalSuggestStore } from "./lib/terminalSuggestStore";
import { Clock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { submitToLeaf, writeToSession } from "./lib/useTerminalSession";
import { cn } from "@/lib/utils";

type Props = {
  leafId: number;
  visible?: boolean;
};

export const TerminalInlineSuggest = memo(function TerminalInlineSuggest({
  leafId,
  visible = true,
}: Props) {
  const data = useTerminalSuggestStore((s) => s.suggestByLeaf[leafId]);

  const handleSelect = useCallback(
    (cmd: string, execute = false) => {
      if (!data) return;
      const remainder = cmd.startsWith(data.query)
        ? cmd.slice(data.query.length)
        : cmd;
      if (execute) {
        submitToLeaf(leafId, cmd);
      } else {
        writeToSession(leafId, remainder);
      }
      useTerminalSuggestStore.getState().clear(leafId);
    },
    [data, leafId],
  );

  if (!visible || !data || !data.open || data.items.length === 0) {
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
  } = data;

  // Ensure popover doesn't overflow container bounds
  const popoverWidth = Math.min(520, Math.max(300, containerWidth - 40));
  const popoverLeft = Math.max(
    10,
    Math.min(lineX, containerWidth - popoverWidth - 10),
  );

  const isNearBottom = lineY + 220 > containerHeight;
  const popoverTop = isNearBottom
    ? Math.max(10, lineY - cellHeight - 220)
    : lineY + 4;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden font-mono select-none">
      {/* Ghost text inline after cursor */}
      {ghostTail && (
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
          maxHeight: "220px",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-2.5 py-1 text-[11px] font-semibold text-foreground">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <HugeiconsIcon icon={Clock01Icon} size={12} strokeWidth={2} />
            <span className="text-foreground">History</span>
          </div>
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-mono text-primary">
            {`<History(${items.length})>`}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-1 text-xs">
          {items.map((cmd, idx) => {
            const selected = idx === selectedIndex;
            const startsWithQuery = cmd
              .toLowerCase()
              .startsWith(query.toLowerCase());
            const matchLength = startsWithQuery ? query.length : 0;

            return (
              <button
                type="button"
                key={`${idx}-${cmd}`}
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
                <span className="flex-1 truncate">
                  {matchLength > 0 ? (
                    <>
                      <span className="text-primary font-semibold">
                        {cmd.slice(0, matchLength)}
                      </span>
                      <span>{cmd.slice(matchLength)}</span>
                    </>
                  ) : (
                    cmd
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground/70 font-sans">
                  [History]
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border/50 bg-muted/20 px-2.5 py-1 text-[10px] text-muted-foreground">
          <span>Tab / → complete · ↑↓ navigate</span>
          <span>Esc dismiss</span>
        </div>
      </div>
    </div>
  );
});
