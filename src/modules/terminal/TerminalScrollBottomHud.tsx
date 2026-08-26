import { useTranslation } from "@/modules/i18n";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useEffect, useState } from "react";
import {
  getLeafScrollInfo,
  scrollLeafToBottom,
  subscribeLeafScroll,
  type TerminalScrollInfo,
} from "./lib/useTerminalSession";

type Props = {
  leafId: number;
  visible: boolean;
};

export const TerminalScrollBottomHud = memo(function TerminalScrollBottomHud({
  leafId,
  visible,
}: Props) {
  const { t } = useTranslation();
  const [scrollInfo, setScrollInfo] = useState<TerminalScrollInfo>(() =>
    getLeafScrollInfo(leafId),
  );

  useEffect(() => {
    if (!visible) return;
    setScrollInfo(getLeafScrollInfo(leafId));
    return subscribeLeafScroll(leafId, () => {
      setScrollInfo(getLeafScrollInfo(leafId));
    });
  }, [leafId, visible]);

  if (!visible || !scrollInfo.isScrolledUp) {
    return null;
  }

  const tooltip = scrollInfo.snippet
    ? `${t("terminal.scrollToBottom")}: ${scrollInfo.snippet}`
    : t("terminal.scrollToBottom");

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-30 flex max-w-[calc(100%-2rem)] md:max-w-md items-center animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
      <button
        type="button"
        onClick={() => scrollLeafToBottom(leafId)}
        title={tooltip}
        className="pointer-events-auto group flex items-center gap-2 rounded-full border border-border/80 bg-background/90 hover:bg-card hover:border-primary/40 px-3 py-1.5 text-xs text-foreground shadow-lg backdrop-blur-md transition-all hover:shadow-xl cursor-pointer active:scale-95"
      >
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          strokeWidth={2.2}
          className="text-primary shrink-0 transition-transform group-hover:translate-y-0.5"
        />
        {scrollInfo.snippet ? (
          <span className="truncate font-mono text-[11px] text-muted-foreground group-hover:text-foreground">
            {scrollInfo.snippet}
          </span>
        ) : (
          <span className="font-medium text-[11px] text-muted-foreground group-hover:text-foreground">
            {t("terminal.scrollToBottom")}
          </span>
        )}
        <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-mono font-medium text-primary">
          {scrollInfo.linesAbove} ↓
        </span>
      </button>
    </div>
  );
});
