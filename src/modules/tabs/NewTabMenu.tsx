import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { fmtShortcut, MOD_KEY, SHIFT_KEY } from "@/lib/platform";
import { AgentLauncherPanel } from "@/modules/agents/components/AgentLauncherPanel";
import type { AgentLaunchRequest } from "@/modules/agents/lib/launcher";
import { useAgentHistoryStore } from "@/modules/agent-history";
import { useAiAvailable } from "@/modules/ai/lib/runtimeAvailability";
import { useTranslation } from "@/modules/i18n";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  AiBrowserIcon,
  type ArrowRight01Icon,
  Clock01Icon,
  ComputerScreenShareIcon,
  ComputerTerminal02Icon,
  File02Icon,
  FolderOpenIcon,
  GitBranchIcon,
  GlobalIcon,
  IncognitoIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { type ReactNode, useEffect, useRef, useState } from "react";

export type ShellInfo = {
  name: string;
  path: string;
  integrated: boolean;
};

export type WslDistro = {
  name: string;
};

export type NewTabMenuProps = {
  onNew: () => void;
  onNewShell?: (shellPath: string, name: string) => void;
  onNewWsl?: (distro: string) => void;
  onNewBlock: () => void;
  onNewPrivate: () => void;
  onNewPreview?: () => void;
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
  onNewGitGraph: () => void;
  onLaunchAgents: (request: AgentLaunchRequest) => void;
};

type NewTabMenuItemsProps = NewTabMenuProps & {
  onOpenLauncher: () => void;
};

function ShellGlyph({ name, isWsl }: { name: string; isWsl?: boolean }) {
  if (isWsl) {
    return (
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="currentColor"
        className="shrink-0 opacity-80"
      >
        <circle
          cx="8"
          cy="8"
          r="6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <circle cx="8" cy="4" r="1.1" />
        <circle cx="4.5" cy="10" r="1.1" />
        <circle cx="11.5" cy="10" r="1.1" />
        <path
          d="M6 8a2 2 0 004 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
    );
  }

  const lower = name.toLowerCase();
  if (lower.includes("powershell") || lower.includes("pwsh")) {
    return (
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 opacity-80"
      >
        <path d="M3.5 4.5l4.5 3.5-4.5 3.5M8 12.5h4.5" />
      </svg>
    );
  }

  if (lower.includes("git") || lower.includes("bash")) {
    return (
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="currentColor"
        className="shrink-0 opacity-80"
      >
        <path d="M15.5 7.5L8.5.5a1.4 1.4 0 00-2 0L5.3 1.7l2.5 2.5a1.7 1.7 0 012.2 2.2l2.4 2.4a1.7 1.7 0 11-1 1l-2.3-2.3v3.7a1.7 1.7 0 11-1.4 0V7.3a1.7 1.7 0 01-.9-2.2L4.3 2.6.5 6.4a1.4 1.4 0 000 2l7 7a1.4 1.4 0 002 0l6-6a1.4 1.4 0 000-2z" />
      </svg>
    );
  }

  if (lower.includes("cmd") || lower.includes("command prompt")) {
    return (
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 opacity-80"
      >
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <path d="M4.5 6.5l2 1.5-2 1.5M8.5 9.5h3" />
      </svg>
    );
  }

  return (
    <HugeiconsIcon
      icon={ComputerTerminal02Icon}
      size={14}
      strokeWidth={1.75}
      className="shrink-0 opacity-80"
    />
  );
}

