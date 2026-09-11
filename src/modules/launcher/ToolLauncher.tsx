import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { recordUse } from "@/modules/command-palette/lib/mru";
import { useTranslation } from "@/modules/i18n";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filterLauncherItems, groupLauncherItems } from "./lib/filter";
import { useLauncherStore } from "./store";
import type { LauncherItem } from "./types";

type Props = {
  items: LauncherItem[];
};

/** Grid of operational surfaces and immediate actions. Preferences remain in
 * Settings so every tile here launches or activates actual work. */
export function ToolLauncher({ items }: Props) {
  const { t } = useTranslation();
  const open = useLauncherStore((s) => s.isOpen);
  const closeLauncher = useLauncherStore((s) => s.closeLauncher);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const visible = useMemo(
    () => filterLauncherItems(items, query),
    [items, query],
  );
  // Headers only help while browsing; once a query narrows things down a
  // single grid reads faster than six one-item sections.
  const sections = useMemo(
    () => (query.trim() ? null : groupLauncherItems(visible)),
    [query, visible],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
  }, [open]);

  useEffect(() => {
    setActive((current) => (current < visible.length ? current : 0));
  }, [visible.length]);

  useEffect(() => {
    tileRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const launch = useCallback(
    (item: LauncherItem | undefined) => {
      if (!item) return;
      recordUse(item.id);
      closeLauncher();
      item.run();
    },
    [closeLauncher],
  );

  /** Rows are ragged, since every group ends wherever it ends and the grid
   * reflows with the dialog width. Reading the laid out geometry is honest;
   * a fixed column count would only be right for full rows. */
  const moveByRow = useCallback(
    (direction: 1 | -1) => {
      const rects = tileRefs.current
        .slice(0, visible.length)
        .map((el) => el?.getBoundingClientRect() ?? null);
      const here = rects[active];
      if (!here) return;

      // Bucket by row. Tops within a couple of pixels are the same row.
      const rows: { top: number; indices: number[] }[] = [];
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (!rect) continue;
        const row = rows.find((r) => Math.abs(r.top - rect.top) <= 2);
        if (row) row.indices.push(i);
        else rows.push({ top: rect.top, indices: [i] });
      }
      rows.sort((a, b) => a.top - b.top);

      const currentRow = rows.findIndex((r) => r.indices.includes(active));
      const target = rows[currentRow + direction];
      if (!target) return;

      const centerX = here.left + here.width / 2;
      let best = target.indices[0];
      let bestDx = Number.POSITIVE_INFINITY;
      for (const i of target.indices) {
        const rect = rects[i];
        if (!rect) continue;
        const dx = Math.abs(rect.left + rect.width / 2 - centerX);
        if (dx < bestDx) {
          bestDx = dx;
          best = i;
        }
      }
      setActive(best);
    },
    [active, visible.length],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (visible.length === 0) return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          setActive((i) => (i + 1) % visible.length);
          break;
        case "ArrowLeft":
          e.preventDefault();
          setActive((i) => (i - 1 + visible.length) % visible.length);
          break;
        case "ArrowDown":
          e.preventDefault();
          moveByRow(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          moveByRow(-1);
          break;
        case "Home":
          e.preventDefault();
          setActive(0);
          break;
        case "End":
          e.preventDefault();
          setActive(visible.length - 1);
          break;
        case "Enter":
          e.preventDefault();
          launch(visible[active]);
          break;
        default:
          break;
      }
    },
    [active, launch, moveByRow, visible],
  );

  let flatIndex = 0;
  const renderTile = (item: LauncherItem) => {
    const index = flatIndex++;
    return (
      <Tile
        key={item.id}
        ref={(el) => {
          tileRefs.current[index] = el;
        }}
        item={item}
        active={index === active}
        onPointerEnter={() => setActive(index)}
        onClick={() => launch(item)}
      />
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeLauncher();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-1/2 w-[min(760px,calc(100vw-32px))] max-w-none -translate-y-1/2 gap-0 overflow-hidden p-0"
        onKeyDown={onKeyDown}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("launcher.title")}</DialogTitle>
          <DialogDescription>{t("launcher.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border/60 px-3.5">
          <HugeiconsIcon
            icon={Search01Icon}
            size={15}
            strokeWidth={1.9}
            className="shrink-0 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder={t("launcher.placeholder")}
            aria-label={t("launcher.placeholder")}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            className="h-11 w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>

        <ScrollArea className="max-h-[min(460px,60vh)]">
          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12px] text-muted-foreground">
              {t("launcher.empty")}
            </p>
          ) : sections ? (
            <div className="flex flex-col gap-1 p-2.5">
              {sections.map((section) => (
                <section key={section.group}>
                  <h2 className="px-1.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/85">
                    {t(`launcher.groups.${section.group}`)}
                  </h2>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1">
                    {section.items.map(renderTile)}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1 p-2.5">
              {visible.map(renderTile)}
            </div>
          )}
        </ScrollArea>

        <div className="flex items-center gap-3 border-t border-border/60 px-3.5 py-1.5 text-[10.5px] text-muted-foreground">
          <Hint keys="↑ ↓ ← →" label={t("launcher.hints.navigate")} />
          <Hint keys="Enter" label={t("launcher.hints.launch")} />
          <Hint keys="Esc" label={t("launcher.hints.close")} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border border-border/70 bg-muted/50 px-1 py-px font-mono text-[9.5px] leading-none">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

function Tile({
  ref,
  item,
  active,
  onPointerEnter,
  onClick,
}: {
  ref: (el: HTMLButtonElement | null) => void;
  item: LauncherItem;
  active: boolean;
  onPointerEnter: () => void;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      aria-current={active}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg px-2 py-2.5 text-center transition-colors",
        active ? "bg-accent/70" : "hover:bg-accent/35",
      )}
    >
      <HugeiconsIcon
        icon={item.icon}
        size={20}
        strokeWidth={1.6}
        className={cn("shrink-0", item.tint ?? "text-muted-foreground")}
      />
      <span className="line-clamp-2 text-[11px] leading-tight text-foreground/90">
        {item.title}
      </span>
    </button>
  );
}
