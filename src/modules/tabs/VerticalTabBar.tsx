import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AgentLaunchRequest } from "@/modules/agents/lib/launcher";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { useTranslation } from "@/modules/i18n";
import { CompositeSpaceChip } from "@/modules/spaces/CompositeSpaceChip";
import type { ViewSpace } from "@/modules/spaces/lib/spaceLayout";
import {
  type ActiveStripItem,
  isProjectedStripItemActive,
  type ProjectedStripItem,
  projectStripEntries,
  type StripEntry,
} from "@/modules/spaces/lib/spaceProjection";
import { useWorkspaceDrag } from "@/modules/spaces/lib/useWorkspaceDrag";
import {
  beginWorkspaceDrag,
  canExtractWorkspaceDrag,
  cancelWorkspaceDrag,
  finishWorkspaceDrag,
  getWorkspaceDragState,
  type WorkspaceDragSource,
  type WorkspaceDropTarget,
  workspaceDragSourceForTab,
} from "@/modules/spaces/lib/workspaceDrag";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import {
  Cancel01Icon,
  Clock01Icon,
  ComputerScreenShareIcon,
  Copy01Icon,
  Folder01Icon,
  GitBranchIcon,
  GitCompareIcon,
  Globe02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
  SparklesIcon,
  SquareLock01Icon,
  SquareUnlock01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TabDetailsHoverCard } from "./components/TabDetailsHoverCard";
import { useTabContextMenuStore } from "./lib/tabContextMenuState";
import { getTabSubtitle, labelFor } from "./lib/tabLabel";
import type { Tab } from "./lib/useTabs";
import { NewTabMenu } from "./NewTabMenu";
import { TabIcon, TabProcessBadge, TabProcessBottomBar } from "./TabBar";
import { TabColorBubbles } from "./TabColorBubbles";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onDuplicate: (id: number) => void;
  onPin: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onReorder: (fromId: number, toGapIndex: number) => void;
  onCloseOtherTabs?: (id: number) => void;
  onCloseTabsToRight?: (id: number) => void;
  onSetColor?: (id: number, color: string | null) => void;
  onToggleLock?: (id: number) => void;
  onToggleBlocks?: (id: number) => void;
  onNew?: () => void;
  onNewShell?: (shellPath: string, name: string) => void;
  onNewWsl?: (distro: string) => void;
  onNewBlock?: () => void;
  onNewPrivate?: () => void;
  onNewPreview?: () => void;
  onNewEditor?: () => void;
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
  onNewGitGraph?: () => void;
  onLaunchAgents?: (request: AgentLaunchRequest) => void;
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
};

function tabCategory(t: Tab): "terminals" | "files" | "tools" {
  if (t.kind === "terminal") return "terminals";
  if (t.kind === "editor" || t.kind === "markdown") return "files";
  return "tools";
}

function TabBadgeIcon({ tab }: { tab: Tab }) {
  if (tab.kind === "terminal") {
    if (tab.collaboration) {
      return (
        <HugeiconsIcon
          icon={ComputerScreenShareIcon}
          size={14}
          strokeWidth={1.75}
          className="text-sky-400"
        />
      );
    }
    return <TabIcon tab={tab} animatedAgent />;
  }
  if (tab.kind === "editor" || tab.kind === "markdown") {
    return <TabIcon tab={tab} />;
  }
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") {
    return (
      <HugeiconsIcon
        icon={GitCompareIcon}
        size={14}
        strokeWidth={1.75}
        className="text-violet-400"
      />
    );
  }
  if (tab.kind === "git-history") {
    return (
      <HugeiconsIcon
        icon={Clock01Icon}
        size={14}
        strokeWidth={1.75}
        className="text-cyan-400"
      />
    );
  }
  if (tab.kind === "preview") {
    return (
      <HugeiconsIcon
        icon={Globe02Icon}
        size={14}
        strokeWidth={1.75}
        className="text-sky-400"
      />
    );
  }
  if (tab.kind === "ai-diff") {
    return (
      <HugeiconsIcon
        icon={SparklesIcon}
        size={14}
        strokeWidth={1.75}
        className="text-amber-400"
      />
    );
  }
  return <TabIcon tab={tab} />;
}

