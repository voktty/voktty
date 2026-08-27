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
import { Globe02Icon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { isWebPreviewablePath } from "./components/LivePreviewButton";
import {
  type DevServerCapture,
  useDevServerCaptureStore,
} from "./devServerStore";
import { useWebServerStore } from "./store/webServerStore";

const NO_CAPTURES: DevServerCapture[] = [];

type Props = {
  leafId?: number;
  filePath?: string | null;
  cwd?: string | null;
  onOpen: (capture: DevServerCapture) => void;
  onOpenUrl?: (url: string) => void;
};

function captureLabel(capture: DevServerCapture): string {
  try {
    return new URL(capture.url).host;
  } catch {
    return capture.url;
  }
}

export function DevServerPill({
  leafId,
  filePath,
  cwd,
  onOpen,
  onOpenUrl,
}: Props) {
  const { t } = useTranslation();
  const [startingIntegrated, setStartingIntegrated] = useState(false);

  const captures = useDevServerCaptureStore((state) =>
    leafId === undefined
      ? NO_CAPTURES
      : (state.capturesByLeaf[leafId] ?? NO_CAPTURES),
  );

  const internalServers = useWebServerStore((state) =>
    Object.values(state.servers),
  );

  const isWebFile = Boolean(filePath && isWebPreviewablePath(filePath));

  // 1. If active dev servers were detected from terminal
  if (captures.length > 0) {
    if (captures.length === 1 && internalServers.length === 0) {
      const latest = captures[0];
      const label = captureLabel(latest);
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

    const totalCount = captures.length + internalServers.length;
    const label = `${totalCount} · ${t("preview.openPreview")}`;

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
          {internalServers.map((server) => (
            <DropdownMenuItem
              key={server.root_path}
              onSelect={() => {
                if (onOpenUrl) onOpenUrl(server.url);
                else {
                  onOpen({
                    id: `internal-${server.port}`,
                    leafId: leafId ?? 0,
                    ptyId: null,
                    commandGeneration: 0,
                    workspaceKey: "local",
                    cwd: server.root_path,
                    scope: `internal-${server.port}`,
                    url: server.url,
                    detectedAt: Date.now(),
                  });
                }
              }}
            >
              <HugeiconsIcon icon={Globe02Icon} size={13} strokeWidth={1.7} />
              <span>{`${server.server_type.toUpperCase()} · localhost:${server.port}`}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // 2. If an internal web server is already running
  if (internalServers.length > 0) {
    const server = internalServers[0];
    const handleOpenServer = () => {
      if (onOpenUrl) onOpenUrl(server.url);
      else {
        onOpen({
          id: `internal-${server.port}`,
          leafId: leafId ?? 0,
          ptyId: null,
          commandGeneration: 0,
          workspaceKey: "local",
          cwd: server.root_path,
          scope: `internal-${server.port}`,
          url: server.url,
          detectedAt: Date.now(),
        });
      }
    };

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 max-w-48 gap-1.5 rounded-full px-2 text-[10.5px] text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400"
            onClick={handleOpenServer}
          >
            <HugeiconsIcon icon={Globe02Icon} size={12} strokeWidth={1.8} />
            <span className="truncate">{`${server.server_type.toUpperCase()} :${server.port}`}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px]">
          {server.url}
        </TooltipContent>
      </Tooltip>
    );
  }

  // 3. If editing an HTML or PHP file, offer to launch the integrated server
  if (isWebFile && filePath) {
    const handleStartWebFile = async () => {
      setStartingIntegrated(true);
      try {
        const dir = filePath ? filePath.replace(/[/\\][^/\\]+$/, "") : (cwd ?? "");
        if (!dir) return;
        const info = await useWebServerStore.getState().startServer(dir);
        const filename = filePath ? filePath.split(/[/\\]/).pop() || "" : "";
        const url = filename ? `${info.url}/${filename}` : info.url;
        if (onOpenUrl) {
          onOpenUrl(url);
        } else {
          onOpen({
            id: `integrated-${info.port}`,
            leafId: leafId ?? 0,
            ptyId: null,
            commandGeneration: 0,
            workspaceKey: "local",
            cwd: dir,
            scope: `integrated-${info.port}`,
            url,
            detectedAt: Date.now(),
          });
        }
      } catch (err) {
        console.error("Failed to start integrated server for web file:", err);
      } finally {
        setStartingIntegrated(false);
      }
    };

    const ext = filePath.toLowerCase().endsWith(".php") ? "PHP" : "HTML";

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={startingIntegrated}
            className="h-6 max-w-48 gap-1.5 rounded-full px-2 text-[10.5px] text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400"
            onClick={handleStartWebFile}
          >
            <HugeiconsIcon icon={PlayIcon} size={12} strokeWidth={1.8} />
            <span className="truncate">
              {t("preview.openPreview")} ({ext})
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px]">
          {t("tooltips.openLivePreview")}
        </TooltipContent>
      </Tooltip>
    );
  }

  // 4. No web service or previewable file -> completely hidden
  return null;
}
