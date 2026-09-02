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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import type { AgentLaunchRequest } from "@/modules/agents/lib/launcher";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { AnimatedAgentIcon } from "@/modules/ai/avatar/AnimatedAgentIcon";
import { terminalPresence } from "@/modules/ai/avatar/presence";
import {
  ALL_LANGUAGES,
  EXPOSED_LANGUAGES,
} from "@/modules/editor/lib/languageDefinitions";
import { resolveDisplayName } from "@/modules/editor/lib/languageResolver";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
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
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  ComputerIcon,
  ComputerScreenShareIcon,
  ComputerTerminal02Icon,
  Copy01Icon,
  Folder01Icon,
  GitCompareIcon,
  Globe02Icon,
  IncognitoIcon,
  Loading03Icon,
  Message02Icon,
  PanelLeftOpenIcon,
  PencilEdit02Icon,
  Refresh01Icon,
  ServerStack01Icon,
  SparklesIcon,
  SquareLock01Icon,
  SquareUnlock01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { revealInFinder } from "@/modules/explorer/lib/contextActions";
import { leafIds } from "@/modules/terminal/lib/panes";
import { respawnSession } from "@/modules/terminal";
import { getTabPath } from "./lib/tabMetadata";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TabDetailsHoverCard } from "./components/TabDetailsHoverCard";
import { useTabContextMenuStore } from "./lib/tabContextMenuState";
import { isSshOrRemoteSession, isSshTab, labelFor } from "./lib/tabLabel";
import {
  type TabProcessStatus,
  useTabProcessStatus,
} from "./lib/useTabProcessStatus";
import { detectAgentFromName } from "@/modules/terminal";
import type { EditorTab, Tab } from "./lib/useTabs";
import { NewTabMenu } from "./NewTabMenu";
import { TabColorBubbles } from "./TabColorBubbles";

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
  onDuplicate: (id: number) => void;
  /** Set a terminal tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  /** Move a dragged tab to a new position (insertion gap index 0..tabs.length). */
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
  compact?: boolean;
};

