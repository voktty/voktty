import { Button } from "@/components/ui/button";
import { WindowControls } from "@/components/WindowControls";
import { cn } from "@/lib/utils";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { NotificationBell } from "@/modules/agents";
import type { AgentLaunchRequest } from "@/modules/agents/lib/launcher";
import { useTranslation } from "@/modules/i18n";
import { useShortcutLabel } from "@/modules/shortcuts";
import type { ViewSpace } from "@/modules/spaces/lib/spaceLayout";
import type {
  ActiveStripItem,
  StripEntry,
} from "@/modules/spaces/lib/spaceProjection";
import type {
  WorkspaceDragSource,
  WorkspaceDropTarget,
} from "@/modules/spaces/lib/workspaceDrag";
import type { GitDiffOpenInput, Tab } from "@/modules/tabs";
import { TabBar } from "@/modules/tabs";
import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type ReactNode, useEffect, useRef, useState } from "react";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewShell?: (shellPath: string, name: string) => void;
  onNewWsl?: (distro: string) => void;
  onNewBlock: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewApiClient?: () => void;
  onNewRdp?: (options?: {
    host?: string;
    port?: number;
    username?: string;
    domain?: string;
    autoConnect?: boolean;
  }) => void;
  onConnectRemote?: () => void;
  onShareTerminal?: (id: number) => void;
  onOpenFile?: () => void;
  onOpenFolder?: () => void;
  onNewGitGraph: () => void;
  onLaunchAgents: (request: AgentLaunchRequest) => void;
  onClose: (id: number) => void;
  /** Chrome-style: close every tab to the right of the given tab. */
  onCloseTabsToRight: (id: number) => void;
  /** Chrome-style: close every tab except the given tab. */
  onCloseOtherTabs: (id: number) => void;
  /** Duplicate a terminal tab, preserving its environment and cwd. */
  onDuplicate: (id: number) => void;
  /** Set a terminal tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  /** Move a dragged tab to a new position (insertion gap index). */
  onReorder: (fromId: number, toGapIndex: number) => void;
  onOverrideLanguage?: (id: number, lang: string | null) => void;
  onSetColor?: (id: number, color: string | null) => void;
  onPin?: (id: number) => void;
  onToggleLock?: (id: number) => void;
  onToggleBlocks?: (id: number) => void;
  stripEntries?: readonly StripEntry[];
  viewSpaces?: readonly ViewSpace[];
  activeStripItem?: ActiveStripItem | null;
  onSelectSpace?: (spaceId: string) => void;
  onExpandSpace?: (spaceId: string) => void;
  onRenameSpace?: (spaceId: string, name: string) => void;
  onSetSpaceColor?: (spaceId: string, color: number | undefined) => void;
  onReorderVisual?: (
    fromId: number,
    toGapIndex: number,
    visibleIds: number[],
  ) => void;
  onWorkspaceDrop?: (
    source: WorkspaceDragSource,
    target: WorkspaceDropTarget,
  ) => void;
  onRevealInExplorer?: (path: string) => void;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  onToggleTabStyle: () => void;
  tabStyle: "horizontal" | "vertical";
  hideTabStyleToggle?: boolean;
  onOpenCommandPalette: () => void;
  onActivateAgent: (tabId: number, leafId: number) => void;
  onActivateLocalAgent: () => void;
  onOpenDiff?: (input: GitDiffOpenInput, pin?: boolean) => void;
  spaceSwitcher: ReactNode;
};

const COMPACT_WIDTH = 720;

