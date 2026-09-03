import { Button } from "@/components/ui/button";
import { WindowControls } from "@/components/WindowControls";
import { cn } from "@/lib/utils";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS, fmtShortcut, MOD_KEY, SHIFT_KEY } from "@/lib/platform";
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
  Cancel01Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SidebarRightIcon,
  SparklesIcon,
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
  onNewHarness?: () => void;
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
  onReconnectTab?: (tab: Tab) => void;
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
  onNewHarness,
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
  onReconnectTab,
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

  const activeSpaceId =
    activeStripItem?.kind === "space" ? activeStripItem.spaceId : null;
  const activeTabSpaceId = tabs.find((t) => t.id === activeId)?.spaceId ?? null;
  const currentSpaceId = activeSpaceId ?? activeTabSpaceId;
  const harnessTab =
    tabs.find(
      (t) =>
        t.kind === "harness" &&
        (!currentSpaceId || t.spaceId === currentSpaceId),
    ) ?? tabs.find((t) => t.kind === "harness");
  const isHarnessOpen = Boolean(harnessTab);
  const isHarnessActive = isHarnessOpen && harnessTab?.id === activeId;

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

        {tabStyle === "vertical" && onNewHarness && (
          <Button
            onClick={onNewHarness}
            variant="ghost"
            size="icon-sm"
            title={`${t("harness.agentDevelopment", { defaultValue: "Agent Development" })} (${fmtShortcut(MOD_KEY, SHIFT_KEY, "D")})`}
            aria-label={t("harness.agentDevelopment", { defaultValue: "Agent Development" })}
            className={cn(
              "shrink-0 rounded-md transition-colors",
              isHarnessActive
                ? "bg-foreground/[0.07] text-violet-400 shadow-xs hover:bg-foreground/[0.1] hover:text-violet-300"
                : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
            )}
          >
            <HugeiconsIcon
              icon={SparklesIcon}
              size={15}
              strokeWidth={1.75}
              className={cn(
                "transition-colors",
                isHarnessActive
                  ? "text-violet-400"
                  : "text-muted-foreground hover:text-foreground",
              )}
            />
          </Button>
        )}
      </div>

      <div
        className="flex min-w-0 flex-1 items-center gap-1.5"
        data-tauri-drag-region
      >
        {tabStyle === "horizontal" && (
          <>
            {spaceSwitcher}
            {onNewHarness && (
              isHarnessOpen && harnessTab ? (
                <div
                  role="tab"
                  aria-selected={isHarnessActive}
                  tabIndex={0}
                  onClick={() => onSelect(harnessTab.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(harnessTab.id);
                    }
                  }}
                  title={`${t("harness.agentDevelopment", { defaultValue: "Agent Development" })} (${fmtShortcut(MOD_KEY, SHIFT_KEY, "D")})`}
                  className={cn(
                    "group relative flex h-6.5 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium cursor-pointer select-none transition-all duration-150 outline-none",
                    isHarnessActive
                      ? "bg-foreground/[0.08] text-foreground shadow-xs ring-1 ring-inset ring-foreground/[0.06]"
                      : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                  )}
                >
                  <HugeiconsIcon
                    icon={SparklesIcon}
                    size={14}
                    strokeWidth={2}
                    className={cn(
                      "shrink-0 transition-colors",
                      isHarnessActive
                        ? "text-violet-400"
                        : "text-violet-400/80 group-hover:text-violet-400",
                    )}
                  />
                  <span className="truncate max-w-[140px]">{t("harness.agentDevelopment", { defaultValue: "Agent Development" })}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(harnessTab.id);
                    }}
                    title={t("tabs.closeTab") || "Close tab"}
                    aria-label={t("harness.closeAgentDevelopment", { defaultValue: "Close Agent Development" })}
                    className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 hover:bg-foreground/10 hover:text-foreground transition-colors"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
                  </button>
                </div>
              ) : (
                <Button
                  onClick={onNewHarness}
                  variant="ghost"
                  size="icon-sm"
                  title={`${t("harness.agentDevelopment", { defaultValue: "Agent Development" })} (${fmtShortcut(MOD_KEY, SHIFT_KEY, "D")})`}
                  aria-label={t("harness.agentDevelopment", { defaultValue: "Agent Development" })}
                  className="h-6.5 w-6.5 shrink-0 rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground transition-all duration-150"
                >
                  <HugeiconsIcon
                    icon={SparklesIcon}
                    size={14}
                    strokeWidth={1.85}
                    className="text-violet-400 group-hover:scale-105 transition-transform"
                  />
                </Button>
              )
            )}
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
              onNewHarness={onNewHarness}
              onNewRdp={onNewRdp}
              onConnectRemote={onConnectRemote}
              onShareTerminal={onShareTerminal}
              onReconnectTab={onReconnectTab}
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

      <div className="flex shrink-0 items-center gap-1">
        <NotificationBell
          onActivate={onActivateAgent}
          onActivateLocal={onActivateLocalAgent}
          onOpenDiff={onOpenDiff}
        />

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
      </div>

      {USE_CUSTOM_WINDOW_CONTROLS && (
        <>
          <span className="ml-1 h-5 w-px shrink-0 bg-border/60" />
          <WindowControls />
        </>
      )}
    </header>
  );
}
