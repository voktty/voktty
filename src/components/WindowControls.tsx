import { useTranslation } from "@/modules/i18n";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  Copy01Icon,
  MinusSignIcon,
  SquareIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

export type WindowControlsProps = {
  /** Render only the close button (used by the settings window). */
  closeOnly?: boolean;
  /** Visual presentation: 'standard' (floating buttons) or 'strip' (edge-to-edge buttons). */
  variant?: "standard" | "strip";
  className?: string;
};

export function WindowControls({
  closeOnly = false,
  variant = "standard",
  className,
}: WindowControlsProps) {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!USE_CUSTOM_WINDOW_CONTROLS || closeOnly) return;
    const w = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    const syncMaximized = (isMax: boolean) => {
      setMaximized(isMax);
      if (isMax) {
        document.documentElement.dataset.maximized = "true";
      } else {
        delete document.documentElement.dataset.maximized;
      }
    };
    void w.isMaximized().then(syncMaximized);
    void w
      .onResized(() => {
        void w.isMaximized().then(syncMaximized);
      })
      .then((un) => {
        unlisten = un;
      });
    return () => unlisten?.();
  }, [closeOnly]);

  if (!USE_CUSTOM_WINDOW_CONTROLS) return null;

  const w = getCurrentWindow();

  return (
    <div
      className={cn(
        "window-controls",
        variant === "strip" && "window-controls-strip",
        variant === "standard" && "pr-1",
        className,
      )}
      data-tauri-drag-region="false"
    >
      {!closeOnly && (
        <>
          <CtlButton
            ariaLabel={t("windowControls.minimize")}
            variant={variant}
            className="window-control-button-minimize"
            onClick={() => void w.minimize()}
          >
            <HugeiconsIcon icon={MinusSignIcon} size={12} strokeWidth={2} />
          </CtlButton>
          <CtlButton
            ariaLabel={
              maximized
                ? t("windowControls.restore")
                : t("windowControls.maximize")
            }
            variant={variant}
            className="window-control-button-maximize"
            onClick={() => void w.toggleMaximize()}
          >
            <HugeiconsIcon
              icon={maximized ? Copy01Icon : SquareIcon}
              size={12}
              strokeWidth={2}
            />
          </CtlButton>
        </>
      )}
      <CtlButton
        ariaLabel={t("windowControls.close")}
        variant={variant}
        className="window-control-button-close"
        onClick={() => void w.close()}
        danger
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
      </CtlButton>
    </div>
  );
}

function CtlButton({
  ariaLabel,
  onClick,
  children,
  danger,
  variant,
  className,
}: {
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  variant: "standard" | "strip";
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      data-tauri-drag-region="false"
      className={cn(
        "window-control-button",
        variant === "strip"
          ? "window-control-button-strip"
          : "window-control-button-standard",
        danger && "window-control-button-close",
        className,
      )}
    >
      <span className="window-control-icon flex items-center justify-center pointer-events-none">
        {children}
      </span>
    </button>
  );
}
