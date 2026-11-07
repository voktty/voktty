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
import { useMemo, useState } from "react";
import { isWebPreviewablePath } from "./components/LivePreviewButton";
import {
  type DevServerCapture,
  useDevServerCaptureStore,
} from "./devServerStore";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import { toast } from "sonner";
import { markPreviewLaunch } from "./lib/previewTunnels";
import { previewPortFor, remoteServerCommand } from "./lib/remoteServer";
import { useWebProjectKind } from "./lib/useWebProjectKind";
import { isLocalProjectRoot, webProjectLabel } from "./lib/webProject";
import { useWebServerStore } from "./store/webServerStore";

const NO_CAPTURES: DevServerCapture[] = [];

type Props = {
  leafId?: number;
  filePath?: string | null;
  cwd?: string | null;
  /** Folder of the active project: on this computer or inside an SSH session. */
  projectRoot?: string | null;
  projectEnv?: WorkspaceEnv;
  /** Types a command into the active terminal; false when there is none. */
  onRunCommand?: (command: string) => boolean;
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

/** Protocol name, identical in every language. */
const SSH_TAG = "SSH";

export function DevServerPill({
  leafId,
  filePath,
  cwd,
  projectRoot,
  projectEnv = LOCAL_WORKSPACE,
  onRunCommand,
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

  const serversMap = useWebServerStore((state) => state.servers);
  const internalServers = useMemo(
    () => Object.values(serversMap),
    [serversMap],
  );

  const isWebFile = Boolean(filePath && isWebPreviewablePath(filePath));
  const project = useWebProjectKind(projectRoot, projectEnv);

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

  // 4a. A web project on a remote host: serve it from the terminal, tunnel it
  if (
    project &&
    projectRoot &&
    projectEnv.kind === "ssh" &&
    projectEnv.sessionId !== undefined &&
    onRunCommand
  ) {
    const sessionId = projectEnv.sessionId;
    const root = projectRoot;
    const handleServeRemote = () => {
      const port = previewPortFor(root);
      markPreviewLaunch(sessionId, port);
      const sent = onRunCommand(remoteServerCommand(project.kind, port, project.docroot));
      if (!sent) toast.error(t("preview.remoteNoTerminal"));
    };
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 max-w-48 gap-1.5 rounded-full px-2 text-[10.5px] text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400"
            onClick={handleServeRemote}
          >
            <HugeiconsIcon icon={PlayIcon} size={12} strokeWidth={1.8} />
            <span className="truncate">
              {`${t("preview.openPreview")} (${webProjectLabel(project.kind)} ${SSH_TAG})`}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 text-[11px]">
          {t("preview.serveRemoteProject", {
            port: String(previewPortFor(root)),
          })}
        </TooltipContent>
      </Tooltip>
    );
  }

  // 4b. A web project is active (Harness or terminal) with nothing running yet
  if (project && projectEnv.kind === "local" && isLocalProjectRoot(projectRoot)) {
    const projectKind = project.kind;
    const root = projectRoot;
    const handleStartProject = async () => {
      setStartingIntegrated(true);
      try {
        const info = await useWebServerStore.getState().startServer(root);
        onOpen({
          id: `integrated-${info.port}`,
          leafId: leafId ?? 0,
          ptyId: null,
          commandGeneration: 0,
          workspaceKey: "local",
          cwd: root,
          scope: `integrated-${info.port}`,
          url: info.url,
          detectedAt: Date.now(),
        });
      } catch (err) {
        console.error("Failed to start integrated server for project:", err);
      } finally {
        setStartingIntegrated(false);
      }
    };

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={startingIntegrated}
            className="h-6 max-w-48 gap-1.5 rounded-full px-2 text-[10.5px] text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400"
            onClick={handleStartProject}
          >
            <HugeiconsIcon icon={PlayIcon} size={12} strokeWidth={1.8} />
            <span className="truncate">
              {t("preview.openPreview")} ({webProjectLabel(projectKind)})
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px]">
          {t("preview.openProjectPreview", { root })}
        </TooltipContent>
      </Tooltip>
    );
  }

  // 5. No web service, previewable file or web project -> completely hidden
  return null;
}