export function NewTabMenu({
  onNew,
  onNewShell,
  onNewWsl,
  onNewBlock,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewApiClient,
  onNewHarness,
  onNewRdp,
  onConnectRemote,
  onOpenFile,
  onOpenFolder,
  onNewGitGraph,
  onLaunchAgents,
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
                className="pointer-events-none flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground opacity-0 transition-opacity hover:border-border/30 hover:bg-foreground/[0.05] hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 cursor-pointer"
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
              <NewTabMenuItems
                onOpenLauncher={openLauncher}
                onNew={onNew}
                onNewShell={onNewShell}
                onNewWsl={onNewWsl}
                onNewBlock={onNewBlock}
                onNewPrivate={onNewPrivate}
                onNewPreview={onNewPreview}
                onNewEditor={onNewEditor}
                onNewApiClient={onNewApiClient}
                onNewHarness={onNewHarness}
                onNewRdp={onNewRdp}
                onConnectRemote={onConnectRemote}
                onOpenFile={onOpenFile}
                onOpenFolder={onOpenFolder}
                onNewGitGraph={onNewGitGraph}
                onLaunchAgents={onLaunchAgents}
              />
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

export function NewTabMenuItems({
  onOpenLauncher,
  onNew,
  onNewShell,
  onNewWsl,
  onNewBlock,
  onNewPrivate,
  onNewEditor,
  onNewApiClient,
  onNewHarness: _onNewHarness,
  onConnectRemote,
  onOpenFile,
  onOpenFolder,
  onNewGitGraph,
}: NewTabMenuItemsProps) {
  const { t } = useTranslation();
  const aiAvailable = useAiAvailable();
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [wslDistros, setWslDistros] = useState<WslDistro[]>([]);

  useEffect(() => {
    let alive = true;
    void invoke<ShellInfo[]>("pty_list_shells")
      .then((res) => {
        if (alive && Array.isArray(res)) setShells(res);
      })
      .catch(() => {});

    void invoke<WslDistro[]>("wsl_list_distros")
      .then((res) => {
        if (alive && Array.isArray(res)) setWslDistros(res);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  const hasExtraShells =
    shells.length > 0 || wslDistros.length > 0 || onConnectRemote;

  return (
    <div className="flex flex-col gap-0.5">
      {/* 1. Terminal Principal */}
      <NewTabMenuItem
        onSelect={onNew}
        customIcon={
          <HugeiconsIcon
            icon={ComputerTerminal02Icon}
            size={14}
            strokeWidth={1.75}
            className="shrink-0 opacity-90"
          />
        }
        label={t("statusbar.terminal")}
        shortcut={fmtShortcut(MOD_KEY, "T")}
      />

      {/* 2. Agentes con Desplegable */}
      {aiAvailable ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex h-7.5 min-h-[28px] cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-normal text-foreground/90 transition-colors hover:bg-accent/80 hover:text-foreground focus:bg-accent/80 focus:text-foreground data-open:bg-accent data-open:text-accent-foreground">
            <HugeiconsIcon
              icon={AiBrowserIcon}
              size={14}
              strokeWidth={1.75}
              className="shrink-0 text-violet-400"
            />
            <span className="flex-1 truncate">
              {t("settings.agents.title")}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48 rounded-xl border border-border/50 bg-popover/95 p-1 text-xs shadow-xl backdrop-blur-md">
            <DropdownMenuItem
              onSelect={onOpenLauncher}
              className="flex h-7.5 min-h-[28px] cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-normal text-foreground/90 transition-colors hover:bg-accent/80 hover:text-foreground"
            >
              <HugeiconsIcon
                icon={SparklesIcon}
                size={14}
                className="shrink-0 text-amber-400"
              />
              <span className="flex-1">{t("tabs.agentLauncher")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                useChatStore.getState().openPanel();
              }}
              className="flex h-7.5 min-h-[28px] cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-normal text-foreground/90 transition-colors hover:bg-accent/80 hover:text-foreground"
            >
              <HugeiconsIcon
                icon={AiBrowserIcon}
                size={14}
                className="shrink-0 text-violet-400"
              />
              <span className="flex-1">{t("tabs.openAgentChat")}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
                Ctrl+I
              </span>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}

      {/* 3. Otras Terminales con Desplegable */}
      {hasExtraShells && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex h-7.5 min-h-[28px] cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-normal text-foreground/90 transition-colors hover:bg-accent/80 hover:text-foreground focus:bg-accent/80 focus:text-foreground data-open:bg-accent data-open:text-accent-foreground">
            <HugeiconsIcon
              icon={ComputerTerminal02Icon}
              size={14}
              strokeWidth={1.75}
              className="shrink-0 opacity-70"
            />
            <span className="flex-1 truncate">{t("tabs.moreTerminals")}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-52 max-h-72 overflow-y-auto rounded-xl border border-border/50 bg-popover/95 p-1 text-xs shadow-xl backdrop-blur-md">
            {/* Detected System Shells */}
            {shells.map((sh) => (
              <NewTabMenuItem
                key={sh.path}
                onSelect={() => onNewShell?.(sh.path, sh.name)}
                customIcon={<ShellGlyph name={sh.name} />}
                label={sh.name}
              />
            ))}

            {/* Detected WSL Distros */}
            {wslDistros.map((distro) => (
              <NewTabMenuItem
                key={distro.name}
                onSelect={() => onNewWsl?.(distro.name)}
                customIcon={<ShellGlyph name={distro.name} isWsl />}
                label={distro.name}
              />
            ))}

            <DropdownMenuSeparator className="-mx-1 my-1 bg-border/40" />

            <NewTabMenuItem
              onSelect={onNewBlock}
              customIcon={
                <HugeiconsIcon
                  icon={ComputerTerminal02Icon}
                  size={14}
                  strokeWidth={1.75}
                  className="shrink-0 opacity-80"
                />
              }
              label={t("commandPalette.commands.newBlockTerminal")}
              shortcut={fmtShortcut(MOD_KEY, SHIFT_KEY, "T")}
            />
            <NewTabMenuItem
              onSelect={onNewPrivate}
              customIcon={
                <HugeiconsIcon
                  icon={IncognitoIcon}
                  size={14}
                  strokeWidth={1.75}
                  className="shrink-0 opacity-80"
                />
              }
              label={t("commandPalette.commands.newPrivateTerminal")}
              shortcut={fmtShortcut(MOD_KEY, "R")}
            />
            {onConnectRemote ? (
              <NewTabMenuItem
                onSelect={onConnectRemote}
                customIcon={
                  <HugeiconsIcon
                    icon={ComputerScreenShareIcon}
                    size={14}
                    strokeWidth={1.75}
                    className="shrink-0 text-sky-400"
                  />
                }
                label={t("collab.guest.menuAction")}
              />
            ) : null}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}

      <DropdownMenuSeparator className="-mx-1 my-1 bg-border/40" />

      {/* 4. Editor */}
      <NewTabMenuItem
        onSelect={onNewEditor}
        customIcon={
          <HugeiconsIcon
            icon={PencilEdit02Icon}
            size={14}
            strokeWidth={1.75}
            className="shrink-0 opacity-80"
          />
        }
        label={t("statusbar.editor")}
        shortcut={fmtShortcut(MOD_KEY, "E")}
      />

      {/* 5. Gráfico de Commits */}
      <NewTabMenuItem
        onSelect={onNewGitGraph}
        customIcon={
          <HugeiconsIcon
            icon={GitBranchIcon}
            size={14}
            strokeWidth={1.75}
            className="shrink-0 opacity-80"
          />
        }
        label={t("git.commitGraph")}
      />

      {/* 7. API Client & Sandbox */}
      {onNewApiClient && (
        <NewTabMenuItem
          onSelect={onNewApiClient}
          customIcon={
            <HugeiconsIcon
              icon={GlobalIcon}
              size={14}
              strokeWidth={1.75}
              className="shrink-0 text-emerald-400"
            />
          }
          label={t("commandPalette.commands.newApiClient")}
          shortcut={fmtShortcut(MOD_KEY, SHIFT_KEY, "A")}
        />
      )}

      {/* 8. Agent Operational History */}
      <NewTabMenuItem
        onSelect={() => useAgentHistoryStore.getState().openHistory()}
        customIcon={
          <HugeiconsIcon
            icon={Clock01Icon}
            size={14}
            strokeWidth={1.75}
            className="shrink-0 text-purple-400"
          />
        }
        label={t("agentHistory.modalTitle")}
        shortcut={fmtShortcut(MOD_KEY, SHIFT_KEY, "H")}
      />

      {/* 7. Acceso a Archivos */}
      {(onOpenFile || onOpenFolder) && (
        <>
          <DropdownMenuSeparator className="-mx-1 my-1 bg-border/40" />
          {onOpenFile && (
            <NewTabMenuItem
              onSelect={onOpenFile}
              customIcon={
                <HugeiconsIcon
                  icon={File02Icon}
                  size={14}
                  strokeWidth={1.75}
                  className="shrink-0 opacity-80"
                />
              }
              label={t("workspace.empty.openFile")}
              shortcut={fmtShortcut(MOD_KEY, "O")}
            />
          )}
          {onOpenFolder && (
            <NewTabMenuItem
              onSelect={onOpenFolder}
              customIcon={
                <HugeiconsIcon
                  icon={FolderOpenIcon}
                  size={14}
                  strokeWidth={1.75}
                  className="shrink-0 opacity-80"
                />
              }
              label={t("workspace.empty.openFolder")}
              shortcut={fmtShortcut(MOD_KEY, SHIFT_KEY, "O")}
            />
          )}
        </>
      )}
    </div>
  );
}

type NewTabMenuItemProps = {
  onSelect: () => void;
  onMouseEnter?: () => void;
  customIcon?: ReactNode;
  label: string;
  shortcut?: string;
  trailingIcon?: typeof ArrowRight01Icon;
};

function NewTabMenuItem({
  onSelect,
  onMouseEnter,
  customIcon,
  label,
  shortcut,
  trailingIcon,
}: NewTabMenuItemProps) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      onMouseEnter={onMouseEnter}
      className="flex h-7.5 min-h-[28px] cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-normal text-foreground/90 transition-colors hover:bg-accent/80 hover:text-foreground focus:bg-accent/80 focus:text-foreground"
    >
      {customIcon}
      <span className="flex-1 truncate">{label}</span>
      {shortcut ? (
        <span className="ml-auto shrink-0 font-mono text-[10px] tracking-tight text-muted-foreground/70">
          {shortcut}
        </span>
      ) : null}
      {trailingIcon ? (
        <HugeiconsIcon
          icon={trailingIcon}
          size={12}
          strokeWidth={2}
          className="ml-auto shrink-0 text-muted-foreground/70"
        />
      ) : null}
    </DropdownMenuItem>
  );
}