export function VerticalTabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onDuplicate,
  onPin,
  onRename,
  onReorder,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onSetColor,
  onToggleLock,
  onToggleBlocks,
  onNew,
  onNewShell,
  onNewWsl,
  onNewBlock,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewRdp,
  onConnectRemote,
  onOpenFile,
  onOpenFolder,
  onNewGitGraph,
  onLaunchAgents,
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
}: Props) {
  const { t } = useTranslation();
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const workspaceDrag = useWorkspaceDrag();
  const pulsingTabs = useAgentStore((s) => s.pulsingTabs);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    startY: number;
    fromId: number;
    active: boolean;
  } | null>(null);

  const projectionEnabled =
    stripEntries !== undefined && viewSpaces !== undefined;
  const projectedItems = useMemo<ProjectedStripItem[]>(
    () =>
      projectionEnabled
        ? projectStripEntries({ tabs, viewSpaces, stripEntries })
        : tabs.map((tab) => ({
            kind: "tab" as const,
            tab,
            tabKey: tab.tabKey,
            spaceId: null,
          })),
    [projectionEnabled, stripEntries, tabs, viewSpaces],
  );

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projectedItems;
    return projectedItems.filter((item) => {
      if (item.kind === "space") {
        return item.space.name.toLowerCase().includes(q);
      }
      const tab = item.tab;
      const title = (tab.title || "").toLowerCase();
      const label = labelFor(tab).toLowerCase();
      const sub = getTabSubtitle(tab).text.toLowerCase();
      const path = (
        "path" in tab && typeof tab.path === "string" ? tab.path : ""
      ).toLowerCase();
      const cwd = (
        "cwd" in tab && typeof tab.cwd === "string" ? tab.cwd : ""
      ).toLowerCase();
      return (
        title.includes(q) ||
        label.includes(q) ||
        sub.includes(q) ||
        path.includes(q) ||
        cwd.includes(q)
      );
    });
  }, [projectedItems, searchQuery]);

  const filteredTabs = useMemo(
    () =>
      filteredItems.flatMap((item) => (item.kind === "tab" ? [item.tab] : [])),
    [filteredItems],
  );

  const gapAtY = (clientY: number) => {
    const els = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [],
    );
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return els.length;
  };

  const endDrag = (currentTarget: Element) => {
    const st = drag.current;
    if (st) currentTarget.releasePointerCapture?.(st.pointerId);
    drag.current = null;
    setDraggingId(null);
    setDropGap(null);
    document.body.style.userSelect = "";
  };

  useEffect(() => () => cancelWorkspaceDrag(), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[data-tab-active="true"]');
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, activeStripItem]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/50">
      {/* Header with Search and New Tab Action */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/25 px-2 py-1.5">
        <div className="relative flex flex-1 items-center">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-2.5 text-muted-foreground/60"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("tabs.searchTabs")}
            className="h-7 w-full rounded-lg border border-border/30 bg-foreground/[0.035] pl-7 pr-6 text-[11.5px] text-foreground placeholder:text-muted-foreground/50 transition-all outline-none hover:border-border/50 focus:border-primary/50 focus:bg-background/80"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 flex size-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
            </button>
          )}
        </div>
        {onNew &&
        onNewBlock &&
        onNewPrivate &&
        onNewPreview &&
        onNewEditor &&
        onNewGitGraph &&
        onLaunchAgents ? (
          <NewTabMenu
            onNew={onNew}
            onNewShell={onNewShell}
            onNewWsl={onNewWsl}
            onNewBlock={onNewBlock}
            onNewPrivate={onNewPrivate}
            onNewPreview={onNewPreview}
            onNewEditor={onNewEditor}
            onNewRdp={onNewRdp}
            onConnectRemote={onConnectRemote}
            onOpenFile={onOpenFile}
            onOpenFolder={onOpenFolder}
            onNewGitGraph={onNewGitGraph}
            onLaunchAgents={onLaunchAgents}
          />
        ) : onNew ? (
          <button
            type="button"
            onClick={onNew}
            title={t("tabs.newTab")}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/30 bg-foreground/[0.035] text-muted-foreground transition-colors hover:border-border/50 hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={13} strokeWidth={2} />
          </button>
        ) : null}
        {workspaceDrag.active && canExtractWorkspaceDrag(workspaceDrag.source) && (
          <span
            data-workspace-drop-kind="loose-strip"
            className="flex h-7 shrink-0 items-center rounded-lg border border-dashed border-primary/50 px-2 text-[10px] text-primary/90"
          >
            {t("spaces.extractMember")}
          </span>
        )}
      </div>

      {/* Tabs list */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <HugeiconsIcon
              icon={Search01Icon}
              size={18}
              strokeWidth={1.5}
              className="text-muted-foreground/40"
            />
            <span className="text-[11.5px]">{t("tabs.noMatchingTabs")}</span>
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-[11px] font-medium text-primary hover:underline"
            >
              {t("tabs.clearSearch")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filteredItems.map((item) => {
              if (item.kind === "space") {
                const isActive = isProjectedStripItemActive(
                  item,
                  tabs.find((tab) => tab.id === activeId)?.tabKey ?? null,
                );
                return (
                  <CompositeSpaceChip
                    key={item.space.id}
                    item={item}
                    active={isActive}
                    onSelect={onSelectSpace ?? (() => undefined)}
                    onExpand={onExpandSpace ?? (() => undefined)}
                    onRename={onRenameSpace}
                    onSetColor={onSetSpaceColor}
                    className="h-auto min-h-[44px] w-full justify-start rounded-xl px-2.5 py-1.5"
                  />
                );
              }

              const tab = item.tab;
              const tabIndex = filteredTabs.findIndex(
                (filteredTab) => filteredTab.id === tab.id,
              );
              const isPreview =
                (tab.kind === "editor" || tab.kind === "git-diff") &&
                tab.preview;
              const activeTabKey =
                activeStripItem?.kind === "tab"
                  ? activeStripItem.tabKey
                  : (tabs.find((candidate) => candidate.id === activeId)
                      ?.tabKey ?? null);
              const isActive = projectionEnabled
                ? isProjectedStripItemActive(item, activeTabKey)
                : tab.id === activeId;
              const isPulsing = !!pulsingTabs[tab.id];
              const subtitle = getTabSubtitle(tab);
              const srcIndex = filteredTabs.findIndex(
                (x) => x.id === draggingId,
              );
              const showGap = (gap: number) =>
                draggingId !== null &&
                dropGap === gap &&
                gap !== srcIndex &&
                gap !== srcIndex + 1;

              const prevCat =
                tabIndex > 0 ? tabCategory(filteredTabs[tabIndex - 1]) : null;
              const currCat = tabCategory(tab);
              const isNewCategory =
                !searchQuery && tabIndex > 0 && prevCat !== currCat;

              const handleDragStart = (e: React.PointerEvent) => {
                if (e.button !== 0) return;
                drag.current = {
                  pointerId: e.pointerId,
                  startY: e.clientY,
                  fromId: tab.id,
                  active: false,
                };
                beginWorkspaceDrag(
                  workspaceDragSourceForTab(
                    tab.id,
                    tab.tabKey,
                    viewSpaces ?? [],
                  ),
                  { x: e.clientX, y: e.clientY },
                  { activationAxis: "x" },
                );
                e.currentTarget.setPointerCapture(e.pointerId);
              };

              const handleDragMove = (e: React.PointerEvent) => {
                const st = drag.current;
                if (!st || st.pointerId !== e.pointerId) return;
                if (!st.active) {
                  if (Math.abs(e.clientY - st.startY) < 4) return;
                  st.active = true;
                  setDraggingId(st.fromId);
                  document.body.style.userSelect = "none";
                }
                e.preventDefault();
                setDropGap(gapAtY(e.clientY));
              };

              const handleDragEnd = (e: React.PointerEvent) => {
                const st = drag.current;
                const workspaceState = getWorkspaceDragState();
                if (
                  workspaceState.active &&
                  workspaceState.source &&
                  workspaceState.target &&
                  onWorkspaceDrop
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  const finished = finishWorkspaceDrag();
                  if (finished.source && finished.target) {
                    onWorkspaceDrop(finished.source, finished.target);
                  }
                  endDrag(e.currentTarget);
                  return;
                }
                if (workspaceState.source) finishWorkspaceDrag();
                if (st?.active && dropGap !== null) {
                  onReorderVisual
                    ? onReorderVisual(
                        st.fromId,
                        dropGap,
                        filteredTabs.map((visibleTab) => visibleTab.id),
                      )
                    : onReorder(st.fromId, dropGap);
                } else if (st && !st.active) {
                  onSelect(tab.id);
                }
                endDrag(e.currentTarget);
              };

              const handleDoubleClick = () => {
                if (isPreview) {
                  onPin(tab.id);
                } else if (tab.kind === "terminal") {
                  setEditingId(tab.id);
                }
              };

              const handleKeyDown = (
                e: React.KeyboardEvent<HTMLDivElement>,
              ) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(tab.id);
                }
              };

              const handleAuxClick = (e: React.MouseEvent) => {
                if (e.button === 1 && tabs.length > 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!tab.locked) {
                    onClose(tab.id);
                  }
                }
              };

              const tabCard = (
                <div
                  data-tab-id={tab.id}
                  data-tab-active={isActive ? "true" : "false"}
                  role="button"
                  tabIndex={0}
                  aria-label={labelFor(tab)}
                  aria-pressed={isActive}
                  onPointerDown={handleDragStart}
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  onPointerCancel={(e) => {
                    cancelWorkspaceDrag();
                    endDrag(e.currentTarget);
                  }}
                  onDoubleClick={handleDoubleClick}
                  onKeyDown={handleKeyDown}
                  onAuxClick={handleAuxClick}
                  style={
                    tab.color
                      ? {
                          borderColor: `${tab.color}45`,
                          backgroundColor: `${tab.color}15`,
                        }
                      : undefined
                  }
                  className={cn(
                    "group relative flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-1.5 transition-all",
                    draggingId === tab.id && "opacity-50",
                    isPulsing && "voktty-tab-finished-pulse",
                    isActive
                      ? "border-border/50 bg-foreground/[0.07] text-foreground shadow-xs"
                      : "border-transparent text-muted-foreground hover:border-border/30 hover:bg-foreground/[0.035] hover:text-foreground/90",
                  )}
                >
                  {/* Left accent bar on active or colored */}
                  <span
                    className={cn(
                      "absolute left-0.5 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full transition-all duration-150",
                      isActive || tab.color ? "opacity-100" : "opacity-0",
                    )}
                    style={{ backgroundColor: tab.color ?? "var(--primary)" }}
                  />

                  {/* Left avatar badge */}
                  <div
                    className={cn(
                      "relative flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-card/60 shadow-xs transition-colors group-hover:border-border/70",
                      isActive && "border-border/70 bg-card/90",
                    )}
                    style={
                      tab.color
                        ? {
                            borderColor: `${tab.color}60`,
                            backgroundColor: `${tab.color}20`,
                          }
                        : undefined
                    }
                  >
                    <TabBadgeIcon tab={tab} />
                    {/* Status dot */}
                    {isPulsing ? (
                      <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-card animate-pulse" />
                    ) : tab.color ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <span
                            role="button"
                            tabIndex={-1}
                            data-no-drag
                            aria-label={t("tooltips.changeTabColor")}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-card cursor-pointer hover:scale-125 transition-transform"
                            style={{ backgroundColor: tab.color }}
                            title={t("tooltips.changeColorTag")}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          side="right"
                          sideOffset={6}
                          className="p-1.5 rounded-xl border border-border/40 bg-popover/95 backdrop-blur-md shadow-lg"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <div className="mb-1 px-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            {t("tooltips.colorTag")}
                          </div>
                          <TabColorBubbles
                            size="md"
                            currentColor={tab.color}
                            onSelectColor={(c) => onSetColor?.(tab.id, c)}
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : isActive && tab.kind === "terminal" ? (
                      <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-card" />
                    ) : tab.kind === "editor" && tab.dirty ? (
                      <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-card" />
                    ) : null}
                  </div>

                  {/* Middle content (Title & Subtitle) */}
                  <div className="flex min-w-0 flex-1 flex-col justify-center">
                    {editingId === tab.id && tab.kind === "terminal" ? (
                      <TabRenameInput
                        initial={labelFor(tab)}
                        onCommit={(value) => {
                          onRename(tab.id, value);
                          setEditingId(null);
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={cn(
                            "truncate text-[12px] font-medium leading-tight tracking-tight",
                            isActive ? "text-foreground" : "text-foreground/90",
                            isPreview && "italic",
                          )}
                          title={labelFor(tab)}
                        >
                          {labelFor(tab)}
                        </span>
                        <TabProcessBadge tab={tab} />
                      </div>
                    )}
                    <div className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] leading-tight text-muted-foreground/75">
                      {subtitle.icon === "git" && (
                        <HugeiconsIcon
                          icon={GitBranchIcon}
                          size={10}
                          strokeWidth={1.75}
                          className="shrink-0 text-muted-foreground/70"
                        />
                      )}
                      {subtitle.icon === "folder" && (
                        <HugeiconsIcon
                          icon={Folder01Icon}
                          size={10}
                          strokeWidth={1.75}
                          className="shrink-0 text-muted-foreground/70"
                        />
                      )}
                      {subtitle.icon === "remote" && (
                        <HugeiconsIcon
                          icon={Globe02Icon}
                          size={10}
                          strokeWidth={1.75}
                          className="shrink-0 text-muted-foreground/70"
                        />
                      )}
                      {subtitle.icon === "status" && (
                        <HugeiconsIcon
                          icon={SparklesIcon}
                          size={10}
                          strokeWidth={1.75}
                          className="shrink-0 text-amber-400"
                        />
                      )}
                      <span className="truncate">{subtitle.text}</span>
                    </div>
                  </div>

                  {/* Right side close / dirty actions */}
                  <div className="flex shrink-0 items-center gap-1">
                    {tab.kind === "editor" && tab.dirty && (
                      <span
                        aria-label={t("explorer.unsavedChanges")}
                        className="size-1.5 shrink-0 rounded-full bg-amber-500/90 group-hover:hidden"
                      />
                    )}
                    {tab.locked ? (
                      <span
                        className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/75"
                        title={t("tabs.tabIsLocked")}
                        data-no-drag
                      >
                        <HugeiconsIcon
                          icon={SquareLock01Icon}
                          size={12}
                          strokeWidth={2}
                        />
                      </span>
                    ) : (
                      tabs.length > 1 && (
                        <span
                          role="button"
                          tabIndex={-1}
                          aria-label={t("tabs.closeTab")}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onClose(tab.id);
                          }}
                          className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-all hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100"
                        >
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            size={11}
                            strokeWidth={2}
                          />
                        </span>
                      )
                    )}
                  </div>
                  <TabProcessBottomBar tab={tab} />
                </div>
              );

              const contextMenu = (
                <ContextMenu
                  onOpenChange={(open) => {
                    useTabContextMenuStore.getState().setOpen(open);
                  }}
                >
                  <ContextMenuTrigger asChild>{tabCard}</ContextMenuTrigger>
                  <ContextMenuContent
                    className="min-w-36 p-1"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <div className="px-2.5 py-1.5">
                      <div className="mb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {t("tooltips.colorTag")}
                      </div>
                      <TabColorBubbles
                        size="md"
                        currentColor={tab.color}
                        onSelectColor={(c) => onSetColor?.(tab.id, c)}
                      />
                    </div>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="gap-2 rounded-lg px-2.5 py-1.5 text-[12px]"
                      onSelect={() => onToggleLock?.(tab.id)}
                    >
                      <HugeiconsIcon
                        icon={
                          tab.locked ? SquareUnlock01Icon : SquareLock01Icon
                        }
                        size={13}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1">
                        {tab.locked ? t("tabs.unlockTab") : t("tabs.lockTab")}
                      </span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    {tab.kind === "terminal" && (
                      <>
                        {!tab.collaboration && onShareTerminal ? (
                          <ContextMenuItem
                            className="gap-2 rounded-lg px-2.5 py-1.5 text-[12px]"
                            onSelect={() => onShareTerminal(tab.id)}
                          >
                            <HugeiconsIcon
                              icon={ComputerScreenShareIcon}
                              size={13}
                              strokeWidth={1.75}
                            />
                            <span className="flex-1">
                              {t("collab.host.menuAction")}
                            </span>
                          </ContextMenuItem>
                        ) : null}
                        <ContextMenuItem
                          className="gap-2 rounded-lg px-2.5 py-1.5 text-[12px]"
                          onSelect={() => onDuplicate(tab.id)}
                        >
                          <HugeiconsIcon
                            icon={Copy01Icon}
                            size={13}
                            strokeWidth={1.75}
                          />
                          <span className="flex-1">
                            {t("tabs.duplicateTab")}
                          </span>
                        </ContextMenuItem>
                        <ContextMenuItem
                          className="gap-2 rounded-lg px-2.5 py-1.5 text-[12px]"
                          onSelect={() => setEditingId(tab.id)}
                        >
                          <HugeiconsIcon
                            icon={PencilEdit02Icon}
                            size={13}
                            strokeWidth={1.75}
                          />
                          <span className="flex-1">{t("tabs.renameTab")}</span>
                        </ContextMenuItem>
                        {onToggleBlocks ? (
                          <ContextMenuItem
                            className="gap-2 rounded-lg px-2.5 py-1.5 text-[12px] font-medium"
                            onSelect={() => onToggleBlocks(tab.id)}
                          >
                            <HugeiconsIcon
                              icon={SparklesIcon}
                              size={13}
                              strokeWidth={1.75}
                              className={
                                tab.blocks
                                  ? "text-amber-400"
                                  : "text-violet-400"
                              }
                            />
                            <span className="flex-1">
                              {tab.blocks
                                ? t("tabs.convertToNormalTerminal")
                                : t("tabs.convertToAgenticTerminal")}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              Ctrl+U
                            </span>
                          </ContextMenuItem>
                        ) : null}
                        <ContextMenuSeparator />
                      </>
                    )}
                    {isPreview && (
                      <>
                        <ContextMenuItem
                          className="gap-2 rounded-lg px-2.5 py-1.5 text-[12px]"
                          onSelect={() => onPin(tab.id)}
                        >
                          <span className="flex-1">{t("tabs.pinTab")}</span>
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                      </>
                    )}
                    {onCloseOtherTabs && tabs.length > 1 && (
                      <ContextMenuItem
                        className="gap-2 rounded-lg px-2.5 py-1.5 text-[12px]"
                        onSelect={() => onCloseOtherTabs(tab.id)}
                      >
                        <span className="flex-1">
                          {t("tabs.closeOtherTabs")}
                        </span>
                      </ContextMenuItem>
                    )}
                    {onCloseTabsToRight && tabs.length > 1 && (
                      <ContextMenuItem
                        className="gap-2 rounded-lg px-2.5 py-1.5 text-[12px]"
                        onSelect={() => onCloseTabsToRight(tab.id)}
                      >
                        <span className="flex-1">
                          {t("tabs.closeTabsToRight")}
                        </span>
                      </ContextMenuItem>
                    )}
                    {!tab.locked && tabs.length > 1 && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-destructive focus:text-destructive"
                          onSelect={() => onClose(tab.id)}
                        >
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            size={13}
                            strokeWidth={1.75}
                          />
                          <span className="flex-1">{t("tabs.closeTab")}</span>
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              );

              const renderedTabCard = (
                <TabDetailsHoverCard
                  tab={tab}
                  activeWorkspaceEnv={workspaceEnv}
                  side="right"
                  align="start"
                >
                  {contextMenu}
                </TabDetailsHoverCard>
              );

              return (
                <div key={tab.id} className="flex flex-col gap-0.5">
                  {isNewCategory && (
                    <div className="my-1.5 flex items-center gap-2 px-2 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider select-none">
                      <span className="h-px flex-1 bg-border/20" />
                      <span>
                        {currCat === "terminals"
                          ? t("activeTabs.terminal")
                          : currCat === "files"
                            ? t("activeTabs.editor")
                            : t("activeTabs.tools")}
                      </span>
                      <span className="h-px flex-1 bg-border/20" />
                    </div>
                  )}
                  {showGap(tabIndex) && <DropIndicator />}
                  {renderedTabCard}
                  {tabIndex === filteredTabs.length - 1 &&
                    showGap(filteredTabs.length) && <DropIndicator />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DropIndicator() {
  return (
    <span
      aria-hidden
      className="mx-0.5 h-0.5 shrink-0 self-stretch rounded-full bg-primary"
    />
  );
}

function TabRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  const commit = (value: string, explicit: boolean) => {
    if (!explicit && value.trim() === initial.trim()) finish(onCancel);
    else finish(() => onCommit(value));
  };

  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label={t("tooltips.renameTab")}
      data-no-drag
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        "w-full min-w-0 rounded-md bg-background px-1.5 py-0.5 text-xs text-foreground",
        "outline-none ring-1 ring-border focus:ring-primary/60",
      )}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(e.currentTarget.value, true);
        else if (e.key === "Escape") finish(onCancel);
      }}
      onBlur={(e) => {
        if (!document.hasFocus()) return;
        commit(e.currentTarget.value, false);
      }}
    />
  );
}
