import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { fmtShortcut } from "@/lib/platform";
import type { PresenceState } from "@/lib/usePresence";
import { useTranslation } from "@/modules/i18n";
import { useShortcutLabel } from "@/modules/shortcuts";
import { ChatBotIcon, SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type SelectionAskAiProps = {
  state: PresenceState;
  x: number;
  y: number;
  top?: number;
  bottom?: number;
  onAsk: () => void;
  onEdit?: () => void;
  onDismiss: () => void;
};

const TOP_BAR_SAFE_ZONE = 76; // Header and tab bar boundary
const BOTTOM_SAFE_ZONE = 12;

export function SelectionAskAi({
  state,
  x,
  y,
  top,
  bottom,
  onAsk,
  onEdit,
  onDismiss,
}: SelectionAskAiProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  }>({
    width: 250,
    height: 36,
  });

  const open = state === "open";
  const shortcut = fmtShortcut(
    ...useShortcutLabel("ai.askSelection").split(" ").filter(Boolean),
  );

  // Measure actual DOM dimensions of the toolbar
  useLayoutEffect(() => {
    if (menuRef.current && open) {
      const rect = menuRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  // Compute smart top & left coordinates to never get lost on top or cut off horizontally
  const pos = useMemo(() => {
    const halfWidth = dimensions.width / 2;
    const left = Math.max(
      12,
      Math.min(x - halfWidth, window.innerWidth - dimensions.width - 16),
    );

    // Calculate vertical placement
    const selectionTop = typeof top === "number" && top > 0 ? top : y;
    const selectionBottom =
      typeof bottom === "number" && bottom > 0 ? bottom : y + 24;

    let computedTop = selectionTop - dimensions.height - 8;

    // If placing above would hit the tab bar or top window header, place below the selection
    if (computedTop < TOP_BAR_SAFE_ZONE) {
      computedTop = Math.max(TOP_BAR_SAFE_ZONE, selectionBottom + 8);
    }

    // If placing below overflows the bottom edge of the window, clamp it
    if (
      computedTop + dimensions.height >
      window.innerHeight - BOTTOM_SAFE_ZONE
    ) {
      computedTop = Math.max(
        TOP_BAR_SAFE_ZONE,
        window.innerHeight - dimensions.height - BOTTOM_SAFE_ZONE,
      );
    }

    return { top: computedTop, left };
  }, [x, y, top, bottom, dimensions]);

  return (
    <div
      ref={menuRef}
      data-selection-ask-ai
      data-state={state}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-50 flex max-w-[96vw] items-center gap-1 overflow-x-auto rounded-xl border border-border/80 bg-popover/95 p-1 text-popover-foreground shadow-2xl backdrop-blur-xl duration-150 ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-1 scrollbar-none"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAsk();
          onDismiss();
        }}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        title={t("ai.selection.askTitle")}
      >
        <HugeiconsIcon
          icon={ChatBotIcon}
          size={13}
          className="text-violet-400"
        />
        <span>{t("ai.selection.askVoktty")}</span>
        <KbdGroup>
          <Kbd className="h-4 min-w-4 px-1 text-[9.5px]">{shortcut}</Kbd>
        </KbdGroup>
      </button>

      {onEdit ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
            onDismiss();
          }}
          className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-amber-300 transition-colors"
          title={t("ai.selection.editTitle")}
        >
          <HugeiconsIcon
            icon={SparklesIcon}
            size={13}
            className="text-amber-400"
          />
          <span className="hidden sm:inline">{t("ai.selection.edit")}</span>
          <KbdGroup>
            <Kbd className="h-4 px-1 text-[9.5px]">Ctrl+K</Kbd>
          </KbdGroup>
        </button>
      ) : null}

    </div>
  );
}
