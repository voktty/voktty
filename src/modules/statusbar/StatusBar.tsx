import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChatStore } from "@/modules/ai";
import { AgentStatusPill } from "@/modules/ai/components/AgentStatusPill";
import { AiOpenButton } from "@/modules/ai/components/AiStatusBarControls";
import {
  SearchInline,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import { useTranslation } from "@/modules/i18n";
import { DockerControlPill } from "@/modules/docker";
import { LspStatusPill } from "@/modules/lsp";
import { DevServerPill, type DevServerCapture } from "@/modules/preview";
import { SerialControlPill } from "@/modules/serial";
import type { SshConnection } from "@/modules/ssh";
import type {
  DockerWorkspaceConnection,
  WorkspaceEnv,
} from "@/modules/workspace";
import { IncognitoIcon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type RefObject, useState } from "react";
import { cn } from "@/lib/utils";
import { CwdBreadcrumb } from "./CwdBreadcrumb";
import { DiagnosticsBadge } from "./DiagnosticsBadge";
import { EditorStatus } from "./EditorStatus";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";

import { ConsoleUptimeWidget } from "./components/ConsoleUptimeWidget";
import { ProjectToolkitPopover } from "./components/ProjectToolkitPopover";
import { FloatingArcadeWidget } from "./components/FloatingArcadeWidget";
import { PacmanIcon } from "./components/PacmanIcon";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  onWorkspaceChange: (env: WorkspaceEnv) => void;
  onConnectSsh?: (conn: SshConnection) => void;
  onConnectDocker?: (conn: DockerWorkspaceConnection) => void;
  onConnectRdp?: (conn: import("@/modules/rdp").RdpConnectionProfile) => void;
  onNewSsh?: () => void;
  onNewRdp?: () => void;
  onNewSerial?: () => void;
  activeWorkspaceEnv?: WorkspaceEnv;
  activeLeafId?: number;
  activeEditorId?: number | null;
  onEditorGotoLine?: () => void;
  onToggleAi: () => void;
  /** Opens the panel, or Settings > Models when no API key is loaded. */
  onOpenAi: () => void;
  onOpenSettings: () => void;
  onRunCommand?: (command: string) => void;
  onOpenFile?: (path: string) => void;
  onOpenDevServer: (capture: DevServerCapture) => void;
  onOpenPreview?: (url: string) => void;
  searchTarget: SearchTarget;
  searchRef: RefObject<SearchInlineHandle | null>;
  /** True only after AI is enabled and the current configuration is verified. */
  hasComposer: boolean;
  privateActive: boolean;
};

export function StatusBar({
  cwd,
  filePath,
  home,
  onCd,
  onWorkspaceChange,
  onConnectSsh,
  onConnectDocker,
  onConnectRdp,
  onNewSsh,
  onNewRdp,
  onNewSerial,
  activeWorkspaceEnv,
  activeLeafId,
  activeEditorId = null,
  onEditorGotoLine,
  onToggleAi,
  onOpenAi,
  onOpenSettings,
  onRunCommand,
  onOpenFile,
  onOpenDevServer,
  onOpenPreview,
  searchTarget,
  searchRef,
  hasComposer,
  privateActive,
}: Props) {
  const { t } = useTranslation();
  const panelOpen = useChatStore((s) => s.panelOpen);
  const [arcadeOpen, setArcadeOpen] = useState(false);

  return (
    <footer className="flex h-7.5 shrink-0 items-center justify-between gap-2 border-t border-border/30 px-2.5 text-[10.5px]">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <ConsoleUptimeWidget cwd={cwd} />
        <WorkspaceEnvSelector
          onSelect={onWorkspaceChange}
          onConnectSsh={onConnectSsh}
          onConnectRdp={onConnectRdp}
          onNewSsh={onNewSsh}
          onNewRdp={onNewRdp}
          onNewSerial={onNewSerial}
        />
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
        <SerialControlPill
          workspaceEnv={activeWorkspaceEnv}
          activeLeafId={activeLeafId}
        />
        <DockerControlPill
          onConnectDocker={onConnectDocker}
          onOpenSettings={onOpenSettings}
        />
        <LspStatusPill filePath={filePath ?? null} />
        <DiagnosticsBadge filePath={filePath ?? null} />
        <DevServerPill
          leafId={activeLeafId}
          filePath={filePath}
          cwd={cwd}
          onOpen={onOpenDevServer}
          onOpenUrl={onOpenPreview}
        />
        {privateActive ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 cursor-default items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                <HugeiconsIcon icon={IncognitoIcon} size={10} strokeWidth={2} />
                <span>{t("statusbar.privateHidden")}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-64 text-[10.5px] leading-relaxed"
            >
              {t("statusbar.privateHiddenTooltip")}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <EditorStatus
          editorId={activeEditorId}
          onGotoLine={onEditorGotoLine ?? (() => {})}
        />
        <SearchInline ref={searchRef} target={searchTarget} />
        <ProjectToolkitPopover
          cwd={cwd}
          onRunCommand={onRunCommand}
          onOpenFile={onOpenFile}
          onOpenSettings={onOpenSettings}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onOpenSettings}
          title={t("header.settings")}
          aria-label={t("header.settings")}
        >
          <HugeiconsIcon icon={Settings01Icon} size={14} strokeWidth={1.75} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
            arcadeOpen && "bg-accent text-yellow-400 hover:text-yellow-300",
          )}
          onClick={() => setArcadeOpen((prev) => !prev)}
          title="Arcade (Pac-Man & Snake)"
          aria-label="Arcade"
        >
          <PacmanIcon size={14} className={arcadeOpen ? "text-yellow-400" : undefined} />
        </Button>
        <span className="mx-0.5 h-3.5 w-px shrink-0 rounded-full bg-border" />
        {hasComposer ? (
          <>
            <AgentStatusPill onClick={onToggleAi} />
            <AiOpenButton onOpen={onOpenAi} open={panelOpen} />
          </>
        ) : null}
      </div>
      {arcadeOpen ? (
        <FloatingArcadeWidget onClose={() => setArcadeOpen(false)} />
      ) : null}
    </footer>
  );
}
