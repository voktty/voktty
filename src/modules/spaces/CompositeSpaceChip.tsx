import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  ArrowRight01Icon,
  ComputerScreenShareIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { SpaceAvatar } from "./SpaceAvatar";
import { SPACE_COLORS } from "./lib/spaceColor";
import type { ProjectedSpaceItem } from "./lib/spaceProjection";

type Props = {
  item: ProjectedSpaceItem;
  active: boolean;
  compact?: boolean;
  className?: string;
  onSelect: (spaceId: string) => void;
  onExpand: (spaceId: string) => void;
  onRename?: (spaceId: string, name: string) => void;
  onSetColor?: (spaceId: string, color: number | undefined) => void;
};

export function CompositeSpaceChip({
  item,
  active,
  compact = false,
  onSelect,
  onExpand,
  onRename,
  onSetColor,
  className,
}: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const focusedTab = item.tabs.find((tab) => tab.tabKey === item.activeTabKey);
  const count = item.tabs.length;

  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  const finishRename = (value: string, explicit: boolean) => {
    const next = value.trim();
    if (next && (explicit || next !== item.space.name)) {
      onRename?.(item.space.id, next);
    }
    setEditing(false);
  };

  const beginRename = () => {
    if (onRename) setEditing(true);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-space-id={item.space.id}
          data-tab-active={active ? "true" : undefined}
          className={cn(
            "group relative z-[1] flex h-6.5 shrink-0 items-center gap-1 rounded-md px-1 text-[11.5px] transition-colors",
            active
              ? "text-foreground"
              : "text-muted-foreground hover:bg-accent/70 hover:text-foreground/90",
            compact && "px-0.5",
            className,
          )}
        >
          {editing ? (
            <input
              ref={inputRef}
              defaultValue={item.space.name}
              aria-label={t("spaces.renameSpace")}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  finishRename(event.currentTarget.value, true);
                } else if (event.key === "Escape") {
                  setEditing(false);
                }
              }}
              onBlur={(event) => {
                if (document.hasFocus()) {
                  finishRename(event.currentTarget.value, false);
                }
              }}
              className="h-5 min-w-0 flex-1 rounded-sm bg-background px-1 text-[11.5px] text-foreground outline-none ring-1 ring-border focus:ring-ring"
            />
          ) : (
            <button
              type="button"
              title={`${item.space.name} (${count})`}
              aria-label={item.space.name}
              onClick={() => onSelect(item.space.id)}
              onDoubleClick={(event) => {
                event.preventDefault();
                beginRename();
              }}
              className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <SpaceAvatar space={item.space} size="sm" active={active} />
              <span className="max-w-32 truncate font-medium text-[11.5px]">
                {item.space.name}
              </span>
              <span className="text-[9.5px] tabular-nums text-muted-foreground/70">
                {count}
              </span>
              {focusedTab && (
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-primary/80"
                />
              )}
            </button>
          )}
          <button
            type="button"
            data-no-drag
            aria-label={t("spaces.unmountSpace")}
            title={t("spaces.unmountSpace")}
            onClick={(event) => {
              event.stopPropagation();
              onExpand(item.space.id);
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100"
          >
            ×
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64 p-1">
        <ContextMenuLabel className="truncate px-2 py-1 text-xs">
          {item.space.name}
        </ContextMenuLabel>
        <ContextMenuItem
          className="h-8 px-2 text-xs"
          disabled={!onRename}
          onSelect={beginRename}
        >
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={1.75} />
          <span>{t("spaces.renameSpace")}</span>
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger className="h-8 px-2 text-xs">
            <span
              aria-hidden
              className="size-3 rounded-full ring-1 ring-black/10 dark:ring-white/15"
              style={{ backgroundColor: SPACE_COLORS[item.space.color ?? 0] }}
            />
            <span>{t("spaces.color")}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-40 p-1">
            <div className="grid grid-cols-4 gap-1 p-1">
              {SPACE_COLORS.map((color, index) => (
                <button
                  key={color}
                  type="button"
                  disabled={!onSetColor}
                  aria-label={t("spaces.colorOption", { index: index + 1 })}
                  title={t("spaces.colorOption", { index: index + 1 })}
                  onClick={() => onSetColor?.(item.space.id, index)}
                  className={cn(
                    "size-7 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 dark:ring-white/15",
                    item.space.color === index &&
                      "ring-2 ring-foreground ring-offset-2 ring-offset-popover",
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
              <button
                type="button"
                disabled={!onSetColor}
                aria-label={t("spaces.resetColor")}
                title={t("spaces.resetColor")}
                onClick={() => onSetColor?.(item.space.id, undefined)}
                className="size-7 rounded-full border border-border bg-background text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                ×
              </button>
            </div>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="h-8 px-2 text-xs"
          onSelect={() => onExpand(item.space.id)}
        >
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.75} />
          <span>{t("spaces.unmountSpace")}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled className="h-8 px-2 text-xs">
          <HugeiconsIcon
            icon={ComputerScreenShareIcon}
            size={16}
            strokeWidth={1.75}
            className="shrink-0"
          />
          <span>{t("spaces.shareSpace")}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
