import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  Cancel01Icon,
  ComputerIcon,
  SecurityIcon,
  Tv02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

type Props = {
  host: string;
  resolution: { width: number; height: number };
  scaleMode: "fit" | "1:1";
  onToggleScaleMode: () => void;
  onSendCtrlAltDel: () => void;
  onSendWinKey: () => void;
  onDisconnect: () => void;
};

export function RdpFloatingToolbar({
  host,
  resolution,
  scaleMode,
  onToggleScaleMode,
  onSendCtrlAltDel,
  onSendWinKey,
  onDisconnect,
}: Props) {
  const { t } = useTranslation();
  const [pinned, setPinned] = useState(false);

  return (
    <div
      className={cn(
        "absolute top-0 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-b-xl border border-t-0 border-border/40 bg-background/85 backdrop-blur-md shadow-lg transition-transform duration-200",
        !pinned && "hover:translate-y-0 -translate-y-[calc(100%-8px)] hover:shadow-xl",
      )}
    >
      {/* Handle indicator when collapsed */}
      {!pinned && (
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-muted-foreground/30" />
      )}

      {/* Host / Resolution Badge */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium text-foreground/80">
        <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="font-mono">{host}</span>
        <span className="text-muted-foreground text-[10px]">
          ({resolution.width}x{resolution.height})
        </span>
      </div>

      <div className="h-4 w-px bg-border/40" />

      {/* Action Buttons */}
      <button
        type="button"
        onClick={onSendCtrlAltDel}
        title={t("tooltips.sendCtrlAltDel")}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
      >
        <HugeiconsIcon icon={SecurityIcon} size={13} />
        <span>Ctrl+Alt+Del</span>
      </button>

      <button
        type="button"
        onClick={onSendWinKey}
        title={t("tooltips.sendWindowsKey")}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
      >
        <HugeiconsIcon icon={ComputerIcon} size={13} />
        <span>Win</span>
      </button>

      <button
        type="button"
        onClick={onToggleScaleMode}
        title={
          scaleMode === "fit"
            ? t("rdp.toolbar.originalResolution")
            : t("rdp.toolbar.fitToWindow")
        }
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
      >
        <HugeiconsIcon
          icon={Tv02Icon}
          size={13}
        />
        <span>{scaleMode === "fit" ? t("rdp.toolbar.fit") : "1:1"}</span>
      </button>

      <button
        type="button"
        onClick={() => setPinned((p) => !p)}
        title={
          pinned ? t("rdp.toolbar.unpinToolbar") : t("rdp.toolbar.pinToolbar")
        }
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
          pinned
            ? "text-primary bg-primary/10"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
        )}
      >
        <span>
          {pinned ? t("rdp.toolbar.pinned") : t("rdp.toolbar.pin")}
        </span>
      </button>

      <div className="h-4 w-px bg-border/40" />

      {/* Disconnect Button */}
      <button
        type="button"
        onClick={onDisconnect}
        title={t("rdp.disconnect")}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={13} />
        <span>{t("rdp.disconnect")}</span>
      </button>
    </div>
  );
}
