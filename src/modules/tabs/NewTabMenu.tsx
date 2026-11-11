import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { AgentLauncherPanel } from "@/modules/agents/components/AgentLauncherPanel";
import type { AgentLaunchRequest } from "@/modules/agents/lib/launcher";
import { useTranslation } from "@/modules/i18n";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { lazy, Suspense, useRef, useState } from "react";

const NewTabMenuItems = lazy(() =>
  import("@/modules/tabs/NewTabMenuItems").then((m) => ({
    default: m.NewTabMenuItems,
  })),
);

export type NewTabMenuProps = {
  onNew: () => void;
  onNewShell?: (shellPath: string, name: string) => void;
  onNewWsl?: (distro: string) => void;
  onNewBlock: () => void;
  onNewPrivate: () => void;
  onNewPreview?: () => void;
  previewDisabledReason?: string;
  onNewBrowser?: () => void;
  onNewEditor: () => void;
  onNewApiClient?: () => void;
  onNewHarness?: () => void;
  onNewRdp?: (options?: {
    host?: string;
    port?: number;
    username?: string;
    domain?: string;
    autoConnect?: boolean;
  }) => void;
  onConnectRemote?: () => void;
  onOpenFile?: () => void;
  onOpenFolder?: () => void;
  onNewGitGraph?: () => void;
  onLaunchAgents: (request: AgentLaunchRequest) => void;
  onOpenTeamBoard?: () => void;
};

export function NewTabMenu({
  onNew,
  onNewShell,
  onNewWsl,
  onNewBlock,
  onNewPrivate,
  onNewPreview,
  previewDisabledReason,
  onNewBrowser,
  onNewEditor,
  onNewApiClient,
  onNewHarness,
  onNewRdp,
  onConnectRemote,
  onOpenFile,
  onOpenFolder,
  onNewGitGraph,
  onLaunchAgents,
  onOpenTeamBoard,
}: NewTabMenuProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const openLauncherAfterMenuClose = useRef(false);
  const openMenuAfterLauncherClose = useRef(false);

  const onMenuOpenChange = (next: boolean) => {
    if (next) {
      openLauncherAfterMenuClose.current = false;
      setLauncherOpen(false);
    }
    setMenuOpen(next);
  };

  const openLauncher = () => {
    openLauncherAfterMenuClose.current = true;
    setMenuOpen(false);
  };

  const backToMenu = () => {
    openMenuAfterLauncherClose.current = true;
    setLauncherOpen(false);
  };

  return (
    <Popover open={launcherOpen} onOpenChange={setLauncherOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-6.5 w-6.5 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border/30 hover:bg-foreground/[0.05] hover:text-foreground"
                aria-label={t("tabs.newTab")}
                title={t("tabs.newTab")}
              >
                <HugeiconsIcon icon={PlusSignIcon} size={13} strokeWidth={2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-56 gap-0 rounded-xl border border-border/50 bg-popover/95 p-1 text-xs shadow-xl backdrop-blur-md"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (!openLauncherAfterMenuClose.current) return;

                openLauncherAfterMenuClose.current = false;
                requestAnimationFrame(() => setLauncherOpen(true));
              }}
            >
              <Suspense fallback={null}>
                <NewTabMenuItems
                  onOpenLauncher={openLauncher}
                  onNew={onNew}
                  onNewShell={onNewShell}
                  onNewWsl={onNewWsl}
                  onNewBlock={onNewBlock}
                  onNewPrivate={onNewPrivate}
                  onNewPreview={onNewPreview}
                  previewDisabledReason={previewDisabledReason}
                  onNewBrowser={onNewBrowser}
                  onNewEditor={onNewEditor}
                  onNewApiClient={onNewApiClient}
                  onNewHarness={onNewHarness}
                  onNewRdp={onNewRdp}
                  onConnectRemote={onConnectRemote}
                  onOpenFile={onOpenFile}
                  onOpenFolder={onOpenFolder}
                  onNewGitGraph={onNewGitGraph}
                  onLaunchAgents={onLaunchAgents}
                  onOpenTeamBoard={onOpenTeamBoard}
                />
              </Suspense>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!openMenuAfterLauncherClose.current) return;

          openMenuAfterLauncherClose.current = false;
          requestAnimationFrame(() => setMenuOpen(true));
        }}
        className="w-[340px] gap-0 overflow-hidden rounded-2xl p-1.5"
      >
        <AgentLauncherPanel
          onBack={backToMenu}
          onLaunch={(request) => {
            setLauncherOpen(false);
            onLaunchAgents(request);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