export function TabBar({
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
  onReconnectTab,
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
  compact,
}: Props) {
  const { t: translate } = useTranslation();
  const pulsingTabs = useAgentStore((s) => s.pulsingTabs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const [showAllLanguages, setShowAllLanguages] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    fromId: number;
    active: boolean;
  } | null>(null);

  // Play the enter animation only for tabs opened after the first paint, never
  // the restored set and never on switch/reorder (triggers are keyed, so they
  // don't remount then). The ref is seeded with the initial ids on first render.
  const seenRef = useRef<Set<number> | null>(null);
  const firstRender = seenRef.current === null;
  let seen = seenRef.current;
  if (seen === null) {
    seen = new Set(tabs.map((t) => t.id));
    seenRef.current = seen;
  }
  useEffect(() => {
    seenRef.current = new Set(tabs.map((t) => t.id));
  }, [tabs]);

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
  const visibleTabs = useMemo(
    () =>
      projectedItems.flatMap((item) => (item.kind === "tab" ? [item.tab] : [])),
    [projectedItems],
  );
  const activeTabKey = tabs.find((tab) => tab.id === activeId)?.tabKey ?? null;

  // Single shared pill slides to the active tab instead of each tab toggling
  // its own background. Measured relative to the list (its offsetParent) so it
  // scrolls with the strip for free; transform/width only, no layout on siblings.
  const [pill, setPill] = useState<{ left: number; width: number } | null>(
    null,
  );
  const [pillReady, setPillReady] = useState(false);

  const measurePill = useCallback(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      '[data-tab-active="true"]',
    );
    setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, []);

  useLayoutEffect(() => {
    measurePill();
  }, [measurePill, activeId, activeStripItem, projectedItems]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const ro = new ResizeObserver(measurePill);
    ro.observe(list);
    return () => ro.disconnect();
  }, [measurePill]);

  // Hold the transition off until the pill is first placed, so it never slides
  // in from the origin on mount.
  useEffect(() => {
    if (pill && !pillReady) {
      const id = requestAnimationFrame(() => setPillReady(true));
      return () => cancelAnimationFrame(id);
    }
  }, [pill, pillReady]);

  const gapAtX = (clientX: number) => {
    const els = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [],
    );
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) return i;
    }
    return els.length;
  };

  const endDrag = (currentTarget: HTMLElement) => {
    const st = drag.current;
    if (st) currentTarget.releasePointerCapture?.(st.pointerId);
    drag.current = null;
    setDraggingId(null);
    setDropGap(null);
    document.body.style.userSelect = "";
  };

  // Horizontal wheel scroll without holding shift.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the active tab visible after selection / open.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[data-tab-active="true"]');
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, activeStripItem]);

  const activeValue =
    activeStripItem?.kind === "space"
      ? `space:${activeStripItem.spaceId}`
      : String(activeId);

  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const workspaceDrag = useWorkspaceDrag();

  useEffect(() => () => cancelWorkspaceDrag(), []);

  return (
    <div
      ref={scrollRef}
      data-tabs-header
      data-tauri-drag-region
      className="group min-w-0 shrink overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-max items-center gap-0.5">
        <Tabs
          value={activeValue}
          onValueChange={(value) => {
            if (value.startsWith("space:")) {
              onSelectSpace?.(value.slice("space:".length));
              return;
            }
            onSelect(Number(value));
          }}
        >
          <TabsList
            ref={listRef}
            className="relative h-6.5 w-max gap-0.5 bg-transparent p-0"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute left-0 top-1/2 h-6.5 rounded-md bg-foreground/[0.07] shadow-sm ring-1 ring-inset ring-foreground/[0.05]"
              style={
                pill
                  ? {
                      width: pill.width,
                      transform: `translate(${pill.left}px, -50%)`,
                      transitionProperty: pillReady
                        ? "transform, width"
                        : "none",
                      transitionDuration: "var(--dur-base)",
                      transitionTimingFunction: "var(--ease-premium)",
                    }
                  : { opacity: 0 }
              }
            />
            {projectedItems.map((item) => {
              if (item.kind === "space") {
                const isActive = isProjectedStripItemActive(item, activeTabKey);
                return (
                  <CompositeSpaceChip
                    key={item.space.id}
                    item={item}
                    active={isActive}
                    compact={compact}
                    onSelect={onSelectSpace ?? (() => undefined)}
                    onExpand={onExpandSpace ?? (() => undefined)}
                    onRename={onRenameSpace}
                    onSetColor={onSetSpaceColor}
                  />
                );
              }

              const t = item.tab;
              const tabIndex = visibleTabs.findIndex(
                (visibleTab) => visibleTab.id === t.id,
              );
              const isPreview =
                (t.kind === "editor" || t.kind === "git-diff") && t.preview;
              const isActive = projectionEnabled
                ? isProjectedStripItemActive(item, activeTabKey)
                : t.id === activeId;
              const isNew = !firstRender && !seen.has(t.id);
              const isPulsing = !!pulsingTabs[t.id];
              const isCompressible = compact || visibleTabs.length >= 7;
              const isCollapsed =
                isCompressible && !isActive && editingId !== t.id;

              const srcIndex = visibleTabs.findIndex(
                (x) => x.id === draggingId,
              );
              const showGap = (gap: number) =>
                draggingId !== null &&
                dropGap === gap &&
                gap !== srcIndex &&
                gap !== srcIndex + 1;

              // While renaming, render a non-button cell so the <input> is not
              // nested inside the trigger <button> (invalid HTML, and WebKit
              // blocks focus/selection on inputs inside buttons).
              if (editingId === t.id && t.kind === "terminal") {
                return (
                  <Fragment key={t.id}>
                    {showGap(tabIndex) && <DropIndicator />}
                    <div
                      data-tab-id={t.id}
                      style={
                        t.color
                          ? {
                              borderColor: `${t.color}55`,
                              backgroundColor: `${t.color}15`,
                              boxShadow: `inset 0 -2px 0 ${t.color}`,
                            }
                          : undefined
                      }
                      className={cn(
                        "flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent text-xs text-foreground",
                        t.color && "border",
                        compact ? "px-1.5" : "px-2",
                      )}
                    >
                      {t.color && (
                        <span
                          className="size-2 shrink-0 rounded-full shadow-xs ring-1 ring-background"
                          style={{ backgroundColor: t.color }}
                        />
                      )}
                      <TabIcon tab={t} animatedAgent />
                      <TabRenameInput
                        initial={labelFor(t)}
                        onCommit={(value) => {
                          onRename(t.id, value);
                          setEditingId(null);
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    </div>
                    {tabIndex === visibleTabs.length - 1 &&
                      showGap(visibleTabs.length) && <DropIndicator />}
                  </Fragment>
                );
              }

              const trigger = (
                <TabsTrigger
                  value={String(t.id)}
                  data-tab-id={t.id}
                  data-tab-active={isActive ? "true" : undefined}
                  title={labelFor(t)}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    if ((e.target as HTMLElement).closest("[data-no-drag]"))
                      return;
                    drag.current = {
                      pointerId: e.pointerId,
                      startX: e.clientX,
                      fromId: t.id,
                      active: false,
                    };
                    beginWorkspaceDrag(
                      workspaceDragSourceForTab(
                        t.id,
                        t.tabKey,
                        viewSpaces ?? [],
                      ),
                      { x: e.clientX, y: e.clientY },
                      { activationAxis: "y" },
                    );
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const st = drag.current;
                    if (!st || st.pointerId !== e.pointerId) return;
                    if (!st.active) {
                      if (Math.abs(e.clientX - st.startX) < 4) return;
                      st.active = true;
                      setDraggingId(st.fromId);
                      document.body.style.userSelect = "none";
                    }
                    e.preventDefault();
                    setDropGap(gapAtX(e.clientX));
                  }}
                  onPointerUp={(e) => {
                    const st = drag.current;
                    const workspaceDrag = getWorkspaceDragState();
                    if (
                      workspaceDrag.active &&
                      workspaceDrag.target &&
                      workspaceDrag.source &&
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
                    if (workspaceDrag.source) finishWorkspaceDrag();
                    if (st?.active && dropGap !== null) {
                      onReorderVisual
                        ? onReorderVisual(
                            st.fromId,
                            dropGap,
                            visibleTabs.map((tab) => tab.id),
                          )
                        : onReorder(st.fromId, dropGap);
                    } else if (st && !st.active) {
                      onSelect(t.id);
                    }
                    endDrag(e.currentTarget);
                  }}
                  onPointerCancel={(e) => {
                    cancelWorkspaceDrag();
                    endDrag(e.currentTarget);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (isPreview) {
                      onPin?.(t.id);
                    } else if (t.kind === "terminal") {
                      setEditingId(t.id);
                    }
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!t.locked) {
                        onClose(t.id);
                      }
                    }
                  }}
                  // Suppress Radix's switch-on-mousedown so a tab grabbed to
                  // drag (or a plain click) only activates on release.
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      return;
                    }
                    if (
                      e.button === 0 &&
                      !(e.target as HTMLElement).closest("[data-no-drag]")
                    ) {
                      e.preventDefault();
                    }
                  }}
                  style={
                    t.color
                      ? {
                          borderColor: `${t.color}55`,
                          backgroundColor: `${t.color}15`,
                          boxShadow: `inset 0 -2px 0 ${t.color}`,
                        }
                      : undefined
                  }
                  className={cn(
                    "group relative z-[1] h-6.5 shrink-0 justify-between gap-1 rounded-md bg-transparent text-[11.5px] transition-all duration-150 data-active:bg-transparent dark:data-active:bg-transparent",
                    isNew && "voktty-tab-in",
                    isPulsing && "voktty-tab-finished-pulse",
                    t.color && "border",
                    isActive
                      ? "text-foreground dark:text-foreground"
                      : "text-muted-foreground hover:text-foreground/80 dark:text-muted-foreground",
                    draggingId === t.id && "opacity-50",
                    isCollapsed
                      ? "px-1.5! gap-1 justify-center max-w-8.5 hover:max-w-64 hover:px-2! hover:justify-between"
                      : compact
                        ? "px-1.5!"
                        : visibleTabs.length === 1
                          ? "px-2!"
                          : "ps-2! pe-1!",
                  )}
                >
                  <span
                    className={cn(
                      "flex min-w-0 items-center transition-all duration-150",
                      isCollapsed
                        ? "gap-1 max-w-fit group-hover:max-w-48 group-hover:gap-1.5"
                        : compact
                          ? "gap-1.5 max-w-48"
                          : "gap-1.5 max-w-80",
                    )}
                  >
                    {t.color && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <span
                            role="button"
                            tabIndex={-1}
                            data-no-drag
                            aria-label={translate("tooltips.changeTabColor")}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            className={cn(
                              "shrink-0 rounded-full shadow-xs ring-1 ring-background cursor-pointer hover:scale-125 transition-transform",
                              isCollapsed ? "size-1.5" : "size-2",
                            )}
                            style={{ backgroundColor: t.color }}
                            title={translate("tooltips.changeColorTag")}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          side="bottom"
                          sideOffset={6}
                          className="p-1.5 rounded-xl border border-border/40 bg-popover/95 backdrop-blur-md shadow-lg"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <div className="mb-1 px-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            {translate("tooltips.colorTag")}
                          </div>
                          <TabColorBubbles
                            size="md"
                            currentColor={t.color}
                            onSelectColor={(c) => onSetColor?.(t.id, c)}
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {t.kind === "editor" ? (
                      <DropdownMenu
                        onOpenChange={(open) => {
                          if (!open) setShowAllLanguages(false);
                        }}
                      >
                        <DropdownMenuTrigger asChild>
                          {/* span, not button: a button nested in the TabsTrigger button is invalid DOM and breaks WebKit focus. */}
                          <span
                            role="button"
                            tabIndex={-1}
                            data-no-drag
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm p-1 -m-1 transition-all hover:bg-accent hover:text-accent-foreground hover:ring-1 hover:ring-primary/30 hover:shadow-[0_0_4px_var(--color-popover-foreground)]"
                          >
                            <TabIcon tab={t} />
                          </span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          side="bottom"
                          sideOffset={6}
                          alignOffset={-4}
                          className="max-h-75 w-48 overflow-y-auto rounded-xl border border-border/40 bg-popover/90 p-1 backdrop-blur-md shadow-lg"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onPointerUp={(e) => e.stopPropagation()}
                        >
                          <DropdownMenuItem
                            onSelect={() => {
                              onOverrideLanguage?.(t.id, null);
                            }}
                            className="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg cursor-default focus:bg-accent focus:text-accent-foreground"
                          >
                            <img
                              src={fileIconUrl(t.title)}
                              className="size-3.5 shrink-0 object-contain"
                              alt=""
                            />
                            <div className="flex flex-1 flex-col">
                              <span>
                                {translate("tabs.autoDetectLanguage")}
                              </span>
                              <span className="text-[10px] text-muted-foreground italic">
                                {translate("tabs.modeLanguage", {
                                  name: resolveDisplayName(t.title),
                                })}
                              </span>
                            </div>
                            {!(t as EditorTab).overrideLanguage && (
                              <HugeiconsIcon
                                icon={Tick02Icon}
                                className="size-3.5 text-primary"
                              />
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={(e) => {
                              e.preventDefault();
                              setShowAllLanguages((v) => !v);
                            }}
                            className="w-full px-2.5 py-1.5 text-left text-xs text-primary/60 hover:text-primary rounded-lg transition-colors hover:bg-accent"
                          >
                            {showAllLanguages
                              ? translate("tabs.fewerLanguages")
                              : translate("tabs.allLanguages")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="my-1 border-t border-border/30" />
                          {(showAllLanguages
                            ? ALL_LANGUAGES
                            : EXPOSED_LANGUAGES
                          ).map((lang) => {
                            const isSelected =
                              (t as EditorTab).overrideLanguage === lang.ext;
                            return (
                              <DropdownMenuItem
                                key={lang.ext}
                                onSelect={() =>
                                  onOverrideLanguage?.(t.id, lang.ext)
                                }
                                className="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg cursor-default focus:bg-accent focus:text-accent-foreground"
                              >
                                <img
                                  src={fileIconUrl(`dummy.${lang.ext}`)}
                                  className="size-3.5 shrink-0 object-contain"
                                  alt=""
                                />
                                <span className="flex-1">{lang.name}</span>
                                {isSelected && (
                                  <HugeiconsIcon
                                    icon={Tick02Icon}
                                    className="size-3.5 text-primary"
                                  />
                                )}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <TabIcon tab={t} animatedAgent />
                    )}
                    {/* Preview tabs use italic to signal the transient state,
                        matching the visual convention from VSCode. */}
                    <span
                      className={cn(
                        "truncate transition-all duration-150",
                        isCollapsed &&
                          "max-w-0 opacity-0 group-hover:max-w-40 group-hover:opacity-100 group-hover:ml-0.5",
                        isPreview && "italic",
                      )}
                    >
                      {labelFor(t)}
                    </span>
                    <TabProcessBadge tab={t} isCollapsed={isCollapsed} />
                    {t.kind === "editor" && t.dirty ? (
                      <span
                        aria-label={translate("tabs.unsavedChanges")}
                        className={cn(
                          "size-1.5 shrink-0 rounded-full bg-foreground/70",
                          isCollapsed && "hidden group-hover:inline-block",
                        )}
                      />
                    ) : null}
                  </span>
                  <div className="flex items-center gap-1">
                    {t.locked ? (
                      <span
                        className="inline-flex items-center text-muted-foreground/75 p-0.5"
                        title={translate("tabs.tabIsLocked")}
                        data-no-drag
                      >
                        <HugeiconsIcon
                          icon={SquareLock01Icon}
                          size={11}
                          strokeWidth={2}
                        />
                      </span>
                    ) : (
                      <span
                        role="button"
                        aria-label={translate("tabs.closeTab")}
                        data-no-drag
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
                          onClose(t.id);
                        }}
                        className={cn(
                          "rounded p-0.5 transition-opacity hover:bg-accent",
                          isCollapsed
                            ? "hidden group-hover:flex opacity-0 group-hover:opacity-60 hover:opacity-100!"
                            : "opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-60",
                        )}
                      >
                        <HugeiconsIcon
                          icon={Cancel01Icon}
                          size={11}
                          strokeWidth={2}
                        />
                      </span>
                    )}
                  </div>
                  <TabProcessBottomBar tab={t} />
                </TabsTrigger>
              );

              const hasTabsToRight = tabIndex < visibleTabs.length - 1;

              const tabNode = (
                <ContextMenu
                  onOpenChange={(open) => {
                    useTabContextMenuStore.getState().setOpen(open);
                  }}
                >
                  <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
                  <ContextMenuContent
                    className="min-w-36 p-1"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <div className="px-2 py-1.5">
                      <div className="mb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {translate("tabs.colorTag")}
                      </div>
                      <TabColorBubbles
                        size="md"
                        currentColor={t.color}
                        onSelectColor={(c) => onSetColor?.(t.id, c)}
                      />
                    </div>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                      onSelect={() => onToggleLock?.(t.id)}
                    >
                      <HugeiconsIcon
                        icon={t.locked ? SquareUnlock01Icon : SquareLock01Icon}
                        size={13}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1">
                        {t.locked
                          ? translate("tabs.unlockTab")
                          : translate("tabs.lockTab")}
                      </span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    {(() => {
                      const tabPath = getTabPath(t);
                      if (!tabPath) return null;
                      return (
                        <>
                          <ContextMenuItem
                            className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                            onSelect={() => onRevealInExplorer?.(tabPath)}
                          >
                            <HugeiconsIcon
                              icon={PanelLeftOpenIcon}
                              size={13}
                              strokeWidth={1.75}
                            />
                            <span className="flex-1">
                              {translate("tabs.revealInSideBar")}
                            </span>
                          </ContextMenuItem>
                          <ContextMenuItem
                            className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                            onSelect={() => void revealInFinder(tabPath)}
                          >
                            <HugeiconsIcon
                              icon={Folder01Icon}
                              size={13}
                              strokeWidth={1.75}
                            />
                            <span className="flex-1">
                              {translate("tabs.revealInFileManager")}
                            </span>
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                        </>
                      );
                    })()}
                    {t.kind === "terminal" && (
                      <>
                        {isSshTab(t, workspaceEnv) && (
                          <ContextMenuItem
                            className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                            onSelect={() => {
                              if (onReconnectTab) {
                                onReconnectTab(t);
                              } else {
                                const ids = leafIds(t.paneTree);
                                for (const leafId of ids) {
                                  void respawnSession(leafId);
                                }
                              }
                            }}
                          >
                            <HugeiconsIcon
                              icon={Refresh01Icon}
                              size={13}
                              strokeWidth={1.75}
                            />
                            <span className="flex-1">
                              {translate("tabs.reconnectSsh")}
                            </span>
                          </ContextMenuItem>
                        )}
                        {!t.collaboration && onShareTerminal ? (
                          <ContextMenuItem
                            className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                            onSelect={() => onShareTerminal(t.id)}
                          >
                            <HugeiconsIcon
                              icon={ComputerScreenShareIcon}
                              size={13}
                              strokeWidth={1.75}
                            />
                            <span className="flex-1">
                              {translate("collab.host.menuAction")}
                            </span>
                          </ContextMenuItem>
                        ) : null}
                        <ContextMenuItem
                          className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                          onSelect={() => onDuplicate(t.id)}
                        >
                          <HugeiconsIcon
                            icon={Copy01Icon}
                            size={13}
                            strokeWidth={1.75}
                          />
                          <span className="flex-1">
                            {translate("tabs.duplicateTab")}
                          </span>
                        </ContextMenuItem>
                        <ContextMenuItem
                          className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                          onSelect={() => setEditingId(t.id)}
                        >
                          <HugeiconsIcon
                            icon={PencilEdit02Icon}
                            size={13}
                            strokeWidth={1.75}
                          />
                          <span className="flex-1">
                            {translate("tabs.renameTab")}
                          </span>
                        </ContextMenuItem>
                        {onToggleBlocks ? (
                          <ContextMenuItem
                            className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px] font-medium"
                            onSelect={() => onToggleBlocks(t.id)}
                          >
                            <HugeiconsIcon
                              icon={SparklesIcon}
                              size={13}
                              strokeWidth={1.75}
                              className={
                                t.blocks ? "text-amber-400" : "text-violet-400"
                              }
                            />
                            <span className="flex-1">
                              {t.blocks
                                ? translate("tabs.convertToNormalTerminal")
                                : translate("tabs.convertToAgenticTerminal")}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              Ctrl+U
                            </span>
                          </ContextMenuItem>
                        ) : null}
                        <ContextMenuSeparator />
                      </>
                    )}
                    {!t.locked && (
                      <ContextMenuItem
                        className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                        onSelect={() => onClose(t.id)}
                      >
                        <HugeiconsIcon
                          icon={Cancel01Icon}
                          size={13}
                          strokeWidth={1.75}
                        />
                        <span className="flex-1">
                          {translate("tabs.closeTab")}
                        </span>
                      </ContextMenuItem>
                    )}
                    <ContextMenuItem
                      className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                      disabled={!hasTabsToRight}
                      onSelect={() => onCloseTabsToRight(t.id)}
                    >
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        size={13}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1">
                        {translate("tabs.closeTabsToRight")}
                      </span>
                    </ContextMenuItem>
                    <ContextMenuItem
                      className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                      disabled={tabs.length <= 1}
                      onSelect={() => onCloseOtherTabs(t.id)}
                    >
                      <HugeiconsIcon
                        icon={CancelCircleIcon}
                        size={13}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1">
                        {translate("tabs.closeOtherTabs")}
                      </span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );

              const renderedTabNode = (
                <TabDetailsHoverCard
                  tab={t}
                  activeWorkspaceEnv={workspaceEnv}
                  side="bottom"
                  align="start"
                >
                  {tabNode}
                </TabDetailsHoverCard>
              );

              return (
                <Fragment key={t.id}>
                  {showGap(tabIndex) && <DropIndicator />}
                  {renderedTabNode}
                  {tabIndex === visibleTabs.length - 1 &&
                    showGap(visibleTabs.length) && <DropIndicator />}
                </Fragment>
              );
            })}
          </TabsList>
        </Tabs>
        {workspaceDrag.active && canExtractWorkspaceDrag(workspaceDrag.source) && (
          <span
            data-workspace-drop-kind="loose-strip"
            className="flex h-6.5 items-center rounded-md border border-dashed border-primary/50 px-2 text-[10px] text-primary/90"
          >
            {translate("spaces.extractMember")}
          </span>
        )}
        {tabs.length > 5 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={translate("tabs.allOpenTabs")}
                className="flex h-6.5 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              >
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={12}
                  strokeWidth={2}
                />
                <span className="text-[10.5px] font-mono font-medium">
                  {tabs.length}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="bottom"
              sideOffset={6}
              className="w-72 max-h-80 overflow-y-auto rounded-xl border border-border/40 bg-popover/95 p-1 backdrop-blur-xl shadow-2xl z-50"
            >
              <div className="flex items-center justify-between px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                <span>{translate("tabs.openFilesAndTerminals")}</span>
                <span className="text-[10px] text-muted-foreground/70">
                  {tabs.length}
                </span>
              </div>
              <DropdownMenuSeparator className="my-1 border-border/30" />
              {tabs.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  onSelect={() => onSelect(t.id)}
                  className={cn(
                    "group flex items-center justify-between gap-2 px-2 py-1.5 text-xs rounded-lg cursor-pointer",
                    t.id === activeId
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <TabIcon tab={t} />
                    <span className="truncate">{labelFor(t)}</span>
                  </div>
                  {tabs.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(t.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-opacity"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={12} />
                    </button>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <NewTabMenu
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
      </div>
    </div>
  );
}

function DropIndicator() {
  return (
    <span
      aria-hidden
      className="my-0.5 w-0.5 shrink-0 self-stretch rounded-full bg-primary"
    />
  );
}

function resolveTerminalTechIcon(title: string): string | null {
  const lower = title.toLowerCase().trim();
  if (
    lower.startsWith("ssh ") ||
    lower.startsWith("ssh:") ||
    lower.startsWith("ssh_") ||
    lower === "ssh" ||
    /^[a-z0-9._-]+@[a-z0-9._-]+/i.test(lower)
  ) {
    return null;
  }
  if (
    lower.startsWith("python") ||
    lower.startsWith("py ") ||
    lower === "python3"
  ) {
    return fileIconUrl("dummy.py");
  }
  if (
    lower.startsWith("node") ||
    lower.startsWith("npm") ||
    lower.startsWith("pnpm") ||
    lower.startsWith("yarn") ||
    lower.startsWith("bun") ||
    lower.startsWith("vite") ||
    lower.startsWith("next")
  ) {
    return fileIconUrl("package.json");
  }
  if (lower.startsWith("cargo") || lower.startsWith("rust")) {
    return fileIconUrl("dummy.rs");
  }
  if (lower.startsWith("docker") || lower.startsWith("compose")) {
    return fileIconUrl("Dockerfile");
  }
  if (lower.startsWith("git ") || lower === "git") {
    return fileIconUrl(".gitignore");
  }
  if (lower.startsWith("pwsh") || lower.startsWith("powershell")) {
    return fileIconUrl("dummy.ps1");
  }
  if (
    lower.startsWith("zsh") ||
    lower.startsWith("bash") ||
    lower.startsWith("fish") ||
    lower.startsWith("sh")
  ) {
    return fileIconUrl("dummy.sh");
  }
  if (lower.startsWith("go ") || lower.startsWith("golang") || lower === "go") {
    return fileIconUrl("dummy.go");
  }
  if (
    lower.startsWith("ruby") ||
    lower.startsWith("gem") ||
    lower.startsWith("rails")
  ) {
    return fileIconUrl("dummy.rb");
  }
  if (
    lower.startsWith("java") ||
    lower.startsWith("mvn") ||
    lower.startsWith("gradle")
  ) {
    return fileIconUrl("dummy.java");
  }
  if (
    lower.startsWith("clang") ||
    lower.startsWith("gcc") ||
    lower.startsWith("cpp")
  ) {
    return fileIconUrl("dummy.cpp");
  }
  return null;
}

function AgentTabAvatar({
  status,
  fallback,
  animated,
}: {
  status: TabProcessStatus;
  fallback: ReactNode;
  animated: boolean;
}) {
  if (!status.agent) return fallback;

  if (!animated) {
    return <AgentIcon agent={status.agent} size={14} className="shrink-0" />;
  }

  return (
    <AnimatedAgentIcon
      agent={status.agent}
      presence={
        terminalPresence({ state: status.state, agent: status.agent }) ?? "idle"
      }
      size={14}
      decorative
    />
  );
}

export function TabIcon({
  tab,
  animatedAgent = false,
}: {
  tab: Tab;
  animatedAgent?: boolean;
}) {
  const status = useTabProcessStatus(tab);
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const url =
      tab.kind === "editor" && tab.overrideLanguage
        ? fileIconUrl(`dummy.${tab.overrideLanguage}`)
        : fileIconUrl(tab.title);
    return url ? (
      <img
        src={url}
        alt=""
        className="size-3.5 shrink-0 object-contain"
        onError={(e) => {
          const img = e.currentTarget;
          if (img.dataset.fallback) return;
          img.dataset.fallback = "1";
          img.src = fileIconUrl("dummy.txt");
        }}
      />
    ) : null;
  }
  if (tab.kind === "preview") {
    return (
      <HugeiconsIcon
        icon={Globe02Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0 text-sky-400"
      />
    );
  }
  if (tab.kind === "ai-diff") {
    return (
      <HugeiconsIcon
        icon={SparklesIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0 text-amber-400"
      />
    );
  }
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") {
    return (
      <HugeiconsIcon
        icon={GitCompareIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0 text-violet-400"
      />
    );
  }
  if (tab.kind === "git-history") {
    return (
      <HugeiconsIcon
        icon={Clock01Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0 text-cyan-400"
      />
    );
  }
  if (tab.kind === "rdp") {
    return (
      <HugeiconsIcon
        icon={ComputerIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0 text-blue-400"
      />
    );
  }
  if (tab.kind === "api-client") {
    return (
      <HugeiconsIcon
        icon={Globe02Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0 text-emerald-400"
      />
    );
  }
  if (tab.kind === "harness") {
    return (
      <HugeiconsIcon
        icon={SparklesIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0 text-violet-400"
      />
    );
  }
  if (tab.kind === "terminal") {
    if (tab.collaboration) {
      return (
        <HugeiconsIcon
          icon={ComputerScreenShareIcon}
          size={14}
          strokeWidth={2}
          className="shrink-0 text-sky-400"
        />
      );
    }
    if (status.state === "attention") {
      return (
        <AgentTabAvatar
          status={status}
          animated={animatedAgent}
          fallback={
            <HugeiconsIcon
              icon={Message02Icon}
              size={14}
              strokeWidth={2}
              className="shrink-0 text-amber-400 animate-pulse"
            />
          }
        />
      );
    }
    if (status.state === "failed") {
      return (
        <AgentTabAvatar
          status={status}
          animated={animatedAgent}
          fallback={
            <HugeiconsIcon
              icon={CancelCircleIcon}
              size={14}
              strokeWidth={2.25}
              className="shrink-0 text-rose-400 drop-shadow-[0_0_5px_rgba(244,63,94,0.5)] animate-in fade-in zoom-in-75 duration-200"
            />
          }
        />
      );
    }
    if (status.state === "completed") {
      return (
        <AgentTabAvatar
          status={status}
          animated={animatedAgent}
          fallback={
            <HugeiconsIcon
              icon={CheckmarkCircle01Icon}
              size={14}
              strokeWidth={2.25}
              className="shrink-0 text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.5)] animate-in fade-in zoom-in-75 duration-200"
            />
          }
        />
      );
    }
    if (status.state === "running") {
      if (status.agent) {
        return (
          <AgentTabAvatar
            status={status}
            animated={animatedAgent}
            fallback={
              <AgentIcon
                agent={status.agent}
                size={14}
                className="shrink-0 animate-pulse"
              />
            }
          />
        );
      }
      return (
        <div className="relative shrink-0 flex items-center justify-center">
          <HugeiconsIcon
            icon={Loading03Icon}
            size={14}
            strokeWidth={2.25}
            className="shrink-0 text-primary animate-spin"
          />
        </div>
      );
    }
    if (status.state === "idle" && status.agent) {
      return (
        <AgentTabAvatar
          status={status}
          animated={animatedAgent}
          fallback={
            <AgentIcon agent={status.agent} size={14} className="shrink-0" />
          }
        />
      );
    }
    if (tab.private) {
      return (
        <HugeiconsIcon
          icon={IncognitoIcon}
          size={14}
          strokeWidth={2}
          className="shrink-0 text-amber-400"
        />
      );
    }
    if (tab.blocks) {
      return (
        <HugeiconsIcon
          icon={PencilEdit02Icon}
          size={14}
          strokeWidth={2}
          className="shrink-0 text-emerald-400"
        />
      );
    }
    if (
      tab.workspaceEnv?.kind === "ssh" ||
      isSshOrRemoteSession(tab)
    ) {
      return (
        <HugeiconsIcon
          icon={ServerStack01Icon}
          size={14}
          strokeWidth={2}
          className="shrink-0 text-sky-400"
        />
      );
    }
    const agentFromTitle = detectAgentFromName(tab.title);
    if (agentFromTitle) {
      return (
        <AgentIcon agent={agentFromTitle} size={14} className="shrink-0" />
      );
    }
    const techIcon = resolveTerminalTechIcon(tab.title);
    if (techIcon) {
      return (
        <img
          src={techIcon}
          alt=""
          className="size-3.5 shrink-0 object-contain"
        />
      );
    }
  }

  return (
    <HugeiconsIcon
      icon={ComputerTerminal02Icon}
      size={14}
      strokeWidth={2}
      className="shrink-0 text-muted-foreground"
    />
  );
}

export function TabProcessBadge({
  tab,
  isCollapsed,
}: {
  tab: Tab;
  isCollapsed?: boolean;
}) {
  const status = useTabProcessStatus(tab);
  if (status.state === "running" && status.progress !== null) {
    return (
      <span
        className={cn(
          "shrink-0 px-1 py-0.2 rounded text-[9.5px] font-mono font-medium leading-none bg-primary/15 text-primary border border-primary/20 animate-in fade-in duration-150",
          isCollapsed && "hidden group-hover:inline-flex",
        )}
      >
        {status.progress}%
      </span>
    );
  }
  return null;
}

export function TabProcessBottomBar({ tab }: { tab: Tab }) {
  const status = useTabProcessStatus(tab);
  if (status.state === "running") {
    return (
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden rounded-b bg-primary/15">
        <div
          className={cn(
            "h-full bg-primary transition-all duration-300 ease-out",
            status.progress === null && "w-full animate-pulse",
          )}
          style={
            status.progress !== null
              ? { width: `${status.progress}%` }
              : undefined
          }
        />
      </div>
    );
  }
  if (status.state === "completed") {
    return (
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden rounded-b bg-emerald-500/80 transition-all duration-500 animate-in fade-in shadow-[0_0_4px_rgba(52,211,153,0.5)]" />
    );
  }
  if (status.state === "failed") {
    return (
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden rounded-b bg-rose-500/80 transition-all duration-500 animate-in fade-in shadow-[0_0_4px_rgba(244,63,94,0.5)]" />
    );
  }
  return null;
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
  const { t: translate } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  // Guards against a trailing blur re-resolving an edit that Enter/Escape
  // already finished (Escape must never commit).
  const done = useRef(false);

  useEffect(() => {
    // Focus on the next frame so it runs after the context menu restores focus
    // to its trigger when closing; a synchronous focus would be stolen.
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

  // explicit = the user pressed Enter, which pins even the unchanged label. A
  // plain blur with no change must not freeze the cwd-derived default into a
  // custom title.
  const commit = (value: string, explicit: boolean) => {
    if (!explicit && value.trim() === initial.trim()) finish(onCancel);
    else finish(() => onCommit(value));
  };

  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label={translate("tooltips.renameTab")}
      data-no-drag
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        "w-28 min-w-0 rounded-sm bg-background px-1 text-xs text-foreground",
        "outline-none ring-1 ring-border focus:ring-ring",
      )}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(e.currentTarget.value, true);
        else if (e.key === "Escape") finish(onCancel);
      }}
      onBlur={(e) => {
        // Switching windows/apps blurs the input; keep the edit open instead
        // of resolving it on the way out.
        if (!document.hasFocus()) return;
        commit(e.currentTarget.value, false);
      }}
    />
  );
}