export function Header({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewShell,
  onNewWsl,
  onNewBlock,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewApiClient,
  onNewRdp,
  onConnectRemote,
  onOpenFile,
  onOpenFolder,
  onNewGitGraph,
  onLaunchAgents,
  onClose,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onDuplicate,
  onRename,
  onReorder,
  onOverrideLanguage,
  onSetColor,
  onPin,
  onToggleLock,
  onToggleBlocks,
  onShareTerminal,
  stripEntries,
  viewSpaces,
  activeStripItem,
  onSelectSpace,
  onExpandSpace,
  onRenameSpace,
  onSetSpaceColor,
  onReorderVisual,
  onWorkspaceDrop,
  onRevealInExplorer,
  onToggleSidebar,
  sidebarCollapsed,
  onToggleTabStyle,
  tabStyle,
  hideTabStyleToggle = false,
  onOpenCommandPalette,
  onActivateAgent,
  onActivateLocalAgent,
  onOpenDiff,
  spaceSwitcher,
}: Props) {
  const { t } = useTranslation();
  const commandPaletteShortcut = useShortcutLabel("commandPalette.open");
  const commandPaletteLabel = commandPaletteShortcut
    ? `${t("header.commandPalette")} (${commandPaletteShortcut})`
    : t("header.commandPalette");
  const sidebarToggleLabel = sidebarCollapsed
    ? t("header.expandSidebar")
    : t("header.collapseSidebar");
  const rootRef = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCompact(entry.contentRect.width < COMPACT_WIDTH);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggedIconRef = useRef(false);

  const handleIconPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    draggedIconRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleIconPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragStartRef.current || e.buttons !== 1) return;
    const dist = Math.hypot(
      e.clientX - dragStartRef.current.x,
      e.clientY - dragStartRef.current.y,
    );
    if (dist > 4) {
      draggedIconRef.current = true;
      dragStartRef.current = null;
      try {
        void getCurrentWindow().startDragging();
      } catch {}
    }
  };

  const handleIconPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button === 0) dragStartRef.current = null;
  };

  return (
    <header
      ref={rootRef}
      className={cn(
        "flex h-9 shrink-0 items-center justify-between border-b border-border/60 bg-frame px-2 select-none",
        IS_MAC && "pl-[76px]",
      )}
      data-tauri-drag-region
    >
      <div className="flex shrink-0 items-center gap-1">
        <Button
          onPointerDown={handleIconPointerDown}
          onPointerMove={handleIconPointerMove}
          onPointerUp={handleIconPointerUp}
          onPointerCancel={() => {
            dragStartRef.current = null;
            draggedIconRef.current = false;
          }}
          onClick={(e) => {
            e.preventDefault();
            if (draggedIconRef.current) {
              draggedIconRef.current = false;
              return;
            }
            onOpenCommandPalette();
          }}
          title={commandPaletteLabel}
          aria-label={commandPaletteLabel}
          variant="ghost"
          size="icon-sm"
          className="group relative shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
        >
          <img
            src="/voktty-icon.png"
            alt="Voktty"
            className="size-4.5 rounded transition-transform group-hover:scale-105 pointer-events-none"
            draggable={false}
          />
        </Button>

        <Button
          onClick={onToggleSidebar}
          variant="ghost"
          size="icon-sm"
          title={sidebarToggleLabel}
          aria-label={sidebarToggleLabel}
          aria-expanded={!sidebarCollapsed}
          className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon
            icon={sidebarCollapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon}
            size={15}
            strokeWidth={1.75}
          />
        </Button>

        {!IS_MAC && (
          <NotificationBell
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
            onOpenDiff={onOpenDiff}
          />
        )}
      </div>

      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        data-tauri-drag-region
      >
        {tabStyle === "horizontal" && (
          <>
            {spaceSwitcher}
            <TabBar
              tabs={tabs}
              activeId={activeId}
              onSelect={onSelect}
              onClose={onClose}
              onCloseTabsToRight={onCloseTabsToRight}
              onCloseOtherTabs={onCloseOtherTabs}
              onDuplicate={onDuplicate}
              onRename={onRename}
              onReorder={onReorder}
              onOverrideLanguage={onOverrideLanguage}
              onSetColor={onSetColor}
              onPin={onPin}
              onToggleLock={onToggleLock}
              onToggleBlocks={onToggleBlocks}
              stripEntries={stripEntries}
              viewSpaces={viewSpaces}
              activeStripItem={activeStripItem}
              onSelectSpace={onSelectSpace}
              onExpandSpace={onExpandSpace}
              onRenameSpace={onRenameSpace}
              onSetSpaceColor={onSetSpaceColor}
              onReorderVisual={onReorderVisual}
              onWorkspaceDrop={onWorkspaceDrop}
              onNew={onNew}
              onNewShell={onNewShell}
              onNewWsl={onNewWsl}
              onNewBlock={onNewBlock}
              onNewPrivate={onNewPrivate}
              onNewPreview={onNewPreview}
              onNewEditor={onNewEditor}
              onNewApiClient={onNewApiClient}
              onNewRdp={onNewRdp}
              onConnectRemote={onConnectRemote}
              onShareTerminal={onShareTerminal}
              onOpenFile={onOpenFile}
              onOpenFolder={onOpenFolder}
              onNewGitGraph={onNewGitGraph}
              onLaunchAgents={onLaunchAgents}
              onRevealInExplorer={onRevealInExplorer}
              compact={compact}
            />
          </>
        )}
        <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      </div>

      {!hideTabStyleToggle && (
        <Button
          onClick={onToggleTabStyle}
          title={
            tabStyle === "horizontal"
              ? t("header.switchToVerticalTabs")
              : t("header.switchToHorizontalTabs")
          }
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={SidebarRightIcon} size={16} strokeWidth={1.75} />
        </Button>
      )}

      {IS_MAC && (
        <NotificationBell
          onActivate={onActivateAgent}
          onActivateLocal={onActivateLocalAgent}
          onOpenDiff={onOpenDiff}
        />
      )}

      {USE_CUSTOM_WINDOW_CONTROLS && (
        <>
          <span className="ml-1 h-5 w-px shrink-0 bg-border/60" />
          <WindowControls />
        </>
      )}
    </header>
  );
}
