import { Cancel01Icon, Target01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";
import type { LiveComponentMetadata } from "../types";
import {
  formatComponentBadgeLabel,
  formatComponentLocation,
  useLiveComponentStore,
} from "../store/liveComponentStore";

type Props = {
  component?: LiveComponentMetadata | null;
  onClear?: () => void;
  compact?: boolean;
  className?: string;
};

export function LiveComponentBadge({
  component: propComp,
  onClear,
  compact = false,
  className = "",
}: Props) {
  const { t } = useTranslation();
  const storeComp = useLiveComponentStore((s) => s.selectedComponent);
  const clearSelection = useLiveComponentStore((s) => s.clearSelection);

  const comp = propComp ?? storeComp;
  if (!comp) return null;

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClear) onClear();
    else clearSelection();
  };

  const label = formatComponentBadgeLabel(comp);
  const location = formatComponentLocation(comp);

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-400 select-none animate-in fade-in duration-150 ${className}`}
        title={`${comp.selector}\n${comp.htmlSnippet}`}
      >
        <HugeiconsIcon
          icon={Target01Icon}
          size={12}
          strokeWidth={2}
          className="text-cyan-400 shrink-0"
        />
        <span className="font-medium font-mono truncate max-w-[140px]">
          {label}
        </span>
        {comp.filePath ? (
          <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
            ({location})
          </span>
        ) : null}
        <button
          type="button"
          onClick={handleClear}
          title={t("preview.clearSelection")}
          className="rounded p-0.5 text-cyan-400/70 hover:bg-cyan-500/20 hover:text-cyan-200 transition-colors"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-2.5 py-1.5 text-xs text-foreground backdrop-blur-sm select-none ${className}`}
    >
      <div className="flex size-5 items-center justify-center rounded-md bg-cyan-500/20 text-cyan-400 shrink-0">
        <HugeiconsIcon icon={Target01Icon} size={13} strokeWidth={2} />
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium font-mono text-cyan-300 truncate">
            {label}
          </span>
          {comp.framework !== "dom-generic" ? (
            <span className="rounded bg-cyan-500/15 px-1 py-0.2 text-[9px] uppercase tracking-wider font-semibold text-cyan-400">
              {comp.framework}
            </span>
          ) : null}
        </div>
        <span className="text-[10.5px] text-muted-foreground font-mono truncate">
          {location}
        </span>
      </div>
      <button
        type="button"
        onClick={handleClear}
        title={t("preview.clearSelection")}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
      </button>
    </div>
  );
}
