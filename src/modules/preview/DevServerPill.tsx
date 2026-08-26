import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/modules/i18n";
import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type DevServerCapture,
  useDevServerCaptureStore,
} from "./devServerStore";

const NO_CAPTURES: DevServerCapture[] = [];

type Props = {
  leafId?: number;
  onOpen: (capture: DevServerCapture) => void;
};

function captureLabel(capture: DevServerCapture): string {
  try {
    return new URL(capture.url).host;
  } catch {
    return capture.url;
  }
}

export function DevServerPill({ leafId, onOpen }: Props) {
  const { t } = useTranslation();
  const captures = useDevServerCaptureStore((state) =>
    leafId === undefined
      ? NO_CAPTURES
      : (state.capturesByLeaf[leafId] ?? NO_CAPTURES),
  );
  if (captures.length === 0) return null;

  const latest = captures[captures.length - 1];
  const label =
    captures.length === 1
      ? captureLabel(latest)
      : `${captures.length} · ${t("preview.openPreview")}`;

  if (captures.length === 1) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 max-w-48 gap-1.5 rounded-full px-2 text-[10.5px] text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400"
            onClick={() => onOpen(latest)}
          >
            <HugeiconsIcon icon={Globe02Icon} size={12} strokeWidth={1.8} />
            <span className="truncate">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px]">
          {t("preview.devServerDetected", { url: latest.url })}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 max-w-48 gap-1.5 rounded-full px-2 text-[10.5px] text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400"
          title={t("preview.openPreview")}
        >
          <HugeiconsIcon icon={Globe02Icon} size={12} strokeWidth={1.8} />
          <span className="truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {captures.map((capture) => (
          <DropdownMenuItem key={capture.id} onSelect={() => onOpen(capture)}>
            <HugeiconsIcon icon={Globe02Icon} size={13} strokeWidth={1.7} />
            <span>{captureLabel(capture)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
