import {
  explorerNavigationScopeKey,
  planRemoteExplorerSessionRelease,
  prepareRemoteExplorerEnv,
} from "@/app/lib/remoteExplorerEnv";
import { terminalCwdTarget } from "@/app/lib/terminalCwd";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { startIdlePreload } from "@/lib/idlePreload";
import {
  getInitialLaunchRequest,
  getLaunchBootstrap,
  type LaunchRequest,
  launchPathKey,
  launchRequestCwd,
  normalizeLaunchPaths,
} from "@/lib/launchRequest";
import { quoteShellArg } from "@/lib/shellQuote";
import { usePresence } from "@/lib/usePresence";
import { useZoom } from "@/lib/useZoom";
import { cn, isMarkdownPath } from "@/lib/utils";
import {
  type AgentLaunchRequest,
  AgentNotificationsBridge,
  findAgentLauncher,
  nextAttentionTarget,
  validateAgentLaunchCommand,
} from "@/modules/agents";
import {
  AgentRunBridge,
  AiSidebarPanel,
  LocalAgentNotificationsBridge,
  SelectionAskAi,
  useAiBootstrap,
  useAiLiveBridge,
  useChatStore,
  useSelectionAskAi,
} from "@/modules/ai";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import { native } from "@/modules/ai/lib/native";
import {
  GuestConnectDialog,
  type GuestTerminalCredentials,
  HostShareDialog,
  type HostShareTarget,
} from "@/modules/collab";
import { CommandPalette, createCommandItems } from "@/modules/command-palette";
import { useControlBridge } from "@/modules/control";
import {
  type EditorGroupHandle,
  type EditorPaneHandle,
  type IdeProblem,
  type IdeSymbol,
  NewEditorDialog,
  OutlinePanel,
  ProblemsPanel,
  useApplyEditorFontSize,
  useEditorFileSync,
} from "@/modules/editor";
import {
  createNavigationHistory,
  type EditorNavigationLocation,
  navigateHistory,
  recordNavigation,
} from "@/modules/editor/lib/navigationHistory";
import {
  loadNavigationHistory,
  saveNavigationHistory,
} from "@/modules/editor/lib/navigationHistoryStore";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import { useExtensionStore } from "@/modules/extensions";
import type { GitHistorySearchHandle } from "@/modules/git-history";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import { useTranslation } from "@/modules/i18n";
import { setLspNavigator } from "@/modules/lsp";
import type { MarkdownSearchHandle } from "@/modules/markdown";
import { OnboardingWizard } from "@/modules/onboarding";
import {
  type DevServerCapture,
  extractLocalPort,
  type PreviewPaneHandle,
  useDevServerCaptureStore,
  useWebServerStore,
} from "@/modules/preview";
import {
  QuickOpenDialog,
  quickOpenScope,
  recordQuickOpenFile,
  workspaceRelativePath,
} from "@/modules/quick-open";
import { closeRemoteWorkspace, openRemoteWorkspace } from "@/modules/remote";
import { SerialConnectModal } from "@/modules/serial";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setShowHidden, setTabStyle } from "@/modules/settings/store";
import {
  type ShortcutHandlers,
  type ShortcutId,
  shouldDisableShortcut,
  useGlobalShortcuts,
} from "@/modules/shortcuts";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SidebarRail,
  type SidebarViewId,
  useSidebarPanel,
} from "@/modules/sidebar";
import {
  SourceControlPanel,
  useRepositoryTargeting,
  useSourceControlContext,
} from "@/modules/source-control";
import {
  SpaceSwitcher,
  SpaceWorkspace,
  useSpacePersistence,
  useSpaces,
  useSpacesBoot,
  WorkspaceDragLiveRegion,
} from "@/modules/spaces";
import {
  planContextualSpaceInsertion,
} from "@/modules/spaces/lib/contextualInsertion";
import { planWorkspaceDrop } from "@/modules/spaces/lib/planWorkspaceDrop";
import { updateSpaceSplitRatio } from "@/modules/spaces/lib/spaceGeometry";
import type { SlotId } from "@/modules/spaces/lib/spaceLayout";
import {
  projectPaneBudget,
  tabAssignmentPaneBudget,
  viewSpacePaneBudget,
} from "@/modules/spaces/lib/spacePaneBudget";
import {
  activeTabIdFromStrip,
  activeTabKeyFromViewSpace,
  planTabCloseFocus,
  projectStripEntries,
} from "@/modules/spaces/lib/spaceProjection";
import type {
  WorkspaceDragSource,
  WorkspaceDropTarget,
} from "@/modules/spaces/lib/workspaceDrag";
import { type SshConnection, SshConnectionDialog } from "@/modules/ssh";
import { StatusBar } from "@/modules/statusbar";
import {
  ActiveTabsLaunchpad,
  type CloseTabsPlan,
  labelFor,
  type OpenFileTabOptions,
  type PreviewTab,
  selectLocalTerminalSpawnContext,
  type Tab,
  TabSwitcherHud,
  useTabSwitcher,
  useTabs,
  useWindowTitle,
  useWorkspaceCwd,
  VerticalTabBar,
} from "@/modules/tabs";
import { DEFAULT_SPACE_ID, NO_ACTIVE_TAB_ID } from "@/modules/tabs/lib/useTabs";
import {
  clearFocusedTerminal,
  disposeSession,
  findLeafCwd,
  getLeafTerminalStats,
  hasLeaf,
  leafIds,
  navigateFocusedBlocks,
  type PaneBounds,
  ptyIdForLeaf,
  type TerminalPaneHandle,
  useAgentActivityStore,
  useTerminalCopilotStore,
  useTerminalFileDrop,
  waitForLeafConnection,
  whenSessionReady,
  writeToSession,
} from "@/modules/terminal";
import {
  ThemeProvider,
  useThemeFileEditing,
  WindowVibrancyBridge,
} from "@/modules/theme";
import { UpdaterDialog } from "@/modules/updater";
import { WorkbenchPanel } from "@/modules/workbench";
import {
  type DockerWorkspaceConnection,
  getWslHome,
  LOCAL_WORKSPACE,
  type SerialConnectionConfig,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
  workspaceForDocumentPath,
  workspaceForNativeFs,
  workspaceScopeKey,
} from "@/modules/workspace";
import {
  WorkspaceTextEditDialog,
  type WorkspaceTextEditRequest,
} from "@/modules/workspace-edit";
import {
  type WorkspaceSearchHit,
  WorkspaceSearchPanel,
} from "@/modules/workspace-search";
import { SettingsModal } from "@/settings/SettingsModal";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SearchAddon } from "@xterm/addon-search";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import { CloseDialogs } from "./components/CloseDialogs";
import { EmptyWorkspace } from "./components/EmptyWorkspace";
import { WorkspaceInputBar } from "./components/WorkspaceInputBar";
import { useAppCloseGuard } from "./hooks/useAppCloseGuard";
import { useLaunchRequests } from "./hooks/useLaunchRequests";
import { useTabCloseGuards } from "./hooks/useTabCloseGuards";
import { useWorkspaceSwitcher } from "./hooks/useWorkspaceSwitcher";

const RIGHT_PANEL_DEFAULT_WIDTH = 280;
const RIGHT_PANEL_MIN_WIDTH = 180;
const RIGHT_PANEL_MAX_WIDTH = 800;
const RIGHT_PANEL_WIDTH_STORAGE_KEY = "voktty.rightPanel.width";

function clampRightPanelWidth(width: number): number {
  return Math.min(
    RIGHT_PANEL_MAX_WIDTH,
    Math.max(RIGHT_PANEL_MIN_WIDTH, Math.round(width)),
  );
}

function readRightPanelWidth(): number {
  try {
    const stored = window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed)
      ? clampRightPanelWidth(parsed)
      : RIGHT_PANEL_DEFAULT_WIDTH;
  } catch {
    return RIGHT_PANEL_DEFAULT_WIDTH;
  }
}

export default function App() {
  const initialLaunchRequest = getInitialLaunchRequest();
  const initialLaunchCwd = launchRequestCwd(initialLaunchRequest);
  const {
    tabs,
    activeId,
    setActiveId,
    allocId,
    booted,
    replaceTabs,
    warmTabs,
    moveTabToSpace,
    reorderTab,
    reorderTabByGap,
    newTabInSpace,
    markBooted,
    setActiveSpaceForNewTabs,
    newTab,
    newBlockTab,
    newAgentTab,
    newAgentGroupTab,
    newSshTab,
    newSerialTab,
    newGuestTerminalTab,
    newDockerTab,
    newShellTab,
    newWslTab,
    duplicateTab,
    newPrivateTab,
    openFileTab,
    newPreviewTab,
    newMarkdownTab,
    newRdpTab,
    newApiClientTab,
    setMarkdownView,
    setOverrideLanguage,
    openAiDiffTab,
    closeAiDiffTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    closeTab,
    closeTabs,
    reopenClosedEditor,
    pinTab,
    updateTab,
    setLeafCwd,
    focusPane,
    focusNextPaneInTab,
    swapActivePaneInDirection,
    splitActivePane,
    closeActivePane,
    closePaneByLeaf,
    toggleTabBlocks,
    resetWorkspace,
  } = useTabs(initialLaunchCwd ? { cwd: initialLaunchCwd } : undefined);

  // Mirror `tabs` into a ref so callbacks scheduled with `setTimeout`
  // (e.g. cdInNewTab) read the latest pane state instead of a stale closure.
  const { t } = useTranslation();
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  const activeSpaceId = useSpaces((s) => s.activeId);
  const spaces = useSpaces((s) => s.spaces);
  const viewSpaces = useSpaces((s) => s.viewSpaces);
  const stripEntries = useSpaces((s) => s.stripEntries);
  const activeStripItem = useSpaces((s) => s.activeStripItem);

  const focusedContextTabId = useMemo(() => {
    const fallbackTabKey =
      tabs.find((tab) => tab.id === activeId)?.tabKey ?? null;
    const focusedTabKey = activeTabKeyFromViewSpace(
      viewSpaces,
      activeStripItem,
      fallbackTabKey,
    );
    return tabs.find((tab) => tab.tabKey === focusedTabKey)?.id ?? activeId;
  }, [activeId, activeStripItem, tabs, viewSpaces]);

  const activeTerminalTab = useMemo(() => {
    const t = tabs.find((x) => x.id === focusedContextTabId);
    return t && t.kind === "terminal" ? t : null;
  }, [focusedContextTabId, tabs]);
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const explorerWorkspaceEnvsRef = useRef<Map<number, WorkspaceEnv>>(new Map());
  const [, setExplorerWorkspaceRevision] = useState(0);
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const markdownRefs = useRef<Map<number, MarkdownSearchHandle>>(new Map());
  const editorGroupHandleRef = useRef<EditorGroupHandle | null>(null);
  const pendingEditorNavigation = useRef<
    Map<
      number,
      {
        line?: number;
        column?: number;
        matchLength?: number;
        focus: boolean;
      }
    >
  >(new Map());
  const navigationHistoryRef = useRef(createNavigationHistory());
  const navigationActionRef = useRef<(direction: "back" | "forward") => void>(
    () => {},
  );
  const [navigationAvailability, setNavigationAvailability] = useState({
    canGoBack: false,
    canGoForward: false,
  });
  const previewRefs = useRef<Map<number, PreviewPaneHandle>>(new Map());
  const [activeEditorHandle, setActiveEditorHandle] =
    useState<EditorPaneHandle | null>(null);
  const [workspaceEditContext, setWorkspaceEditContext] = useState<{
    request: WorkspaceTextEditRequest;
    workspace: WorkspaceEnv;
  } | null>(null);
  const [gitHistoryHandle, setGitHistoryHandle] =
    useState<GitHistorySearchHandle | null>(null);
  const { zoomIn, zoomOut, zoomReset } = useZoom();
  useApplyEditorFontSize();
  const initExtensions = useExtensionStore((s) => s.init);
  useEffect(() => {
    void initExtensions();
  }, [initExtensions]);
  const terminalPathDropTarget = useTerminalFileDrop();
  const explorerRef = useRef<FileExplorerHandle>(null);

  // Drives session disposal off the pane tree, not React lifecycles —
  // split/unsplit re-mount components but the leaf is still live.
  const liveLeavesRef = useRef<Set<number>>(new Set());

  const clearWorkspaceState = useCallback(() => {
    for (const id of liveLeavesRef.current) disposeSession(id);
    const explorerTabIds = [...explorerWorkspaceEnvsRef.current.keys()];
    for (const sessionId of planRemoteExplorerSessionRelease(
      explorerWorkspaceEnvsRef.current,
      explorerTabIds,
    )) {
      void closeRemoteWorkspace(sessionId).catch(() => {});
    }
    explorerWorkspaceEnvsRef.current.clear();
    setExplorerWorkspaceRevision((revision) => revision + 1);
    searchAddons.current.clear();
    terminalRefs.current.clear();
    editorRefs.current.clear();
    pendingEditorNavigation.current.clear();
    navigationHistoryRef.current = createNavigationHistory();
    setNavigationAvailability({ canGoBack: false, canGoForward: false });
    previewRefs.current.clear();
    setActiveSearchAddon(null);
    setActiveEditorHandle(null);
  }, []);

  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const setWorkspaceEnv = useWorkspaceEnvStore((s) => s.setEnv);
  const {
    home,
    launchCwd,
    localHome,
    localLaunchCwd,
    launchCwdResolved,
    activateWorkspaceEnv,
    adoptWorkspaceEnv,
  } = useWorkspaceSwitcher({
    tabsRef,
    workspaceEnv,
    setWorkspaceEnv,
    resetWorkspace,
    clearWorkspaceState,
  });

  const spacesHydrated = useSpaces((s) => s.hydrated);
  const activeSpace = useSpaces((s) =>
    s.spaces.find((space) => space.id === activeSpaceId),
  );
  const activeSpaceIdRef = useRef(activeSpaceId);
  useLayoutEffect(() => {
    tabsRef.current = tabs;
    activeIdRef.current = activeId;
    activeSpaceIdRef.current = activeSpaceId;
  }, [tabs, activeId, activeSpaceId]);
  const sourceControlSpaceId = activeSpaceId ?? DEFAULT_SPACE_ID;

  useSpacesBoot({
    ready: launchCwdResolved,
    initialRequest: initialLaunchRequest,
    launchCwd,
    home,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
    adoptWorkspaceEnv,
  });

  const { flushAndPromoteSession } = useSpacePersistence({
    tabs,
    activeId: focusedContextTabId,
    activeSpaceId: activeSpaceId ?? DEFAULT_SPACE_ID,
    enabled: booted && spacesHydrated,
    ownerInstanceId: getLaunchBootstrap().instanceId,
  });

  const prevSpaceRef = useRef(activeSpaceId);
  const activeSpaceTabCount = tabs.filter(
    (tab) => tab.spaceId === (activeSpaceId ?? DEFAULT_SPACE_ID),
  ).length;
  useEffect(() => {
    if (!booted || !spacesHydrated || !activeSpaceId) return;
    setActiveSpaceForNewTabs(activeSpaceId);
    const prev = prevSpaceRef.current;
    prevSpaceRef.current = activeSpaceId;
    const meta = useSpaces
      .getState()
      .spaces.find((s) => s.id === activeSpaceId);
    const inSpace = tabsRef.current.filter((t) => t.spaceId === activeSpaceId);
    if (activeSpaceTabCount === 0) {
      setActiveId(NO_ACTIVE_TAB_ID);
      if (workspaceEnv.kind !== "local") {
        void activateWorkspaceEnv(LOCAL_WORKSPACE);
      }
      return;
    }
    if (prev === null || prev === activeSpaceId) return;
    if (meta) void activateWorkspaceEnv(meta.env);
    // Keep the active tab if it already belongs to the newly active space (a
    // cross-space jump set it explicitly); else fall to the space's last tab.
    if (inSpace.some((t) => t.id === activeId)) return;
    setActiveId(inSpace[inSpace.length - 1].id);
  }, [
    activeSpaceId,
    activeId,
    activeSpaceTabCount,
    booted,
    spacesHydrated,
    setActiveSpaceForNewTabs,
    setActiveId,
    activateWorkspaceEnv,
    workspaceEnv.kind,
  ]);

  const [switcherOpen, setSwitcherOpen] = useState(false);

  const spaceTabs = useMemo(
    () => tabs.filter((t) => t.spaceId === (activeSpaceId ?? DEFAULT_SPACE_ID)),
    [tabs, activeSpaceId],
  );
  const projectedStripItems = useMemo(
    () => projectStripEntries({ tabs, viewSpaces, stripEntries }),
    [tabs, viewSpaces, stripEntries],
  );
  const activeResourceTabId = activeTabIdFromStrip(
    projectedStripItems,
    activeStripItem,
    tabs.find((tab) => tab.id === focusedContextTabId)?.tabKey ?? null,
  );
  const effectiveActiveId = activeResourceTabId ?? focusedContextTabId;
  const activeViewSpace = useMemo(
    () =>
      activeStripItem?.kind === "space"
        ? (viewSpaces.find((space) => space.id === activeStripItem.spaceId) ??
          null)
        : null,
    [activeStripItem, viewSpaces],
  );
  const spaceViewLimit = usePreferencesStore((s) => s.spaceViewLimit);

  useEffect(() => {
    if (!booted || !spacesHydrated) return;
    const activeTabKey =
      tabs.find((tab) => tab.id === activeId)?.tabKey ?? null;
    useSpaces.getState().reconcileLiveTabs(
      tabs.map((tab) => tab.tabKey),
      activeTabKey,
      spaceViewLimit,
    );
  }, [activeId, booted, spaceViewLimit, spacesHydrated, tabs]);

  useEffect(() => {
    if (!booted || !activeViewSpace || activeViewSpace.presentation !== "composite") {
      return;
    }
    const memberKeys = new Set(activeViewSpace.memberOrder);
    const memberTabIds = tabs
      .filter((tab) => memberKeys.has(tab.tabKey) && tab.cold)
      .map((tab) => tab.id);
    if (memberTabIds.length > 0) {
      warmTabs(memberTabIds);
    }
  }, [activeViewSpace, booted, tabs, warmTabs]);
  const selectProjectedTabByIndex = useCallback(
    (index: number) => {
      const item = projectedStripItems[index];
      if (!item) return;
      const tabKey =
        item.kind === "space"
          ? (item.activeTabKey ?? item.tabs[0]?.tabKey)
          : item.tabKey;
      const tab = tabKey
        ? tabsRef.current.find((candidate) => candidate.tabKey === tabKey)
        : undefined;
      if (!tab) return;
      setActiveId(tab.id);
      useSpaces.getState().setActive(tab.spaceId);
      useSpaces.getState().focusVisualMember(tab.tabKey);
    },
    [projectedStripItems, setActiveId],
  );

  const {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    initialSidebarCollapsed,
    sidebarCollapsed,
    persistSidebarView,
    persistSidebarCollapsed,
    toggleSidebar,
    cycleSidebarView,
    openSidebarView,
    persistSidebarWidth,
    toggleExplorerFocus,
  } = useSidebarPanel(explorerRef);

  const tabStyle = usePreferencesStore((s) => s.tabStyle);
  const panelOpen = useChatStore((s) => s.panelOpen);

  const verticalTabsPanelRef = useRef<PanelImperativeHandle | null>(null);
  const rightPanelWidthRef = useRef(readRightPanelWidth());
  const [verticalTabsCollapsed, setVerticalTabsCollapsed] = useState(
    () => tabStyle === "horizontal" && !panelOpen,
  );
  const aiSidebarOwnsRightPanelRef = useRef(panelOpen);
  const aiSidebarPreviousCollapsedRef = useRef(tabStyle === "horizontal");

  const persistRightPanelWidth = useCallback((width: number) => {
    if (width <= 0) return;
    const clamped = clampRightPanelWidth(width);
    rightPanelWidthRef.current = clamped;
    try {
      window.localStorage.setItem(
        RIGHT_PANEL_WIDTH_STORAGE_KEY,
        String(clamped),
      );
    } catch {
      // storage may fail in private mode
    }
  }, []);

  const toggleTabStyle = useCallback(() => {
    const next = tabStyle === "horizontal" ? "vertical" : "horizontal";
    void setTabStyle(next);
    const p = verticalTabsPanelRef.current;
    if (!p) return;
    if (next === "vertical") {
      p.resize(`${rightPanelWidthRef.current}px`);
    } else if (!panelOpen) {
      p.collapse();
    }
  }, [tabStyle, panelOpen]);

  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const pendingSpaceSlotRef = useRef<{
    viewSpaceId: string;
    slotId: SlotId;
  } | null>(null);
  const pendingAdaptiveViewSpaceRef = useRef<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteMode, setCommandPaletteMode] = useState<
    "commands" | "content"
  >("commands");
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [workspaceSearchMounted, setWorkspaceSearchMounted] = useState(
    sidebarView === "search",
  );
  const [workspaceSearchFocusRequest, setWorkspaceSearchFocusRequest] =
    useState(0);
  const [activeTabsLaunchpadOpen, setActiveTabsLaunchpadOpen] = useState(false);
  const openCommandPalette = useCallback(() => {
    setCommandPaletteMode("commands");
    setCommandPaletteOpen(true);
  }, []);
  const openWorkspaceSearch = useCallback(() => {
    setWorkspaceSearchMounted(true);
    openSidebarView("search");
    setWorkspaceSearchFocusRequest((request) => request + 1);
  }, [openSidebarView]);
  const openOutline = useCallback(() => {
    openSidebarView("outline");
  }, [openSidebarView]);
  const openProblems = useCallback(() => {
    openSidebarView("problems");
  }, [openSidebarView]);
  const openRunDebug = useCallback(() => {
    openSidebarView("run-debug");
  }, [openSidebarView]);
  const handleSidebarViewSelect = useCallback(
    (view: SidebarViewId) => {
      if (view === "search") {
        setWorkspaceSearchMounted(true);
        setWorkspaceSearchFocusRequest((request) => request + 1);
      }
      persistSidebarView(view);
    },
    [persistSidebarView],
  );
  const openQuickOpen = useCallback(() => {
    setQuickOpenOpen(true);
  }, []);
  const openActiveTabsLaunchpad = useCallback(() => {
    setActiveTabsLaunchpadOpen(true);
  }, []);
  const focusInput = useChatStore((s) => s.focusInput);
  const openPanel = useChatStore((s) => s.openPanel);
  const closePanel = useChatStore((s) => s.closePanel);
  const closeMini = useChatStore((s) => s.closeMini);
  const [aiSidebarMounted, setAiSidebarMounted] = useState(panelOpen);
  const setLive = useChatStore((s) => s.setLive);
  const respondToApproval = useChatStore((s) => s.respondToApproval);

  useEffect(() => {
    startIdlePreload();
  }, []);

  useEffect(() => {
    if (panelOpen) setAiSidebarMounted(true);
  }, [panelOpen]);

  useEffect(() => {
    const panel = verticalTabsPanelRef.current;
    if (!panel) return;

    try {
      if (panelOpen) {
        if (!aiSidebarOwnsRightPanelRef.current) {
          aiSidebarPreviousCollapsedRef.current = verticalTabsCollapsed;
          aiSidebarOwnsRightPanelRef.current = true;
        }
        const currentPx = panel.getSize()?.inPixels ?? 0;
        if (currentPx <= 0) {
          panel.resize(`${rightPanelWidthRef.current}px`);
        }
        return;
      }

      if (!aiSidebarOwnsRightPanelRef.current) return;
      aiSidebarOwnsRightPanelRef.current = false;
      if (aiSidebarPreviousCollapsedRef.current) panel.collapse();
      else panel.resize(`${rightPanelWidthRef.current}px`);
    } catch {
      // Safe fallback if panel is unmounted or in transitional state
    }
  }, [panelOpen, verticalTabsCollapsed]);

  const { hasComposer, keysLoaded } = useAiBootstrap();

  useEffect(() => {
    if (!keysLoaded || hasComposer) return;
    closePanel();
    closeMini();
    setAiSidebarMounted(false);
  }, [closeMini, closePanel, hasComposer, keysLoaded]);

  const activeTab = tabs.find((t) => t.id === effectiveActiveId);
  const activeTabKey = activeTab?.tabKey ?? null;
  const activeContextViewSpace = useMemo(() => {
    if (activeViewSpace) return activeViewSpace;
    if (!activeTabKey) return null;
    return (
      viewSpaces.find(
        (space) => !space.deleted && space.memberOrder.includes(activeTabKey),
      ) ?? null
    );
  }, [activeTabKey, activeViewSpace, viewSpaces]);
  const activeTabWorkspaceEnv = useMemo(() => {
    if (activeSpaceTabCount === 0) return LOCAL_WORKSPACE;
    if (activeTab?.kind === "terminal") {
      return activeTab.workspaceEnv ?? activeSpace?.env ?? LOCAL_WORKSPACE;
    }
    if (
      activeTab &&
      "path" in activeTab &&
      typeof (activeTab as { path?: unknown }).path === "string"
    ) {
      const pathTab = activeTab as {
        path: string;
        workspaceEnv?: WorkspaceEnv;
      };
      return workspaceForDocumentPath(
        pathTab.workspaceEnv ?? activeSpace?.env,
        pathTab.path,
      );
    }
    return activeSpace?.env ?? LOCAL_WORKSPACE;
  }, [activeSpaceTabCount, activeTab, activeSpace?.env]);
  const { explorerRoot, explorerTerminalId, inheritedCwdForNewTab } =
    useWorkspaceCwd(
      activeTab,
      tabs,
      activeSpace?.root ??
        (activeSpaceTabCount === 0
          ? workspaceEnv.kind === "local"
            ? (localLaunchCwd ?? localHome ?? initialLaunchCwd ?? null)
            : null
          : (launchCwd ?? home)),
      activeSpaceId ?? DEFAULT_SPACE_ID,
    );
  const explorerTerminal =
    explorerTerminalId === null
      ? undefined
      : tabs.find((tab) => tab.id === explorerTerminalId);
  const activeExplorerWorkspaceEnv =
    (explorerTerminalId !== null
      ? explorerWorkspaceEnvsRef.current.get(explorerTerminalId)
      : undefined) ??
    (explorerTerminal?.kind === "terminal"
      ? (explorerTerminal.workspaceEnv ?? activeSpace?.env ?? LOCAL_WORKSPACE)
      : (activeSpace?.env ?? LOCAL_WORKSPACE));
  const activeWorkspaceSessionId =
    activeTab &&
    "workspaceEnv" in activeTab &&
    activeTab.workspaceEnv?.kind === "ssh"
      ? activeTab.workspaceEnv.sessionId
      : undefined;
  const activeWorkspaceTabId =
    activeTab?.kind === "terminal" ||
    activeTab?.kind === "editor" ||
    activeTab?.kind === "markdown"
      ? activeTab.id
      : null;

  useEffect(() => {
    if (!booted || !spacesHydrated || !activeSpaceId) return;
    void activateWorkspaceEnv(activeTabWorkspaceEnv)
      .then((prepared) => {
        if (
          prepared?.kind === "ssh" &&
          activeWorkspaceTabId !== null &&
          activeWorkspaceSessionId !== prepared.sessionId
        ) {
          updateTab(activeWorkspaceTabId, { workspaceEnv: prepared });
        }
      })
      .catch((error) => {
        console.error("[voktty] automatic workspace activation failed", error);
      });
  }, [
    activeWorkspaceTabId,
    activeWorkspaceSessionId,
    activeTabWorkspaceEnv,
    activateWorkspaceEnv,
    activeSpaceId,
    booted,
    spacesHydrated,
    updateTab,
  ]);
  const isTerminalTab = activeTab?.kind === "terminal";
  const isBlockTab = activeTerminalTab?.blocks === true;
  const isEditorTab = activeTab?.kind === "editor";
  const isMarkdownTab = activeTab?.kind === "markdown";
  const isGitHistoryTab = activeTab?.kind === "git-history";

  useEditorFileSync({ tabs, tabsRef, editorRefs, workspace: workspaceEnv });
  useThemeFileEditing({ tabsRef, openFileTab });

  const quickOpenRoot = explorerRoot ?? launchCwd ?? home;
  const workspaceSearchDirtyPaths = useMemo(
    () =>
      tabs.flatMap((tab) =>
        tab.kind === "editor" && tab.dirty ? [tab.path] : [],
      ),
    [tabs],
  );
  const handleWorkspaceEditRequest = useCallback(
    (request: WorkspaceTextEditRequest) => {
      setWorkspaceEditContext({ request, workspace: activeTabWorkspaceEnv });
    },
    [activeTabWorkspaceEnv],
  );
  const recentFilePath =
    activeTab?.kind === "editor" || activeTab?.kind === "markdown"
      ? activeTab.path
      : null;

  useEffect(() => {
    if (!quickOpenRoot || !recentFilePath) return;
    const relative = workspaceRelativePath(quickOpenRoot, recentFilePath);
    if (!relative) return;
    recordQuickOpenFile(
      quickOpenScope(quickOpenRoot, workspaceScopeKey(activeTabWorkspaceEnv)),
      relative,
    );
  }, [recentFilePath, activeTabWorkspaceEnv, quickOpenRoot]);

  useWindowTitle(activeTab, explorerRoot, activeContextViewSpace?.name);

  useEffect(() => {
    setActiveSearchAddon(
      activeLeafId !== null
        ? (searchAddons.current.get(activeLeafId) ?? null)
        : null,
    );
    setActiveEditorHandle(editorRefs.current.get(effectiveActiveId) ?? null);
  }, [effectiveActiveId, activeLeafId]);

  const handleSearchReady = useCallback(
    (leafId: number, addon: SearchAddon) => {
      searchAddons.current.set(leafId, addon);
      if (leafId === activeLeafId) setActiveSearchAddon(addon);
    },
    [activeLeafId],
  );

  const disposeTab = useCallback(
    (id: number) => {
      const closingTab = tabsRef.current.find((t) => t.id === id);
      if (!closingTab || closingTab.locked) return;
      const focusPlan = planTabCloseFocus(
        projectedStripItems,
        tabsRef.current,
        id,
        effectiveActiveId,
      );
      const explorerEnv = explorerWorkspaceEnvsRef.current.get(id);
      if (explorerEnv) {
        const sessionsToClose = planRemoteExplorerSessionRelease(
          explorerWorkspaceEnvsRef.current,
          [id],
        );
        explorerWorkspaceEnvsRef.current.delete(id);
        setExplorerWorkspaceRevision((revision) => revision + 1);
        for (const sessionId of sessionsToClose) {
          void closeRemoteWorkspace(sessionId).catch(() => {});
        }
      }
      if (closingTab && closingTab.kind === "preview" && closingTab.url) {
        const port = extractLocalPort(closingTab.url);
        if (port) {
          const remainingWithSamePort = tabsRef.current.filter(
            (t) =>
              t.id !== id &&
              t.kind === "preview" &&
              t.url &&
              extractLocalPort(t.url) === port,
          );
          if (remainingWithSamePort.length === 0) {
            void useWebServerStore.getState().stopServerByUrl(closingTab.url);
          }
        }
      }

      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      closeTab(
        id,
        focusPlan.activeWasClosed ? focusPlan.nextActiveId : undefined,
      );
      if (
        focusPlan.activeWasClosed &&
        focusPlan.nextSpaceId &&
        focusPlan.nextTabKey
      ) {
        const spaces = useSpaces.getState();
        spaces.setActive(focusPlan.nextSpaceId);
        spaces.focusVisualMember(focusPlan.nextTabKey);
      }
    },
    [closeTab, effectiveActiveId, projectedStripItems],
  );

  const disposeTabs = useCallback(
    (anchorId: number, plan: CloseTabsPlan) => {
      const closedTabs = tabsRef.current.filter((t) =>
        plan.closeIds.includes(t.id),
      );
      const closedTabIds = closedTabs.map((tab) => tab.id);
      const explorerSessionsToClose = planRemoteExplorerSessionRelease(
        explorerWorkspaceEnvsRef.current,
        closedTabIds,
      );
      let removedExplorerWorkspace = false;
      for (const tab of closedTabs) {
        const explorerEnv = explorerWorkspaceEnvsRef.current.get(tab.id);
        if (explorerEnv) {
          explorerWorkspaceEnvsRef.current.delete(tab.id);
          removedExplorerWorkspace = true;
        }
        if (tab.kind === "preview" && tab.url) {
          const port = extractLocalPort(tab.url);
          if (port) {
            const remainingWithSamePort = tabsRef.current.filter(
              (t) =>
                !plan.closeIds.includes(t.id) &&
                t.kind === "preview" &&
                t.url &&
                extractLocalPort(t.url) === port,
            );
            if (remainingWithSamePort.length === 0) {
              void useWebServerStore.getState().stopServerByUrl(tab.url);
            }
          }
        }
      }

      for (const sessionId of explorerSessionsToClose) {
        void closeRemoteWorkspace(sessionId).catch(() => {});
      }

      const closedIds = closeTabs(anchorId, plan);
      if (removedExplorerWorkspace) {
        setExplorerWorkspaceRevision((revision) => revision + 1);
      }
      for (const id of closedIds) {
        editorRefs.current.delete(id);
        previewRefs.current.delete(id);
      }
    },
    [closeTabs],
  );

  const {
    pendingCloseTab,
    pendingTerminalCloseTab,
    pendingDeleteTabs,
    pendingCloseMany,
    closeManyConfirming,
    handleClose,
    handleCloseTabsToRight,
    handleCloseOtherTabs,
    confirmClose,
    cancelClose,
    confirmTerminalClose,
    cancelTerminalClose,
    confirmDeleteClose,
    cancelDeleteClose,
    confirmCloseMany,
    cancelCloseMany,
    handlePathDeleted,
  } = useTabCloseGuards({
    tabs,
    activeId: effectiveActiveId,
    disposeTab,
    disposeTabs,
  });

  const { pendingAppClose, confirmAppClose, cancelAppClose } = useAppCloseGuard(
    tabsRef,
    flushAndPromoteSession,
  );

  useEffect(() => {
    const live = new Set<number>();
    for (const t of tabs) {
      if (t.kind === "terminal") {
        for (const id of leafIds(t.paneTree)) live.add(id);
      }
    }
    for (const id of liveLeavesRef.current) {
      if (!live.has(id)) disposeSession(id);
    }
    liveLeavesRef.current = live;
    for (const k of [...terminalRefs.current.keys()])
      if (!live.has(k)) terminalRefs.current.delete(k);
    for (const k of [...searchAddons.current.keys()])
      if (!live.has(k)) searchAddons.current.delete(k);
  }, [tabs]);

  useEffect(() => {
    const tab = tabsRef.current.find((t) => t.id === effectiveActiveId);
    if (tab?.kind !== "terminal") return;
    const ptyIds = leafIds(tab.paneTree).flatMap((leafId) => {
      const ptyId = ptyIdForLeaf(leafId);
      return ptyId === null ? [] : [ptyId];
    });
    useAgentActivityStore.getState().acknowledgeAttention(ptyIds);
  }, [effectiveActiveId]);

  // Most-recently-used tab ids, most recent first, pruned to live tabs. Drives
  // the Ctrl+Tab quick switcher so it cycles by recency, not strip order.
  const mruRef = useRef<number[]>([effectiveActiveId]);
  useEffect(() => {
    activeIdRef.current = effectiveActiveId;
    mruRef.current = [
      effectiveActiveId,
      ...mruRef.current.filter((id) => id !== effectiveActiveId),
    ];
  }, [effectiveActiveId]);
  useEffect(() => {
    const live = new Set(tabs.map((t) => t.id));
    mruRef.current = mruRef.current.filter((id) => live.has(id));
  }, [tabs]);

  const getSwitcherOrder = useCallback(() => {
    const currentTabs = tabsRef.current;
    const state = useSpaces.getState();
    const visualItems = projectStripEntries({
      tabs: currentTabs,
      viewSpaces: state.viewSpaces,
      stripEntries: state.stripEntries,
    });
    const visualIds = visualItems.flatMap((item) => {
      const tabKey =
        item.kind === "space"
          ? (item.activeTabKey ?? item.tabs[0]?.tabKey)
          : item.tabKey;
      const tab = tabKey
        ? currentTabs.find((candidate) => candidate.tabKey === tabKey)
        : undefined;
      return tab ? [tab.id] : [];
    });
    const present = new Set(visualIds);
    const ordered = mruRef.current.filter((id) => present.has(id));
    for (const id of visualIds) if (!ordered.includes(id)) ordered.push(id);
    return [
      activeIdRef.current,
      ...ordered.filter((id) => id !== activeIdRef.current),
    ];
  }, []);

  const { state: switcherState, step: stepSwitcher } = useTabSwitcher({
    getOrder: getSwitcherOrder,
    onCommit: (id) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === id);
      if (!tab) return;
      setActiveId(id);
      useSpaces.getState().setActive(tab.spaceId);
      useSpaces.getState().focusVisualMember(tab.tabKey);
    },
  });

  const cycleSpace = useCallback((delta: 1 | -1) => {
    const { spaces, activeId: sid, setActive } = useSpaces.getState();
    if (spaces.length < 2) return;
    const idx = spaces.findIndex((s) => s.id === sid);
    const next = (idx + delta + spaces.length) % spaces.length;
    setActive(spaces[next].id);
  }, []);

  const captureActiveSelection = useCallback((): string | null => {
    const t = tabs.find((x) => x.id === effectiveActiveId);
    if (!t) return null;
    if (t.kind === "terminal") {
      const lid = t.activeLeafId;
      return terminalRefs.current.get(lid)?.getSelection() ?? null;
    }
    if (t.kind === "editor") {
      return editorRefs.current.get(effectiveActiveId)?.getSelection() ?? null;
    }
    return null;
  }, [tabs, effectiveActiveId]);

  const togglePanelAndFocus = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    if (panelOpen) {
      closePanel();
    } else {
      openPanel();
      focusInput(null);
    }
  }, [closePanel, hasComposer, panelOpen, openPanel, focusInput]);

  const attachSelection = useChatStore((s) => s.attachSelection);

  const handleAttachFileToAgent = useCallback(
    (path: string) => {
      if (!hasComposer) {
        void openSettingsWindow("models");
        return;
      }
      // Dispatch a window event the composer listens for. Same pattern as
      // selections — keeps file-explorer decoupled from the AI module.
      window.dispatchEvent(
        new CustomEvent<string>("voktty:ai-attach-file", { detail: path }),
      );
      openPanel();
      focusInput(null);
    },
    [hasComposer, openPanel, focusInput],
  );

  const askFromSelection = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    const selection = captureActiveSelection();
    if (!selection || !selection.trim()) {
      focusInput(null);
      return;
    }
    const source: "terminal" | "editor" =
      activeTab?.kind === "editor" ? "editor" : "terminal";
    attachSelection(selection, source);
    openPanel();
    focusInput(null);
  }, [
    hasComposer,
    captureActiveSelection,
    focusInput,
    attachSelection,
    activeTab,
    openPanel,
  ]);

  const editFromSelection = useCallback(() => {
    if (activeTab?.kind !== "editor") return;
    editorRefs.current.get(effectiveActiveId)?.triggerInlineAi();
  }, [effectiveActiveId, activeTab]);

  const { askPopup, setAskPopup, onAskFromSelection } = useSelectionAskAi({
    captureActiveSelection,
    askFromSelection,
  });
  const askPresence = usePresence(Boolean(askPopup), 120);

  const contextualInsertionTarget = useCallback(
    (terminalLeaves = 0): string | null => {
      const state = useSpaces.getState();
      const plan = planContextualSpaceInsertion(
        state.viewSpaces,
        state.activeStripItem,
      );
      if (plan.kind === "standalone") return null;
      const viewSpace = state.viewSpaces.find(
        (candidate) => candidate.id === plan.viewSpaceId,
      );
      if (!viewSpace) return null;
      const current = viewSpacePaneBudget(
        tabsRef.current,
        viewSpace.memberOrder,
      );
      if (
        terminalLeaves > 0 &&
        !projectPaneBudget(current.current, terminalLeaves, current.max).allowed
      ) {
        return null;
      }
      return plan.viewSpaceId;
    },
    [],
  );

  const appendCreatedTabToViewSpace = useCallback(
    (viewSpaceId: string, tabId: number) => {
      window.setTimeout(() => {
        const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
        if (!tab) return;
        const state = useSpaces.getState();
        const viewSpace = state.viewSpaces.find(
          (candidate) => candidate.id === viewSpaceId,
        );
        if (!viewSpace) return;
        if (
          !tabAssignmentPaneBudget(
            tabsRef.current,
            viewSpace.memberOrder,
            tab.tabKey,
          ).allowed
        ) {
          toast.error(t("spaces.rendererCapacity"));
          return;
        }
        if (!state.addMemberToViewSpace(viewSpaceId, tab.tabKey, spaceViewLimit)) {
          toast.error(t("spaces.maxSlots"));
          return;
        }
        state.openViewSpace(viewSpaceId);
        state.setActive(tab.spaceId);
        state.focusVisualMember(tab.tabKey);
        setActiveSpaceForNewTabs(tab.spaceId);
        setActiveId(tab.id);
      }, 0);
    },
    [setActiveId, setActiveSpaceForNewTabs, t],
  );

  const openNewTab = useCallback(() => {
    const target = contextualInsertionTarget(1);
    setWorkspaceEnv(LOCAL_WORKSPACE);
    const id = newTab(localHome ?? undefined, LOCAL_WORKSPACE);
    if (target) appendCreatedTabToViewSpace(target, id);
  }, [
    appendCreatedTabToViewSpace,
    contextualInsertionTarget,
    localHome,
    newTab,
    setWorkspaceEnv,
  ]);

  const openNewPrivateTab = useCallback(() => {
    const target = contextualInsertionTarget(1);
    setWorkspaceEnv(LOCAL_WORKSPACE);
    const id = newPrivateTab(localHome ?? undefined, LOCAL_WORKSPACE);
    if (target) appendCreatedTabToViewSpace(target, id);
  }, [
    appendCreatedTabToViewSpace,
    contextualInsertionTarget,
    localHome,
    newPrivateTab,
    setWorkspaceEnv,
  ]);

  const openNewBlockTab = useCallback(() => {
    const target = contextualInsertionTarget(1);
    setWorkspaceEnv(LOCAL_WORKSPACE);
    const id = newBlockTab(localHome ?? undefined, LOCAL_WORKSPACE);
    if (target) appendCreatedTabToViewSpace(target, id);
  }, [
    appendCreatedTabToViewSpace,
    contextualInsertionTarget,
    localHome,
    newBlockTab,
    setWorkspaceEnv,
  ]);

  const openNewShellTab = useCallback(
    (shellPath: string, name: string) => {
      const target = contextualInsertionTarget(1);
      setWorkspaceEnv(LOCAL_WORKSPACE);
      const id = newShellTab(shellPath, name, localHome ?? undefined);
      if (target) appendCreatedTabToViewSpace(target, id);
    },
    [
      appendCreatedTabToViewSpace,
      contextualInsertionTarget,
      localHome,
      newShellTab,
      setWorkspaceEnv,
    ],
  );

  const openNewWslTab = useCallback(
    (distro: string) => {
      const target = contextualInsertionTarget(1);
      const opened = newWslTab(distro);
      if (target) appendCreatedTabToViewSpace(target, opened.tabId);
    },
    [appendCreatedTabToViewSpace, contextualInsertionTarget, newWslTab],
  );

  const openNewEditor = useCallback(() => {
    const target = contextualInsertionTarget();
    pendingSpaceSlotRef.current = null;
    pendingAdaptiveViewSpaceRef.current = target;
    setNewEditorOpen(true);
  }, [contextualInsertionTarget]);

  const [newSshDialogOpen, setNewSshDialogOpen] = useState(false);
  const [serialDialogOpen, setSerialDialogOpen] = useState(false);
  const [guestConnectOpen, setGuestConnectOpen] = useState(false);
  const [hostShareOpen, setHostShareOpen] = useState(false);
  const [hostShareTarget, setHostShareTarget] =
    useState<HostShareTarget | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const hasCompletedOnboarding = usePreferencesStore(
    (s) => s.hasCompletedOnboarding,
  );

  useEffect(() => {
    if (prefsHydrated && !hasCompletedOnboarding) {
      setOnboardingOpen(true);
    }
  }, [prefsHydrated, hasCompletedOnboarding]);

  useEffect(() => {
    const handler = () => setOnboardingOpen(true);
    window.addEventListener("voktty:open-onboarding", handler);
    let unlistenTauri: (() => void) | undefined;
    void listen("voktty://open-onboarding", handler).then((u) => {
      unlistenTauri = u;
    });
    return () => {
      window.removeEventListener("voktty:open-onboarding", handler);
      unlistenTauri?.();
    };
  }, []);

  const handleConnectSsh = useCallback(
    async (conn: SshConnection) => {
      const toastId = `ssh-${conn.id}`;
      const targetLabel =
        conn.name || `${conn.user ? `${conn.user}@` : ""}${conn.host}`;
      toast.loading(t("ssh.connecting", { name: targetLabel }), {
        id: toastId,
      });
      const envCandidate: Extract<WorkspaceEnv, { kind: "ssh" }> = {
        kind: "ssh",
        connection: conn,
        root: conn.initialDirectory?.trim() || ".",
      };
      try {
        const connected = await activateWorkspaceEnv(envCandidate);
        if (connected?.kind !== "ssh") {
          throw new Error(t("feedback.remoteSessionFailed"));
        }
        if (activeSpaceId)
          useSpaces.getState().setEnv(activeSpaceId, connected);
        const opened = newSshTab(connected.root, targetLabel, connected);
        await waitForLeafConnection(opened.leafId);
        useWorkspaceEnvStore.getState().clearConnection(envCandidate);
        toast.success(t("ssh.connected", { name: targetLabel }), {
          id: toastId,
          description: `${conn.user ? `${conn.user}@` : ""}${conn.host}:${conn.port ?? 22}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        useWorkspaceEnvStore
          .getState()
          .failConnection(envCandidate, targetLabel, message);
        toast.error(t("ssh.connectionFailed", { name: targetLabel }), {
          id: toastId,
          description: message,
        });
      }
    },
    [activateWorkspaceEnv, activeSpaceId, newSshTab, t],
  );

  const handleConnectDocker = useCallback(
    async (conn: DockerWorkspaceConnection) => {
      const toastId = `docker-${conn.containerId}`;
      const targetLabel = conn.containerName || conn.containerId.slice(0, 12);
      toast.loading(t("docker.connecting", { name: targetLabel }), {
        id: toastId,
      });
      try {
        const opened = newDockerTab(conn);
        await waitForLeafConnection(opened.leafId);
        toast.success(t("docker.connected", { name: targetLabel }), {
          id: toastId,
          description: conn.image,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(t("docker.connectionFailed", { name: targetLabel }), {
          id: toastId,
          description: message,
        });
      }
    },
    [newDockerTab, t],
  );

  const handleConnectSerial = useCallback(
    async (config: SerialConnectionConfig) => {
      const toastId = `serial-${config.portName}`;
      toast.loading(t("serial.connecting", { port: config.portName }), {
        id: toastId,
      });
      try {
        const opened = newSerialTab(config);
        await waitForLeafConnection(opened.leafId);
        toast.success(t("serial.connected", { port: config.portName }), {
          id: toastId,
          description: `${config.baudRate} baud · ${config.dataBits ?? 8}${config.parity ? config.parity[0].toUpperCase() : "N"}${config.stopBits ?? 1}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(
          t("feedback.serialConnectionFailed", { port: config.portName }),
          { id: toastId, description: message },
        );
      }
    },
    [newSerialTab, t],
  );

  const handleConnectGuest = useCallback(
    (credentials: GuestTerminalCredentials) => {
      newGuestTerminalTab(credentials, t("collab.guest.tabTitle"));
    },
    [newGuestTerminalTab, t],
  );

  const handleWorkspaceChange = useCallback(
    async (env: WorkspaceEnv) => {
      if (env.kind === "wsl") {
        const toastId = `wsl-${env.distro}`;
        const targetLabel = `WSL: ${env.distro}`;
        toast.loading(
          t("terminal.connection.connecting", { name: targetLabel }),
          { id: toastId },
        );
        useWorkspaceEnvStore.getState().beginConnection(env, targetLabel);
        try {
          if (activeSpaceId) {
            useSpaces.getState().setEnv(activeSpaceId, env);
          }
          setWorkspaceEnv(env);
          const wslHome = await getWslHome(env.distro).catch(() => undefined);
          const opened = newWslTab(env.distro, wslHome);
          const target = contextualInsertionTarget(1);
          if (target) appendCreatedTabToViewSpace(target, opened.tabId);
          await waitForLeafConnection(opened.leafId);
          useWorkspaceEnvStore.getState().clearConnection(env);
          toast.success(
            t("terminal.connection.connected", { name: targetLabel }),
            {
              id: toastId,
              description: env.distro,
            },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          useWorkspaceEnvStore
            .getState()
            .failConnection(env, targetLabel, message);
          toast.error(
            t("terminal.connection.connectionFailed", { name: targetLabel }),
            {
              id: toastId,
              description: message,
            },
          );
        }
        return;
      }

      if (env.kind === "ssh") {
        await handleConnectSsh(env.connection);
        return;
      }

      if (env.kind === "docker") {
        await handleConnectDocker(env.connection);
        return;
      }

      // Local workspace
      if (activeSpaceId) {
        useSpaces.getState().setEnv(activeSpaceId, LOCAL_WORKSPACE);
      }
      setWorkspaceEnv(LOCAL_WORKSPACE);
      const target = contextualInsertionTarget(1);
      const tabId = openNewTab();
      if (target && tabId !== undefined) {
        appendCreatedTabToViewSpace(target, tabId);
      }
    },
    [
      activeSpaceId,
      appendCreatedTabToViewSpace,
      contextualInsertionTarget,
      handleConnectDocker,
      handleConnectSsh,
      newWslTab,
      openNewTab,
      setWorkspaceEnv,
      t,
    ],
  );

  const handleShareTerminal = useCallback(
    (tabId: number) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
      if (tab?.kind !== "terminal" || tab.collaboration) return;
      const ptyId = ptyIdForLeaf(tab.activeLeafId);
      const stats = getLeafTerminalStats(tab.activeLeafId);
      if (ptyId === null || !stats) {
        toast.error(t("collab.host.terminalNotReady"));
        return;
      }
      setHostShareTarget({
        leafId: tab.activeLeafId,
        ptyId,
        cols: stats.cols,
        rows: stats.rows,
        title: tab.customTitle || tab.title,
        workspaceRoot:
          (tab.workspaceEnv?.kind ?? "local") === "local"
            ? (explorerRoot ?? tab.cwd ?? null)
            : null,
      });
      setHostShareOpen(true);
    },
    [explorerRoot, t],
  );

  const launchAgentGroup = useCallback(
    (request: AgentLaunchRequest) => {
      const command = validateAgentLaunchCommand(request.command);
      if (!command.ok) return;
      const launcher = findAgentLauncher(request.agent);
      const title =
        request.instances === 1
          ? launcher.label
          : `${launcher.label} × ${request.instances}`;
      const { leafIds: agentLeafIds } = newAgentGroupTab(
        localLaunchCwd ?? localHome ?? initialLaunchCwd ?? undefined,
        title,
        request.instances,
        LOCAL_WORKSPACE,
      );
      const hooksReady = launcher.supportsHooks
        ? invoke("agent_enable_hooks", {
            agent: request.agent,
          }).catch((error) => {
            console.warn(
              `[voktty] could not enable ${request.agent} notifications:`,
              error,
            );
          })
        : Promise.resolve();

      for (const leafId of agentLeafIds) {
        void (async () => {
          await Promise.all([whenSessionReady(leafId), hooksReady]);
          if (!writeToSession(leafId, `${command.command}\r`)) {
            console.error(
              `[voktty] agent terminal ${leafId} closed before launch`,
            );
          }
        })();
      }
    },
    [initialLaunchCwd, localHome, localLaunchCwd, newAgentGroupTab],
  );

  const sendCd = useCallback(
    (path: string) => {
      if (activeLeafId === null) return;
      const term = terminalRefs.current.get(activeLeafId);
      if (!term) return;
      term.write(`cd ${quoteShellArg(path)}\r`);
      term.focus();
    },
    [activeLeafId],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      setWorkspaceEnv(LOCAL_WORKSPACE);
      const tabId = newTab(path, LOCAL_WORKSPACE);
      setTimeout(() => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (!tab || tab.kind !== "terminal") return;
        const t = terminalRefs.current.get(tab.activeLeafId);
        if (!t) return;
        t.write(`cd ${quoteShellArg(path)}\r`);
        t.focus();
      }, 80);
    },
    [newTab, setWorkspaceEnv],
  );

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean, options?: OpenFileTabOptions) => {
      return isMarkdownPath(path)
        ? newMarkdownTab(path, options)
        : openFileTab(path, pin ?? true, options);
    },
    [openFileTab, newMarkdownTab],
  );

  const openLaunchFile = useCallback(
    (path: string) => {
      const key = launchPathKey(path);
      const existing = tabsRef.current.find(
        (tab) =>
          (tab.kind === "editor" || tab.kind === "markdown") &&
          launchPathKey(tab.path) === key,
      );
      if (existing) {
        if (existing.kind === "editor" && existing.preview) pinTab(existing.id);
        if (useSpaces.getState().activeId !== existing.spaceId) {
          useSpaces.getState().setActive(existing.spaceId);
        }
        useSpaces.getState().focusVisualMember(existing.tabKey);
        setActiveId(existing.id);
        return existing.id;
      }
      const id = handleOpenFile(path, true);
      const created = tabsRef.current.find((tab) => tab.id === id);
      if (created) useSpaces.getState().ensureStandaloneTab(created.tabKey);
      return id;
    },
    [handleOpenFile, pinTab, setActiveId],
  );

  const openLaunchFiles = useCallback(
    (paths: readonly string[]) => {
      for (const path of normalizeLaunchPaths(paths)) openLaunchFile(path);
    },
    [openLaunchFile],
  );

  const applyLaunchRequest = useCallback(
    (request: LaunchRequest) => {
      switch (request.intent) {
        case "restoreLastSession":
          return;
        case "openFilesOnly":
        case "openFilesInCurrentSession":
          openLaunchFiles(request.paths);
          return;
        case "openDirectoryOnly":
          if (request.source === "coldStart") return;
          newTab(normalizeLaunchPaths(request.paths)[0], LOCAL_WORKSPACE);
          return;
        case "openDirectoryInCurrentSession":
          newTab(normalizeLaunchPaths(request.paths)[0], LOCAL_WORKSPACE);
          return;
        case "newStandaloneTab":
          newTab(undefined, LOCAL_WORKSPACE);
          return;
      }
    },
    [newTab, openLaunchFiles],
  );

  const handleDroppedPath = useCallback(
    async (path: string) => {
      try {
        const pathWorkspace = workspaceForDocumentPath(workspaceEnv, path);
        const stat = await invoke<{ kind: "file" | "dir" | "symlink" }>(
          "fs_stat",
          {
            path,
            workspace: workspaceForNativeFs(pathWorkspace, path),
          },
        ).catch(() => null);

        const isDir = stat ? stat.kind === "dir" : false;

        if (isDir) {
          const spaceId = activeSpaceId ?? DEFAULT_SPACE_ID;
          useSpaces.getState().setRoot(spaceId, path);
          useSpaces.getState().setEnv(spaceId, pathWorkspace);
          setWorkspaceEnv(pathWorkspace);
          const currentSpaceTabs = tabsRef.current.filter(
            (t) => t.spaceId === spaceId,
          );
          if (currentSpaceTabs.length === 0) {
            newTab(path, pathWorkspace);
          }
        } else {
          handleOpenFile(path, true, { workspaceEnv: pathWorkspace });
        }
      } catch (e) {
        console.error("Failed to handle dropped path:", e);
        handleOpenFile(path, true, {
          workspaceEnv: workspaceForDocumentPath(workspaceEnv, path),
        });
      }
    },
    [workspaceEnv, activeSpaceId, setWorkspaceEnv, newTab, handleOpenFile],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<string>;
      if (custom.detail) {
        void handleDroppedPath(custom.detail);
      }
    };
    window.addEventListener("voktty:open-dropped-path", handler);
    return () =>
      window.removeEventListener("voktty:open-dropped-path", handler);
  }, [handleDroppedPath]);

  const pickAndOpenFile = useCallback(async () => {
    const target = contextualInsertionTarget();
    try {
      const activeEditorWorkspace =
        activeTab?.kind === "editor"
          ? workspaceForDocumentPath(
              activeTab.workspaceEnv ?? activeSpace?.env,
              activeTab.path,
            )
          : null;
      const activeTerminalWorkspace =
        activeTab?.kind === "terminal"
          ? (activeTab.workspaceEnv ?? activeSpace?.env ?? LOCAL_WORKSPACE)
          : null;
      const defaultDir =
        activeTab?.kind === "terminal" &&
        activeTab.cwd &&
        activeTerminalWorkspace?.kind === "local"
          ? activeTab.cwd
          : activeTab?.kind === "editor" &&
              activeTab.path &&
              activeEditorWorkspace?.kind === "local"
            ? activeTab.path.replace(/[\\/][^\\/]+$/, "")
            : activeSpace?.env.kind === "local" && activeSpace.root
              ? activeSpace.root
              : localLaunchCwd || localHome || undefined;

      const picked = await invoke<string | null>("fs_pick_file", {
        defaultPath: defaultDir,
      });
      if (picked) {
        const id = handleOpenFile(picked, true, {
          workspaceEnv: LOCAL_WORKSPACE,
        });
        if (target) appendCreatedTabToViewSpace(target, id);
      }
    } catch (e) {
      console.error("Failed to pick file:", e);
    }
  }, [
    activeTab,
    activeSpace?.env,
    activeSpace?.root,
    appendCreatedTabToViewSpace,
    contextualInsertionTarget,
    localLaunchCwd,
    localHome,
    handleOpenFile,
  ]);

  const pickAndOpenFolder = useCallback(async () => {
    try {
      const defaultDir =
        activeTab?.kind === "terminal" && activeTab.cwd
          ? activeTab.cwd
          : activeTab?.kind === "editor" && activeTab.path
            ? activeTab.path.replace(/[\\/][^\\/]+$/, "")
            : activeSpace?.root || localLaunchCwd || localHome || undefined;

      const picked = await invoke<string | null>("fs_pick_folder", {
        defaultPath: defaultDir,
      });
      if (picked) {
        const spaceId = activeSpaceId ?? DEFAULT_SPACE_ID;
        useSpaces.getState().setRoot(spaceId, picked);
        const isLocal = /^[a-zA-Z]:[/\\]|^\\\\/.test(picked);
        if (isLocal) {
          useSpaces.getState().setEnv(spaceId, LOCAL_WORKSPACE);
          setWorkspaceEnv(LOCAL_WORKSPACE);
        }
      }
    } catch (e) {
      console.error("Failed to pick folder:", e);
    }
  }, [
    activeTab,
    activeSpace?.root,
    localLaunchCwd,
    localHome,
    activeSpaceId,
    setWorkspaceEnv,
  ]);

  useLaunchRequests({
    ready: booted && spacesHydrated,
    onRequest: applyLaunchRequest,
  });

  // System tray integration events
  useEffect(() => {
    let unlistenTerminal: (() => void) | undefined;
    let unlistenPreview: (() => void) | undefined;
    let disposed = false;

    (async () => {
      const offTerm = await listen("tray-new-terminal", () => {
        openNewTab();
      });
      const offPrev = await listen("tray-new-preview", () => {
        newPreviewTab("");
      });

      if (disposed) {
        offTerm();
        offPrev();
      } else {
        unlistenTerminal = offTerm;
        unlistenPreview = offPrev;
      }
    })();

    return () => {
      disposed = true;
      unlistenTerminal?.();
      unlistenPreview?.();
    };
  }, [newPreviewTab, openNewTab]);

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path === from) {
          const i = to.lastIndexOf("/");
          updateTab(t.id, { path: to, title: i === -1 ? to : to.slice(i + 1) });
        } else if (t.path.startsWith(`${from}/`)) {
          const suffix = t.path.slice(from.length);
          const newPath = `${to}${suffix}`;
          const i = newPath.lastIndexOf("/");
          updateTab(t.id, {
            path: newPath,
            title: i === -1 ? newPath : newPath.slice(i + 1),
          });
        }
      }
    },
    [tabs, updateTab],
  );

  const activeTerminalLeafCwd =
    activeTab?.kind === "terminal"
      ? (findLeafCwd(activeTab.paneTree, activeTab.activeLeafId) ??
        activeTab.cwd ??
        null)
      : null;

  const activeFilePath = (() => {
    if (activeTab?.kind === "editor") return activeTab.path;
    if (activeTab?.kind === "git-diff") {
      if (/^([A-Za-z]:|\/|\\)/.test(activeTab.path)) return activeTab.path;
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    if (activeTab?.kind === "git-commit-file") {
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    return null;
  })();
  const explorerActiveFilePath =
    activeTab?.kind === "editor" || activeTab?.kind === "markdown"
      ? activeTab.path
      : null;
  const isRepositoryContextCurrent = useCallback(
    (spaceId: string, workspaceKey: string) => {
      const currentSpaceId = useSpaces.getState().activeId ?? DEFAULT_SPACE_ID;
      const currentWorkspaceKey = workspaceScopeKey(
        useWorkspaceEnvStore.getState().env,
      );
      return spaceId === currentSpaceId && workspaceKey === currentWorkspaceKey;
    },
    [],
  );
  const openSourceControl = useCallback(() => {
    openSidebarView("source-control");
  }, [openSidebarView]);
  const toggleHiddenFiles = useCallback(() => {
    openSidebarView("explorer");
    void setShowHidden(!usePreferencesStore.getState().showHidden);
  }, [openSidebarView]);
  const revealActiveFileInExplorer = useCallback(() => {
    if (activeTab?.kind !== "editor" && activeTab?.kind !== "markdown") return;
    const path = activeTab.path;
    const documentWorkspace = workspaceForDocumentPath(
      activeTab.workspaceEnv ?? activeSpace?.env,
      path,
    );
    openSidebarView("explorer");

    const offerContainingFolder = () => {
      toast.info(t("explorer.fileOutsideWorkspace"), {
        action: {
          label: t("explorer.openContainingFolder"),
          onClick: () => {
            const parent = path.replace(/[\\/][^\\/]+$/, "") || path;
            const spaceId = activeSpaceId ?? DEFAULT_SPACE_ID;
            useSpaces.getState().setRoot(spaceId, parent);
            useSpaces.getState().setEnv(spaceId, documentWorkspace);
            setWorkspaceEnv(documentWorkspace);
          },
        },
      });
    };

    if (
      workspaceScopeKey(documentWorkspace) !==
      workspaceScopeKey(activeExplorerWorkspaceEnv)
    ) {
      offerContainingFolder();
      return;
    }
    requestAnimationFrame(() => {
      void explorerRef.current?.reveal(path).then((revealed) => {
        if (!revealed) offerContainingFolder();
      });
    });
  }, [
    activeTab,
    activeSpace?.env,
    activeSpaceId,
    activeExplorerWorkspaceEnv,
    openSidebarView,
    setWorkspaceEnv,
    t,
  ]);
  const {
    repositoryTarget: sourceControlRepositoryTarget,
    openInSourceControl: handleOpenRepositoryInSourceControl,
    openGitHistory: handleOpenGitHistoryForPath,
    followActiveContext: handleFollowRepositoryContext,
  } = useRepositoryTargeting({
    spaceId: sourceControlSpaceId,
    workspaceKey: workspaceScopeKey(workspaceEnv),
    isContextCurrent: isRepositoryContextCurrent,
    openSourceControl,
    openCommitHistoryTab,
  });
  const { sourceControl, toggleSourceControl, openGitGraphFromContext } =
    useSourceControlContext({
      activeTab,
      tabs,
      activeTerminalLeafCwd,
      explorerRoot,
      launchCwd,
      launchCwdResolved,
      home,
      sidebarView,
      repositoryTarget: sourceControlRepositoryTarget,
      cycleSidebarView,
      openCommitHistoryTab,
    });
  const explorerGitDecorations = usePreferencesStore(
    (s) => s.explorerGitDecorations,
  );

  const openPreviewTab = useCallback(
    (url?: string) => {
      const explicitUrl = (url ?? "").trim();
      if (explicitUrl) {
        return newPreviewTab(explicitUrl);
      }

      const activeTab = tabsRef.current.find((t) => t.id === effectiveActiveId);
      const activePath =
        activeTab && "path" in activeTab && typeof activeTab.path === "string"
          ? activeTab.path
          : activeFilePath;

      const activeFileDir = activePath
        ? activePath.replace(/[/\\][^/\\]+$/, "") || activePath
        : null;

      const termCwd =
        activeTerminalLeafCwd ||
        (activeTab && "paneTree" in activeTab && "activeLeafId" in activeTab
          ? findLeafCwd(activeTab.paneTree, activeTab.activeLeafId)
          : null) ||
        (activeTab && "cwd" in activeTab && typeof activeTab.cwd === "string"
          ? activeTab.cwd
          : null);

      const rootCandidate: string | null =
        activeFileDir ||
        termCwd ||
        explorerRoot ||
        activeSpace?.root ||
        inheritedCwdForNewTab() ||
        launchCwd ||
        null;

      const targetCandidate = rootCandidate || "";
      const id = newPreviewTab("");
      void useWebServerStore
        .getState()
        .startServer(targetCandidate)
        .then((info) => {
          let targetUrl = info.url;
          if (
            activePath &&
            (activePath.endsWith(".html") ||
              activePath.endsWith(".htm") ||
              activePath.endsWith(".php"))
          ) {
            const rel = activePath
              .replace(info.root_path, "")
              .replace(targetCandidate, "")
              .replace(/^[/\\]+/, "")
              .replace(/\\/g, "/");
            if (rel && rel !== activePath) {
              targetUrl = `${info.url}/${rel}`;
            }
          }
          updateTab(id, { url: targetUrl });
        })
        .catch((err) => {
          console.error("Failed to auto-start live web server:", err);
          setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
        });
      return id;
    },
    [
      newPreviewTab,
      effectiveActiveId,
      activeFilePath,
      activeTerminalLeafCwd,
      explorerRoot,
      activeSpace?.root,
      inheritedCwdForNewTab,
      launchCwd,
      updateTab,
    ],
  );

  const openDevServerPreview = useCallback(
    (capture: DevServerCapture) => {
      const linked = tabsRef.current.find(
        (tab): tab is PreviewTab =>
          tab.kind === "preview" && tab.devServerScope === capture.scope,
      );
      if (linked) {
        if (linked.url !== capture.url) {
          updateTab(linked.id, { url: capture.url });
        }
        setActiveId(linked.id);
        return linked.id;
      }
      return newPreviewTab(capture.url, {
        devServerScope: capture.scope,
      });
    },
    [newPreviewTab, setActiveId, updateTab],
  );

  useEffect(() => {
    return useDevServerCaptureStore.subscribe((state, previous) => {
      for (const captures of Object.values(state.capturesByLeaf)) {
        for (const capture of captures) {
          const wasPresent = previous.capturesByLeaf[capture.leafId]?.some(
            (candidate) => candidate.id === capture.id,
          );
          if (wasPresent) continue;
          const linked = tabsRef.current.find(
            (tab): tab is PreviewTab =>
              tab.kind === "preview" && tab.devServerScope === capture.scope,
          );
          if (linked && linked.url !== capture.url) {
            updateTab(linked.id, { url: capture.url });
          }
        }
      }
    });
  }, [updateTab]);

  const splitActivePaneInActiveTab = useCallback(
    (dir: "row" | "col") => {
      const t = tabsRef.current.find((x) => x.id === effectiveActiveId);
      if (!t || t.kind !== "terminal") return;
      splitActivePane(effectiveActiveId, dir);
    },
    [effectiveActiveId, splitActivePane],
  );

  const livePaneBounds = useCallback((tabId: number): PaneBounds[] => {
    const tab = document.querySelector<HTMLElement>(
      `[data-terminal-tab="${tabId}"]`,
    );
    if (!tab) return [];
    return [...tab.querySelectorAll<HTMLElement>("[data-pane-leaf]")].flatMap(
      (element) => {
        const id = Number(element.dataset.paneLeaf);
        if (!Number.isFinite(id)) return [];
        const { left, right, top, bottom } = element.getBoundingClientRect();
        return [{ id, left, right, top, bottom }];
      },
    );
  }, []);

  const swapActivePane = useCallback(
    (direction: "left" | "right" | "up" | "down") => {
      swapActivePaneInDirection(
        effectiveActiveId,
        direction,
        livePaneBounds(effectiveActiveId),
      );
    },
    [effectiveActiveId, livePaneBounds, swapActivePaneInDirection],
  );

  const handleCloseTabOrPane = useCallback(() => {
    const t = tabsRef.current.find((x) => x.id === effectiveActiveId);
    if (t?.locked) {
      void import("sonner").then(({ toast }) => {
        void import("@/modules/i18n").then(({ t: translate }) => {
          toast.warning(
            translate("tabs.tabIsLockedWarning", {
              defaultValue:
                "This tab is locked. Please unlock it before closing.",
            }),
            { id: `tab-locked-${effectiveActiveId}` },
          );
        });
      });
      return;
    }
    if (t?.kind === "terminal" && leafIds(t.paneTree).length > 1) {
      closeActivePane(effectiveActiveId);
      return;
    }
    void handleClose(effectiveActiveId);
  }, [closeActivePane, effectiveActiveId, handleClose]);

  const [zenMode, setZenMode] = useState(false);

  // Focus an agent's tab, switching to its space first so the header and tab
  // strip don't end up showing a different space than the focused pane.
  const activateAgentTarget = useCallback(
    (tabId: number, leafId: number) => {
      const space = tabsRef.current.find((t) => t.id === tabId)?.spaceId;
      if (space && space !== useSpaces.getState().activeId) {
        useSpaces.getState().setActive(space);
      }
      setActiveId(tabId);
      focusPane(tabId, leafId);
    },
    [setActiveId, focusPane],
  );

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "commandPalette.open": openCommandPalette,
      "commandPalette.content": openWorkspaceSearch,
      "file.quickOpen": openQuickOpen,
      "editor.navigateBack": () => navigationActionRef.current("back"),
      "editor.navigateForward": () => navigationActionRef.current("forward"),
      "editor.outline": openOutline,
      "tabs.launchpad": openActiveTabsLaunchpad,
      "tab.new": openNewTab,
      "tab.newBlock": openNewBlockTab,
      "tab.newPrivate": openNewPrivateTab,
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newApiClient": () => newApiClientTab(),
      "tab.newEditor": openNewEditor,
      "tab.close": handleCloseTabOrPane,
      "tab.next": () => stepSwitcher(1),
      "tab.prev": () => stepSwitcher(-1),
      "tab.selectByIndex": (e) =>
        selectProjectedTabByIndex(parseInt(e.key, 10) - 1),
      "space.next": () => cycleSpace(1),
      "space.prev": () => cycleSpace(-1),
      "space.overview": () => setSwitcherOpen(true),
      "pane.splitRight": () => splitActivePaneInActiveTab("row"),
      "pane.splitDown": () => splitActivePaneInActiveTab("col"),
      "pane.focusNext": () => focusNextPaneInTab(effectiveActiveId, 1),
      "pane.focusPrev": () => focusNextPaneInTab(effectiveActiveId, -1),
      "pane.swapLeft": () => swapActivePane("left"),
      "pane.swapRight": () => swapActivePane("right"),
      "pane.swapUp": () => swapActivePane("up"),
      "pane.swapDown": () => swapActivePane("down"),
      "pane.source": toggleSourceControl,
      "terminal.clear": () => {
        clearFocusedTerminal();
      },
      "terminal.copilot": () => {
        if (activeTab?.kind === "terminal") {
          useTerminalCopilotStore
            .getState()
            .openCopilot(activeTab.activeLeafId);
        }
      },
      "terminal.toggleInput": () => {
        if (activeTab?.kind === "terminal") {
          toggleTabBlocks(activeTab.id);
        }
      },
      "blocks.prev": () => navigateFocusedBlocks(-1),
      "blocks.next": () => navigateFocusedBlocks(1),
      "search.focus": (e) => {
        const isBackward = e?.shiftKey;
        const isF3orG = e?.key === "F3" || e?.key === "g" || e?.key === "G";
        const editor = editorRefs.current.get(effectiveActiveId);
        if (editor) {
          if (isF3orG) {
            if (isBackward) editor.findPrevious();
            else editor.findNext();
          } else {
            editor.openSearch();
          }
          return;
        }
        const inline = searchInlineRef.current;
        if (inline) {
          if (isF3orG && inline.isOpen()) {
            if (isBackward) inline.findPrevious();
            else inline.findNext();
          } else {
            inline.focus();
          }
        }
      },
      "ai.toggle": togglePanelAndFocus,
      "ai.toggleMini": () => {
        if (!hasComposer) {
          void openSettingsWindow("models");
          return;
        }
        togglePanelAndFocus();
      },
      "ai.askSelection": onAskFromSelection,
      "agent.focusAttention": () => {
        const t = nextAttentionTarget();
        if (t) activateAgentTarget(t.tabId, t.leafId);
      },
      "settings.open": () => void openSettingsWindow(),
      "sidebar.toggle": toggleSidebar,
      "explorer.focus": toggleExplorerFocus,
      "explorer.toggleHidden": toggleHiddenFiles,
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "view.zenMode": () => setZenMode((v) => !v),
      "editor.undo": () => editorRefs.current.get(effectiveActiveId)?.undo(),
      "editor.redo": () => editorRefs.current.get(effectiveActiveId)?.redo(),
      "editor.aiComplete": () =>
        editorRefs.current.get(effectiveActiveId)?.triggerAiComplete(),
      "editor.codeComplete": () =>
        editorRefs.current.get(effectiveActiveId)?.triggerCodeComplete(),
      "editor.gotoLine": () =>
        editorRefs.current.get(effectiveActiveId)?.openGotoLine(),
      "editor.formatDocument": () =>
        editorRefs.current.get(effectiveActiveId)?.formatDocument(),
      "editor.quickFix": () =>
        editorRefs.current.get(effectiveActiveId)?.triggerQuickFix(),
      "editor.signatureHelp": () =>
        editorRefs.current.get(effectiveActiveId)?.triggerSignatureHelp(),
      "editor.goToDefinition": () =>
        editorRefs.current
          .get(effectiveActiveId)
          ?.triggerLspNavigation("definition"),
      "editor.peekDefinition": () =>
        editorRefs.current.get(effectiveActiveId)?.triggerLspPeek("definition"),
      "editor.goToTypeDefinition": () =>
        editorRefs.current
          .get(effectiveActiveId)
          ?.triggerLspNavigation("typeDefinition"),
      "editor.goToImplementation": () =>
        editorRefs.current
          .get(effectiveActiveId)
          ?.triggerLspNavigation("implementation"),
      "editor.findReferences": () =>
        editorRefs.current.get(effectiveActiveId)?.triggerLspPeek("references"),
      "editor.openFile": pickAndOpenFile,
      "editor.openFolder": pickAndOpenFolder,
    }),
    [
      effectiveActiveId,
      activeTab,
      openCommandPalette,
      openWorkspaceSearch,
      openQuickOpen,
      openOutline,
      openActiveTabsLaunchpad,
      stepSwitcher,
      cycleSpace,
      handleCloseTabOrPane,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openNewEditor,
      openPreviewTab,
      selectProjectedTabByIndex,
      splitActivePaneInActiveTab,
      focusNextPaneInTab,
      swapActivePane,
      toggleSourceControl,
      toggleTabBlocks,
      hasComposer,
      togglePanelAndFocus,
      onAskFromSelection,
      toggleSidebar,
      toggleExplorerFocus,
      toggleHiddenFiles,
      zoomIn,
      zoomOut,
      zoomReset,
      activateAgentTarget,
      pickAndOpenFile,
      pickAndOpenFolder,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      const terminalPaneCount =
        activeTab?.kind === "terminal"
          ? leafIds(activeTab.paneTree).length
          : null;
      const sel = id === "ai.askSelection" ? captureActiveSelection() : null;
      return shouldDisableShortcut({
        id,
        event: e,
        activeTabKind: activeTab?.kind,
        terminalPaneCount,
        blocksMode: activeTab?.kind === "terminal" && activeTab.blocks === true,
        hasSelection: !!sel && !!sel.trim(),
      });
    },
    [activeTab, captureActiveSelection],
  );

  useGlobalShortcuts(shortcutHandlers, { isDisabled: shortcutsDisabled });

  const registerTerminalHandle = useCallback(
    (leafId: number, h: TerminalPaneHandle | null) => {
      if (h) terminalRefs.current.set(leafId, h);
      else terminalRefs.current.delete(leafId);
    },
    [],
  );

  const registerEditorHandle = useCallback(
    (id: number, h: EditorPaneHandle | null) => {
      if (h) {
        editorRefs.current.set(id, h);
        const pending = pendingEditorNavigation.current.get(id);
        if (pending != null) {
          pendingEditorNavigation.current.delete(id);
          if (pending.line === undefined) h.focus();
          else
            h.gotoLocation(
              pending.line,
              pending.column ?? 1,
              pending.matchLength ?? 0,
              { focus: pending.focus },
            );
        }
      } else {
        editorRefs.current.delete(id);
      }
      if (id === effectiveActiveId) setActiveEditorHandle(h);
    },
    [effectiveActiveId],
  );

  const registerEditorGroupHandle = useCallback(
    (handle: EditorGroupHandle | null) => {
      editorGroupHandleRef.current = handle;
    },
    [],
  );

  const registerPreviewHandle = useCallback(
    (id: number, h: PreviewPaneHandle | null) => {
      if (h) previewRefs.current.set(id, h);
      else previewRefs.current.delete(id);
    },
    [],
  );

  const registerMarkdownHandle = useCallback(
    (id: number, h: MarkdownSearchHandle | null) => {
      if (h) markdownRefs.current.set(id, h);
      else markdownRefs.current.delete(id);
    },
    [],
  );

  const handlePreviewUrl = useCallback(
    (id: number, url: string) => updateTab(id, { url }),
    [updateTab],
  );

  const authorizedCwds = useRef(new Set<string>());
  const handleTerminalCwd = useCallback(
    (leafId: number, cwd: string) => {
      const target = terminalCwdTarget(tabsRef.current, leafId, workspaceEnv);
      if (!target) return;
      setLeafCwd(leafId, cwd);
      if (target.authorizeLocally && cwd && !authorizedCwds.current.has(cwd)) {
        authorizedCwds.current.add(cwd);
        native.workspaceAuthorize(cwd).catch(() => {
          authorizedCwds.current.delete(cwd);
        });
      }
    },
    [setLeafCwd, workspaceEnv],
  );

  const handleTerminalTitle = useCallback(
    (leafId: number, title: string) => {
      const tab = tabsRef.current.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (tab && tab.kind === "terminal" && !tab.customTitle && tab.title !== title) {
        updateTab(tab.id, { title });
      }
    },
    [updateTab],
  );

  const handlePrepareExplorerNavigationRoot = useCallback(
    async (rootPath: string): Promise<boolean> => {
      const tab = tabsRef.current.find(
        (candidate) => candidate.id === explorerTerminalId,
      );
      if (tab?.kind !== "terminal") return false;
      const previousExplorerEnv = explorerWorkspaceEnvsRef.current.get(tab.id);
      const currentEnv =
        previousExplorerEnv ??
        tab.workspaceEnv ??
        workspaceEnv;
      const prepared = await prepareRemoteExplorerEnv(
        currentEnv,
        rootPath,
        openRemoteWorkspace,
      );
      if (!prepared.opened) return false;
      if (!tabsRef.current.some((candidate) => candidate.id === tab.id)) {
        if (
          prepared.workspaceEnv.kind === "ssh" &&
          prepared.workspaceEnv.sessionId !== undefined
        ) {
          void closeRemoteWorkspace(prepared.workspaceEnv.sessionId).catch(
            () => {},
          );
        }
        return false;
      }
      explorerWorkspaceEnvsRef.current.set(tab.id, prepared.workspaceEnv);
      setExplorerWorkspaceRevision((revision) => revision + 1);
      if (
        previousExplorerEnv?.kind === "ssh" &&
        previousExplorerEnv.sessionId !== undefined &&
        prepared.workspaceEnv.kind === "ssh" &&
        previousExplorerEnv.sessionId !== prepared.workspaceEnv.sessionId
      ) {
        void closeRemoteWorkspace(previousExplorerEnv.sessionId).catch(
          () => {},
        );
      }
      return true;
    },
    [explorerTerminalId, workspaceEnv],
  );

  const handleFocusLeaf = useCallback(
    (tabId: number, leafId: number) => focusPane(tabId, leafId),
    [focusPane],
  );

  const onActivateAgent = activateAgentTarget;

  const onActivateLocalAgent = useCallback(() => {
    openPanel();
    focusInput(null);
  }, [openPanel, focusInput]);

  const handleLeafExit = useCallback(
    (leafId: number, _code: number) => {
      const all = tabsRef.current;
      const tab = all.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (tab?.kind !== "terminal") return;
      // A shell exit only closes its terminal surface. Voktty stays open so the
      // workspace can render its empty state and offer a new terminal/file.
      if (leafIds(tab.paneTree).length === 1) disposeTab(tab.id);
      else closePaneByLeaf(leafId);
    },
    [closePaneByLeaf, disposeTab],
  );

  const handleEditorDirty = useCallback(
    (id: number, dirty: boolean) => updateTab(id, { dirty }),
    [updateTab],
  );

  const handleRenameTab = useCallback(
    (id: number, title: string) => updateTab(id, { customTitle: title.trim() }),
    [updateTab],
  );

  const handleSetTabColor = useCallback(
    (id: number, color: string | null) => updateTab(id, { color }),
    [updateTab],
  );

  const handleToggleLockTab = useCallback(
    (id: number) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      updateTab(id, { locked: !tab.locked });
    },
    [updateTab],
  );

  const handleDuplicateTab = useCallback(
    (id: number) => {
      const source = tabsRef.current.find((tab) => tab.id === id);
      if (source?.kind !== "terminal") return;
      const spaceEnv = useSpaces
        .getState()
        .spaces.find((space) => space.id === source.spaceId)?.env;
      const env = source.workspaceEnv ?? spaceEnv ?? LOCAL_WORKSPACE;
      setWorkspaceEnv(env);
      duplicateTab(id, env);
    },
    [duplicateTab, setWorkspaceEnv],
  );

  const searchTarget = useMemo<SearchTarget>(() => {
    if (isTerminalTab && activeLeafId !== null && activeSearchAddon)
      return {
        kind: "terminal",
        addon: activeSearchAddon,
        focus: () => terminalRefs.current.get(activeLeafId)?.focus(),
      };
    if (isEditorTab && activeEditorHandle)
      return {
        kind: "editor",
        handle: activeEditorHandle,
        focus: () => activeEditorHandle.focus(),
      };
    if (
      isMarkdownTab &&
      effectiveActiveId !== null &&
      markdownRefs.current.has(effectiveActiveId)
    ) {
      const handle = markdownRefs.current.get(effectiveActiveId)!;
      return {
        kind: "markdown",
        handle,
        focus: () => handle.focus(),
      };
    }
    if (isGitHistoryTab && gitHistoryHandle)
      return {
        kind: "git-history",
        handle: gitHistoryHandle,
        focus: () => {},
      };
    return null;
  }, [
    isTerminalTab,
    isEditorTab,
    isMarkdownTab,
    isGitHistoryTab,
    effectiveActiveId,
    activeLeafId,
    activeSearchAddon,
    activeEditorHandle,
    gitHistoryHandle,
  ]);

  const activeCwd = activeTerminalLeafCwd;
  const localWorkspaceRoot = localHome;

  const handleNewSpace = useCallback(() => {
    const { spaces, create, ensureViewSpace, openViewSpace, setActive } =
      useSpaces.getState();
    const meta = create({
      name: `Space ${spaces.length + 1}`,
      root: localWorkspaceRoot,
      env: LOCAL_WORKSPACE,
    });
    setActiveSpaceForNewTabs(meta.id);
    const viewSpaceId = ensureViewSpace({
      workspaceId: meta.id,
      name: meta.name,
    });
    openViewSpace(viewSpaceId);
    setActive(meta.id);
    return meta.id;
  }, [localWorkspaceRoot, setActiveSpaceForNewTabs]);

  const handleDeleteSpace = useCallback((id: string) => {
    const viewSpaceId = id.startsWith("view-") ? id : `view-${id}`;
    const workspaceId = viewSpaceId.slice("view-".length);
    const state = useSpaces.getState();
    const fallback =
      state.spaces.find((space) => space.id !== workspaceId) ??
      state.create({
        name: t("common.default"),
        root: localWorkspaceRoot,
        env: LOCAL_WORKSPACE,
      });
    const affectedTabs = tabsRef.current.filter(
      (tab) => tab.spaceId === workspaceId,
    );
    state.deleteViewSpace(viewSpaceId);
    for (const tab of affectedTabs) {
      moveTabToSpace(tab.id, fallback.id);
    }
    state.remove(workspaceId);
    state.setActive(fallback.id);
    setActiveSpaceForNewTabs(fallback.id);
  }, [localWorkspaceRoot, moveTabToSpace, setActiveSpaceForNewTabs, t]);

  const handleExtractTabFromSpace = useCallback((tabId: number) => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    useSpaces.getState().extractMemberFromViewSpace(tab.tabKey);
  }, []);

  const handleMoveTabToViewSpace = useCallback(
    (tabId: number, viewSpaceId: string) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
      if (!tab) return;
      const state = useSpaces.getState();
      const targetSpaceId = viewSpaceId.startsWith("view-")
        ? viewSpaceId.slice("view-".length)
        : null;
      const targetSpace = targetSpaceId
        ? state.spaces.find((space) => space.id === targetSpaceId)
        : null;
      const resolvedViewSpaceId =
        targetSpace &&
        !state.viewSpaces.some((space) => space.id === viewSpaceId)
          ? state.ensureViewSpace({
              workspaceId: targetSpace.id,
              name: targetSpace.name,
              color: targetSpace.color,
            })
          : viewSpaceId;
      if (targetSpaceId && targetSpaceId !== tab.spaceId) {
        state.extractMemberFromViewSpace(tab.tabKey);
        moveTabToSpace(tab.id, targetSpaceId);
      }
      if (!state.moveMemberToViewSpace(resolvedViewSpaceId, tab.tabKey)) {
        toast.error(t("spaces.noFreeSlots"));
        return;
      }
      state.openViewSpace(resolvedViewSpaceId);
      state.setActive(targetSpaceId ?? tab.spaceId);
      setActiveId(tab.id);
    },
    [moveTabToSpace, setActiveId, t],
  );

  const handleCreateSpaceFromTab = useCallback(
    (tab: Tab) => {
      const state = useSpaces.getState();
      const sourceSpace = state.spaces.find(
        (space) => space.id === tab.spaceId,
      );
      if (!sourceSpace) return;
      state.extractMemberFromViewSpace(tab.tabKey);
      const created = state.create({
        name: `${sourceSpace.name} · ${labelFor(tab)}`,
        root: sourceSpace.root,
        env: sourceSpace.env,
      });
      moveTabToSpace(tab.id, created.id);
      state.ensureViewSpace({
        workspaceId: created.id,
        name: created.name,
        initialMember: tab.tabKey,
      });
      state.openViewSpace(`view-${created.id}`);
      state.setActive(created.id);
      setActiveId(tab.id);
    },
    [moveTabToSpace, setActiveId],
  );

  const handleWorkspaceDrop = useCallback(
    async (source: WorkspaceDragSource, target: WorkspaceDropTarget) => {
      const viewState = useSpaces.getState();
      const targetWorkspaceId =
        target.kind === "space" || target.kind === "slot"
          ? target.viewSpaceId.startsWith("view-")
            ? target.viewSpaceId.slice("view-".length)
            : null
          : null;
      const targetSpace = targetWorkspaceId
        ? viewState.spaces.find((space) => space.id === targetWorkspaceId)
        : null;
      const resolvedTarget =
        target.kind === "space" &&
        targetSpace &&
        !viewState.viewSpaces.some(
          (viewSpace) => viewSpace.id === target.viewSpaceId,
        )
          ? {
              ...target,
              viewSpaceId: viewState.ensureViewSpace({
                workspaceId: targetSpace.id,
                name: targetSpace.name,
                color: targetSpace.color,
              }),
            }
          : target;
      const plan = planWorkspaceDrop({
        source,
        target: resolvedTarget,
        viewSpaces: viewState.viewSpaces,
        tabs: tabsRef.current,
      });
      if (!plan.accepted) {
        toast.error(
          plan.reason === "max-slots"
            ? t("spaces.maxSlots")
            : plan.reason === "renderer-capacity"
              ? t("spaces.rendererCapacity")
              : plan.reason === "slot-occupied"
                ? t("spaces.slotOccupied")
                : t("spaces.invalidDrop"),
        );
        return;
      }

      if (plan.operation === "reference-resource") {
        viewState.openViewSpace(plan.viewSpaceId);
        viewState.focusViewSpaceSlot(plan.viewSpaceId, plan.slotId);
        handleAttachFileToAgent(plan.source.path);
        return;
      }

      if (!source || !("tabId" in source)) return;
      const tab = tabsRef.current.find(
        (candidate) => candidate.id === source.tabId,
      );
      if (!tab) return;

      if (plan.operation === "extract") {
        viewState.extractMemberFromViewSpace(tab.tabKey);
        return;
      }
      if (plan.operation === "new-space") {
        handleCreateSpaceFromTab(tab);
        return;
      }

      const targetSpaceId = plan.viewSpaceId.slice("view-".length);
      if (tab.spaceId !== targetSpaceId) {
        viewState.extractMemberFromViewSpace(tab.tabKey);
        moveTabToSpace(tab.id, targetSpaceId);
      }

      if (plan.operation === "assign" || plan.operation === "append") {
        if (!viewState.addMemberToViewSpace(plan.viewSpaceId, tab.tabKey, spaceViewLimit)) {
          toast.error(t("spaces.maxSlots"));
          return;
        }
        viewState.openViewSpace(plan.viewSpaceId);
        viewState.focusVisualMember(tab.tabKey);
      } else if (plan.operation === "swap") {
        viewState.swapViewSpaceSlots(
          plan.viewSpaceId,
          plan.sourceSlotId,
          plan.targetSlotId,
        );
        viewState.focusViewSpaceSlot(plan.viewSpaceId, plan.targetSlotId);
      }
      viewState.setActive(targetSpaceId);
      setActiveId(tab.id);
    },
    [
      activeSpaceId,
      handleAttachFileToAgent,
      handleCreateSpaceFromTab,
      handleOpenFile,
      moveTabToSpace,
      newTab,
      newTabInSpace,
      setActiveId,
      setWorkspaceEnv,
      spaceViewLimit,
      t,
      workspaceEnv,
    ],
  );

  const handleMoveTab = useCallback(
    (tabId: number, targetSpaceId: string) => {
      handleMoveTabToViewSpace(tabId, `view-${targetSpaceId}`);
    },
    [handleMoveTabToViewSpace],
  );

  const handleReorderTab = useCallback(
    (tabId: number, targetTabId: number, edge: "top" | "bottom") => {
      const currentTabs = tabsRef.current;
      const source = currentTabs.find((tab) => tab.id === tabId);
      const target = currentTabs.find((tab) => tab.id === targetTabId);
      if (!source || !target || source.id === target.id) return;
      const state = useSpaces.getState();
      const sourceOwner = state.viewSpaces.find((space) =>
        space.memberOrder.includes(source.tabKey),
      );
      const targetOwner = state.viewSpaces.find((space) =>
        space.memberOrder.includes(target.tabKey),
      );

      if (sourceOwner && sourceOwner.id === targetOwner?.id) {
        const nextOrder = sourceOwner.memberOrder.filter(
          (tabKey) => tabKey !== source.tabKey,
        );
        const targetIndex = nextOrder.indexOf(target.tabKey);
        if (targetIndex === -1) return;
        nextOrder.splice(
          targetIndex + (edge === "bottom" ? 1 : 0),
          0,
          source.tabKey,
        );
        state.reorderViewSpaceMembers(sourceOwner.id, nextOrder);
        return;
      }

      if (!sourceOwner && !targetOwner) {
        const visibleTabKeys = projectStripEntries({
          tabs: currentTabs,
          viewSpaces: state.viewSpaces,
          stripEntries: state.stripEntries,
        }).flatMap((item) => (item.kind === "tab" ? [item.tabKey] : []));
        const targetIndex = visibleTabKeys.indexOf(target.tabKey);
        if (targetIndex === -1) return;
        state.reorderStandaloneTabByGap(
          source.tabKey,
          targetIndex + (edge === "bottom" ? 1 : 0),
          visibleTabKeys,
        );
        if (
          source.spaceId !== target.spaceId &&
          reorderTab(tabId, targetTabId, edge)
        ) {
          state.setActive(target.spaceId);
        }
        return;
      }
    },
    [reorderTab],
  );

  const handleNewTabInSpace = useCallback(
    (spaceId: string) => {
      const state = useSpaces.getState();
      const viewSpace = state.viewSpaces.find(
        (candidate) => candidate.id === `view-${spaceId}`,
      );
      if (viewSpace && viewSpace.memberOrder.length >= spaceViewLimit) {
        toast.error(t("spaces.maxSlots"));
        return;
      }
      const context = selectLocalTerminalSpawnContext(localHome);
      const id = newTabInSpace(spaceId, context.cwd, context.workspaceEnv);
      window.setTimeout(() => {
        const tab = tabsRef.current.find((candidate) => candidate.id === id);
        if (!tab) return;
        const state = useSpaces.getState();
        const meta = state.spaces.find((space) => space.id === spaceId);
        const viewSpaceId = state.ensureViewSpace({
          workspaceId: spaceId,
          name: meta?.name ?? spaceId,
        });
        if (!state.addMemberToViewSpace(viewSpaceId, tab.tabKey, spaceViewLimit)) {
          toast.error(t("spaces.maxSlots"));
          return;
        }
        state.openViewSpace(viewSpaceId);
        state.setActive(spaceId);
        setActiveId(id);
      }, 0);
    },
    [localHome, newTabInSpace, setActiveId, spaceViewLimit, t],
  );

  const jumpToTab = useCallback(
    (tabId: number) => {
      const t = tabsRef.current.find((x) => x.id === tabId);
      if (!t) return;
      setActiveId(tabId);
      useSpaces.getState().setActive(t.spaceId);
      useSpaces.getState().focusVisualMember(t.tabKey);
      setSwitcherOpen(false);
    },
    [setActiveId],
  );

  const handleSelectViewSpace = useCallback(
    (viewSpaceId: string) => {
      const state = useSpaces.getState();
      const focusedMember = state.openViewSpace(viewSpaceId);
      const viewSpace = state.viewSpaces.find(
        (space) => space.id === viewSpaceId,
      );
      if (
        viewSpace &&
        !viewSpacePaneBudget(tabsRef.current, viewSpace.memberOrder).allowed
      ) {
        toast.error(t("spaces.rendererCapacity"));
        return;
      }
      const memberKey = focusedMember ?? viewSpace?.memberOrder[0] ?? null;
      const tab = memberKey
        ? tabsRef.current.find((candidate) => candidate.tabKey === memberKey)
        : undefined;
      if (tab) {
        jumpToTab(tab.id);
      } else if (viewSpaceId.startsWith("view-")) {
        const spaceId = viewSpaceId.slice("view-".length);
        useSpaces.getState().setActive(spaceId);
        setActiveSpaceForNewTabs(spaceId);
      }
      setSwitcherOpen(false);
    },
    [jumpToTab, setActiveSpaceForNewTabs, t],
  );

  const handleOpenSpaceFromMenu = useCallback(
    (spaceId: string) => {
      const viewSpaceId = `view-${spaceId}`;
      if (viewSpaces.some((space) => space.id === viewSpaceId)) {
        handleSelectViewSpace(viewSpaceId);
        return;
      }
      useSpaces.getState().setActive(spaceId);
      setSwitcherOpen(false);
    },
    [handleSelectViewSpace, viewSpaces],
  );

  const handleToggleViewSpace = useCallback(
    (viewSpaceId: string) => {
      const viewSpace = useSpaces
        .getState()
        .viewSpaces.find((space) => space.id === viewSpaceId);
      if (!viewSpace) return;
      if (viewSpace.presentation === "composite") {
        if (
          !viewSpacePaneBudget(tabsRef.current, viewSpace.memberOrder).allowed
        ) {
          toast.error(t("spaces.rendererCapacity"));
          return;
        }
        useSpaces.getState().expandViewSpace(viewSpaceId);
      } else {
        handleSelectViewSpace(viewSpaceId);
      }
    },
    [handleSelectViewSpace, t],
  );

  const handleExpandViewSpace = useCallback(
    (viewSpaceId: string) => {
      const viewSpace = useSpaces
        .getState()
        .viewSpaces.find((space) => space.id === viewSpaceId);
      if (!viewSpace) return;
      if (
        !viewSpacePaneBudget(tabsRef.current, viewSpace.memberOrder).allowed
      ) {
        toast.error(t("spaces.rendererCapacity"));
        return;
      }
      useSpaces.getState().expandViewSpace(viewSpaceId);
    },
    [t],
  );

  const handleRenameViewSpace = useCallback(
    (viewSpaceId: string, name: string) => {
      if (!viewSpaceId.startsWith("view-")) return;
      const nextName = name.trim();
      if (!nextName) return;
      useSpaces
        .getState()
        .rename(viewSpaceId.slice("view-".length), nextName);
    },
    [],
  );

  const handleSetViewSpaceColor = useCallback(
    (viewSpaceId: string, color: number | undefined) => {
      if (!viewSpaceId.startsWith("view-")) return;
      useSpaces
        .getState()
        .setColor(viewSpaceId.slice("view-".length), color);
    },
    [],
  );

  const focusSpaceSlot = useCallback(
    (delta: 1 | -1) => {
      const viewSpace = activeContextViewSpace;
      if (!viewSpace || viewSpace.presentation !== "composite") return;
      const state = useSpaces.getState();
      const memberKey = state.focusNextViewSpaceSlot(viewSpace.id, delta);
      if (!memberKey) return;
      const tab = tabsRef.current.find(
        (candidate) => candidate.tabKey === memberKey,
      );
      if (!tab) return;
      state.setActive(tab.spaceId);
      setActiveId(tab.id);
    },
    [activeContextViewSpace, setActiveId],
  );

  const toggleFocusedSpaceView = useCallback(() => {
    const viewSpace = activeContextViewSpace;
    if (!viewSpace) return;
    if (viewSpace.presentation === "composite") {
      useSpaces.getState().expandViewSpace(viewSpace.id);
      return;
    }
    handleSelectViewSpace(viewSpace.id);
  }, [activeContextViewSpace, handleSelectViewSpace]);

  const extractFocusedSpaceMember = useCallback(() => {
    const tab = tabsRef.current.find(
      (candidate) => candidate.id === effectiveActiveId,
    );
    if (!tab || !activeContextViewSpace?.memberOrder.includes(tab.tabKey))
      return;
    useSpaces.getState().extractMemberFromViewSpace(tab.tabKey);
    setActiveId(tab.id);
  }, [activeContextViewSpace, effectiveActiveId, setActiveId]);

  const moveFocusedSpaceMember = useCallback(() => {
    if (!activeContextViewSpace) return;
    setSwitcherOpen(true);
  }, [activeContextViewSpace]);

  const closeFocusedSpaceMember = useCallback(() => {
    const tab = tabsRef.current.find(
      (candidate) => candidate.id === effectiveActiveId,
    );
    if (!tab || !activeContextViewSpace?.memberOrder.includes(tab.tabKey))
      return;
    void handleClose(tab.id);
  }, [activeContextViewSpace, effectiveActiveId, handleClose]);

  const assignTabToViewSlot = useCallback(
    (viewSpaceId: string, slotId: SlotId, tabId: number) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
      if (!tab) return;
      const state = useSpaces.getState();
      const viewSpace = state.viewSpaces.find(
        (candidate) => candidate.id === viewSpaceId,
      );
      if (
        !viewSpace ||
        !tabAssignmentPaneBudget(
          tabsRef.current,
          viewSpace.memberOrder,
          tab.tabKey,
        ).allowed
      ) {
        toast.error(t("spaces.rendererCapacity"));
        return;
      }
      if (!state.addMemberToViewSpace(viewSpaceId, tab.tabKey, spaceViewLimit)) {
        toast.error(t("spaces.maxSlots"));
        return;
      }
      state.openViewSpace(viewSpaceId);
      setActiveId(tab.id);
      state.setActive(tab.spaceId);
      state.focusViewSpaceSlot(viewSpaceId, slotId);
    },
    [setActiveId, spaceViewLimit, t],
  );

  const handleFocusViewSlot = useCallback(
    (viewSpaceId: string, slotId: SlotId, tabId: number | null) => {
      const state = useSpaces.getState();
      state.focusViewSpaceSlot(viewSpaceId, slotId);
      if (tabId === null) return;
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
      if (!tab) return;
      state.setActive(tab.spaceId);
      setActiveId(tab.id);
    },
    [setActiveId],
  );

  const handleResizeViewSplit = useCallback(
    (
      viewSpaceId: string,
      splitId: string,
      pointer: number,
      bounds: { x: number; y: number; width: number; height: number },
    ) => {
      const state = useSpaces.getState();
      const viewSpace = state.viewSpaces.find(
        (space) => space.id === viewSpaceId,
      );
      if (!viewSpace) return;
      const ratio = updateSpaceSplitRatio(
        viewSpace.layout,
        splitId,
        pointer,
        bounds,
      );
      if (ratio !== null)
        state.resizeViewSpaceSplit(viewSpaceId, splitId, ratio);
    },
    [],
  );

  const handleNewTerminalInSlot = useCallback(
    (slotId: SlotId) => {
      const viewSpace = activeViewSpace;
      if (!viewSpace) return;
      const current = viewSpacePaneBudget(
        tabsRef.current,
        viewSpace.memberOrder,
      );
      if (!projectPaneBudget(current.current, 1, current.max).allowed) {
        toast.error(t("spaces.rendererCapacity"));
        return;
      }
      const workspaceId = viewSpace.id.replace(/^view-/, "");
      useSpaces.getState().setActive(workspaceId);
      setActiveSpaceForNewTabs(workspaceId);
      const tabId = newTab(localHome ?? undefined, LOCAL_WORKSPACE);
      window.setTimeout(() => {
        assignTabToViewSlot(viewSpace.id, slotId, tabId);
      }, 0);
    },
    [
      activeViewSpace,
      assignTabToViewSlot,
      localHome,
      newTab,
      setActiveSpaceForNewTabs,
      t,
    ],
  );

  const handleNewFileInSlot = useCallback(
    (slotId: SlotId) => {
      if (!activeViewSpace) return;
      pendingAdaptiveViewSpaceRef.current = null;
      pendingSpaceSlotRef.current = {
        viewSpaceId: activeViewSpace.id,
        slotId,
      };
      setNewEditorOpen(true);
    },
    [activeViewSpace],
  );

  const handleSelectExistingTabInSlot = useCallback(
    (slotId: SlotId) => {
      if (!activeViewSpace) return;
      pendingAdaptiveViewSpaceRef.current = null;
      pendingSpaceSlotRef.current = {
        viewSpaceId: activeViewSpace.id,
        slotId,
      };
      setActiveTabsLaunchpadOpen(true);
    },
    [activeViewSpace],
  );

  const handleDropInSlot = useCallback(
    async (slotId: SlotId, event: React.DragEvent<HTMLElement>) => {
      const viewSpace = activeViewSpace;
      if (!viewSpace) return;
      const raw =
        event.dataTransfer.getData("text/uri-list") ||
        event.dataTransfer.getData("text/plain");
      const path = raw
        .split("\n")
        .map((value) => value.trim())
        .find(Boolean)
        ?.replace(/^file:\/\//, "");
      if (!path) return;
      const decodedPath = decodeURIComponent(path);
      const stat = await invoke<{ kind: "file" | "dir" | "symlink" }>(
        "fs_stat",
        { path: decodedPath, workspace: workspaceEnv },
      ).catch(() => null);
      const source =
        stat?.kind === "dir"
          ? {
              kind: "directory" as const,
              path: decodedPath,
              workspaceEnv,
            }
          : stat?.kind === "file" || stat?.kind === "symlink"
            ? { kind: "file" as const, path: decodedPath, workspaceEnv }
            : null;
      if (!source) {
        toast.error(t("spaces.resourceUnavailable"));
        return;
      }
      await handleWorkspaceDrop(source, {
        kind: "slot",
        viewSpaceId: viewSpace.id,
        slotId,
      });
    },
    [activeViewSpace, handleWorkspaceDrop, t, workspaceEnv],
  );

  const handleReorderVisualTabs = useCallback(
    (fromId: number, toGapIndex: number, visibleIds: number[]) => {
      const currentTabs = tabsRef.current;
      const source = currentTabs.find((tab) => tab.id === fromId);
      if (!source) return;
      const state = useSpaces.getState();
      const owner = state.viewSpaces.find((space) =>
        space.memberOrder.includes(source.tabKey),
      );

      if (owner?.presentation === "expanded") {
        const memberIds = visibleIds.filter((id) => {
          const tab = currentTabs.find((candidate) => candidate.id === id);
          return tab ? owner.memberOrder.includes(tab.tabKey) : false;
        });
        const sourceIndex = memberIds.indexOf(fromId);
        const firstIndex = visibleIds.indexOf(memberIds[0]);
        const lastIndex = visibleIds.indexOf(memberIds[memberIds.length - 1]);
        if (
          sourceIndex < 0 ||
          firstIndex < 0 ||
          lastIndex < 0 ||
          toGapIndex < firstIndex ||
          toGapIndex > lastIndex + 1
        ) {
          return;
        }
        const nextMemberIds = [...memberIds];
        nextMemberIds.splice(sourceIndex, 1);
        const sourceVisualIndex = visibleIds.indexOf(fromId);
        const visualOffset = toGapIndex > sourceVisualIndex ? 1 : 0;
        const targetVisualIndex = toGapIndex - visualOffset;
        const targetMemberIndex = visibleIds
          .slice(0, targetVisualIndex)
          .filter((id) => memberIds.includes(id)).length;
        nextMemberIds.splice(targetMemberIndex, 0, fromId);
        state.reorderViewSpaceMembers(
          owner.id,
          nextMemberIds.flatMap((id) => {
            const tab = currentTabs.find((candidate) => candidate.id === id);
            return tab ? [tab.tabKey] : [];
          }),
        );
        return;
      }

      state.reorderStandaloneTabByGap(
        source.tabKey,
        toGapIndex,
        visibleIds.flatMap((id) => {
          const tab = currentTabs.find((candidate) => candidate.id === id);
          return tab ? [tab.tabKey] : [];
        }),
      );
    },
    [],
  );

  const spaceSwitcher = (
    <SpaceSwitcher
      open={switcherOpen}
      onOpenChange={setSwitcherOpen}
      tabs={tabs}
      onNewSpace={() => void handleNewSpace()}
      onOpenSpace={handleOpenSpaceFromMenu}
      onDeleteSpace={handleDeleteSpace}
      viewSpaces={viewSpaces}
      activeStripItem={activeStripItem}
      onDeleteViewSpace={handleDeleteSpace}
      onToggleViewSpace={handleToggleViewSpace}
      onExtractTabFromSpace={handleExtractTabFromSpace}
      onMoveTabToViewSpace={handleMoveTabToViewSpace}
      onNewTabInSpace={handleNewTabInSpace}
      onJumpTab={jumpToTab}
      onCloseTab={handleClose}
      onMoveTabToSpace={handleMoveTab}
      onReorderTab={handleReorderTab}
      onWorkspaceDrop={handleWorkspaceDrop}
      onReorderSpaces={(ids) => useSpaces.getState().reorder(ids)}
    />
  );

  const handleSelectTabFromLaunchpad = useCallback(
    (tab: Tab) => {
      const pending = pendingSpaceSlotRef.current;
      if (pending) {
        pendingSpaceSlotRef.current = null;
        assignTabToViewSlot(pending.viewSpaceId, pending.slotId, tab.id);
        setActiveTabsLaunchpadOpen(false);
        return;
      }
      jumpToTab(tab.id);
    },
    [assignTabToViewSlot, jumpToTab],
  );

  const captureEditorLocation =
    useCallback((): EditorNavigationLocation | null => {
      const id = activeIdRef.current;
      const tab = tabsRef.current.find((candidate) => candidate.id === id);
      if (tab?.kind !== "editor") return null;
      const position = editorRefs.current.get(id)?.getLocation();
      if (!position) return null;
      return {
        spaceId: tab.spaceId,
        path: tab.path,
        line: position.line,
        column: position.column,
      };
    }, []);

  const syncNavigationAvailability = useCallback(() => {
    const state = navigationHistoryRef.current;
    setNavigationAvailability((previous) =>
      previous.canGoBack === state.canGoBack &&
      previous.canGoForward === state.canGoForward
        ? previous
        : {
            canGoBack: state.canGoBack,
            canGoForward: state.canGoForward,
          },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadNavigationHistory()
      .then((state) => {
        if (cancelled) return;
        navigationHistoryRef.current = state;
        syncNavigationAvailability();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [syncNavigationAvailability]);

  const applyEditorLocation = useCallback(
    (
      target: EditorNavigationLocation,
      options: { pin: boolean; matchLength: number; focus: boolean },
    ) => {
      if (useSpaces.getState().activeId !== target.spaceId) {
        useSpaces.getState().setActive(target.spaceId);
      }
      const id = openFileTab(target.path, options.pin, {
        spaceId: target.spaceId,
        activate: true,
      });
      const handle = editorRefs.current.get(id);
      if (handle) {
        handle.gotoLocation(target.line, target.column, options.matchLength, {
          focus: options.focus,
        });
      } else {
        pendingEditorNavigation.current.set(id, {
          line: target.line,
          column: target.column,
          matchLength: options.matchLength,
          focus: options.focus,
        });
      }
    },
    [openFileTab],
  );

  const openContentHit = useCallback(
    (path: string, line: number, column = 1, matchLength = 0, pin = true) => {
      const destination: EditorNavigationLocation = {
        spaceId: activeSpaceIdRef.current ?? DEFAULT_SPACE_ID,
        path,
        line,
        column,
      };
      const origin = captureEditorLocation();
      if (origin) {
        navigationHistoryRef.current = recordNavigation(
          navigationHistoryRef.current,
          origin,
          destination,
        );
        syncNavigationAvailability();
        void saveNavigationHistory(navigationHistoryRef.current).catch(
          () => {},
        );
      }
      applyEditorLocation(destination, { pin, matchLength, focus: true });
    },
    [applyEditorLocation, captureEditorLocation, syncNavigationAvailability],
  );

  const navigateEditorHistory = useCallback(
    (direction: "back" | "forward") => {
      const step = navigateHistory(navigationHistoryRef.current, direction);
      if (!step.target) return;
      navigationHistoryRef.current = step.state;
      syncNavigationAvailability();
      void saveNavigationHistory(navigationHistoryRef.current).catch(() => {});
      applyEditorLocation(step.target, {
        pin: true,
        matchLength: 0,
        focus: true,
      });
    },
    [applyEditorLocation, syncNavigationAvailability],
  );
  navigationActionRef.current = navigateEditorHistory;
  const navigateEditorBack = useCallback(
    () => navigateEditorHistory("back"),
    [navigateEditorHistory],
  );
  const navigateEditorForward = useCallback(
    () => navigateEditorHistory("forward"),
    [navigateEditorHistory],
  );

  const openOutlineSymbol = useCallback(
    (symbol: IdeSymbol) => {
      openContentHit(symbol.path, symbol.line, symbol.column, 0, true);
    },
    [openContentHit],
  );
  const openProblem = useCallback(
    (problem: IdeProblem) => {
      const matchLength =
        problem.line === problem.endLine
          ? Math.max(0, problem.endColumn - problem.column)
          : 0;
      openContentHit(
        problem.path,
        problem.line,
        problem.column,
        matchLength,
        true,
      );
    },
    [openContentHit],
  );
  const openDapLocation = useCallback(
    (path: string, line: number, column: number) => {
      openContentHit(path, line, column, 0, true);
    },
    [openContentHit],
  );
  const openQuickOpenFile = useCallback(
    (path: string, pin: boolean) => {
      if (isMarkdownPath(path)) newMarkdownTab(path);
      else openContentHit(path, 1, 1, 0, pin);
    },
    [newMarkdownTab, openContentHit],
  );
  const openWorkspaceSearchHit = useCallback(
    (hit: WorkspaceSearchHit, pin: boolean) => {
      openContentHit(hit.path, hit.line, hit.column, hit.matchLength, pin);
    },
    [openContentHit],
  );

  const openControlFile = useCallback(
    ({ paths, line, focus, spaceId }: LaunchRequest & { spaceId: string }) => {
      const path = paths[0];
      if (!path) return null;
      const shouldFocus = focus ?? true;
      const existing = tabsRef.current.find(
        (tab) =>
          (tab.kind === "editor" || tab.kind === "markdown") &&
          launchPathKey(tab.path) === launchPathKey(path),
      );
      if (existing) {
        if (shouldFocus) {
          useSpaces.getState().setActive(existing.spaceId);
          useSpaces.getState().focusVisualMember(existing.tabKey);
          setActiveId(existing.id);
        }
        return existing.id;
      }
      if (shouldFocus && useSpaces.getState().activeId !== spaceId) {
        useSpaces.getState().setActive(spaceId);
      }
      const id = openFileTab(path, true, {
        spaceId,
        activate: shouldFocus,
      });
      const editor = editorRefs.current.get(id);
      if (line !== undefined) {
        if (editor) editor.gotoLine(line, { focus: shouldFocus });
        else
          pendingEditorNavigation.current.set(id, {
            line,
            focus: shouldFocus,
          });
      } else if (shouldFocus) {
        if (editor) editor.focus();
        else pendingEditorNavigation.current.set(id, { focus: true });
      }
      return id;
    },
    [openFileTab, setActiveId],
  );

  useControlBridge({
    ready: spacesHydrated && launchCwdResolved,
    tabsRef,
    activeTabIdRef: activeIdRef,
    activeSpaceIdRef,
    onOpen: openControlFile,
  });

  useEffect(() => {
    setLspNavigator({ openFile: openContentHit });
    return () => setLspNavigator(null);
  }, [openContentHit]);

  useAiLiveBridge({
    setLive,
    activeId: effectiveActiveId,
    tabs,
    explorerRoot,
    launchCwd,
    home,
    openPreviewTab,
    newAgentTab,
    terminalRefs,
    editorRefs,
  });

  const handleRunTerminalCommand = useCallback(
    (command: string) => {
      const activeLeaf = activeTerminalTab?.activeLeafId ?? activeLeafId;
      const term =
        activeLeaf !== null ? terminalRefs.current.get(activeLeaf) : undefined;
      if (term) {
        term.write(`${command}\r`);
        term.focus();
      } else {
        const firstTerm = Array.from(terminalRefs.current.values())[0];
        if (firstTerm) {
          firstTerm.write(`${command}\r`);
          firstTerm.focus();
        }
      }
    },
    [activeTerminalTab?.activeLeafId, activeLeafId],
  );

  const commandItems = useMemo(
    () =>
      createCommandItems({
        aiAvailable: hasComposer,
        tabs,
        activeId: effectiveActiveId,
        searchTarget,
        explorerRoot,
        home,
        openNewTab,
        openNewBlock: openNewBlockTab,
        openNewPrivate: openNewPrivateTab,
        openSerialConnect: () => setSerialDialogOpen(true),
        openNewEditor,
        openFileFromDisk: pickAndOpenFile,
        openQuickOpen,
        openWorkspaceSearch,
        openOutline,
        openProblems,
        revealActiveFileInExplorer,
        openRunDebug,
        navigateBack: navigateEditorBack,
        navigateForward: navigateEditorForward,
        canNavigateBack: navigationAvailability.canGoBack,
        canNavigateForward: navigationAvailability.canGoForward,
        openNewPreview: () => openPreviewTab(""),
        openNewApiClient: () => newApiClientTab(),
        openActiveTabs: openActiveTabsLaunchpad,
        openGitGraph: openGitGraphFromContext,
        toggleSourceControl,
        closeActiveTabOrPane: handleCloseTabOrPane,
        reopenClosedEditor,
        toggleLockTab: handleToggleLockTab,
        splitPaneRight: () => splitActivePaneInActiveTab("row"),
        splitPaneDown: () => splitActivePaneInActiveTab("col"),
        focusSearch: () => {
          if (activeEditorHandle) activeEditorHandle.openSearch();
          else searchInlineRef.current?.focus();
        },
        focusExplorerSearch: () => {
          openSidebarView("explorer");
          requestAnimationFrame(() => explorerRef.current?.focusSearch());
        },
        toggleSidebar,
        toggleHiddenFiles,
        toggleAi: togglePanelAndFocus,
        askAiSelection: onAskFromSelection,
        openSettings: () => void openSettingsWindow(),
        openKeyboardShortcuts: () => void openSettingsWindow("shortcuts"),
        openOnboarding: () => setOnboardingOpen(true),
        spaces,
        activeSpaceId,
        activeViewSpacePresentation:
          activeContextViewSpace?.presentation ?? null,
        openSpacesOverview: () => setSwitcherOpen(true),
        newSpace: handleNewSpace,
        switchSpace: (id) => useSpaces.getState().setActive(id),
        focusNextSpaceSlot: () => focusSpaceSlot(1),
        focusPreviousSpaceSlot: () => focusSpaceSlot(-1),
        toggleFocusedSpaceView,
        extractFocusedSpaceMember,
        moveFocusedSpaceMember,
        closeFocusedSpaceMember,
        editorActions: activeEditorHandle
          ? {
              openSearch: activeEditorHandle.openSearch,
              openGotoLine: activeEditorHandle.openGotoLine,
              formatDocument: activeEditorHandle.formatDocument,
              triggerInlineAi: activeEditorHandle.triggerInlineAi,
              triggerQuickFix: activeEditorHandle.triggerQuickFix,
              triggerSignatureHelp: activeEditorHandle.triggerSignatureHelp,
              triggerLspNavigation: activeEditorHandle.triggerLspNavigation,
              triggerLspPeek: activeEditorHandle.triggerLspPeek,
              triggerAiComplete: activeEditorHandle.triggerAiComplete,
              triggerCodeComplete: activeEditorHandle.triggerCodeComplete,
              runEditCommand: activeEditorHandle.runEditCommand,
              runInlineSuggestionCommand:
                activeEditorHandle.runInlineSuggestionCommand,
              splitGroup: (direction) =>
                editorGroupHandleRef.current?.split(direction),
              closeGroup: () => editorGroupHandleRef.current?.closeActive(),
              focusGroup: (delta) =>
                editorGroupHandleRef.current?.focusNext(delta),
            }
          : null,
      }),
    [
      tabs,
      hasComposer,
      effectiveActiveId,
      searchTarget,
      explorerRoot,
      home,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openNewEditor,
      pickAndOpenFile,
      openQuickOpen,
      openWorkspaceSearch,
      openOutline,
      openProblems,
      revealActiveFileInExplorer,
      openRunDebug,
      navigateEditorBack,
      navigateEditorForward,
      navigationAvailability,
      openPreviewTab,
      openActiveTabsLaunchpad,
      openGitGraphFromContext,
      toggleSourceControl,
      handleCloseTabOrPane,
      reopenClosedEditor,
      handleToggleLockTab,
      splitActivePaneInActiveTab,
      activeEditorHandle,
      openSidebarView,
      toggleSidebar,
      toggleHiddenFiles,
      togglePanelAndFocus,
      onAskFromSelection,
      spaces,
      activeSpaceId,
      activeContextViewSpace,
      handleNewSpace,
      focusSpaceSlot,
      toggleFocusedSpaceView,
      extractFocusedSpaceMember,
      moveFocusedSpaceMember,
      closeFocusedSpaceMember,
    ],
  );

  const shell = (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-frame text-foreground">
          {!zenMode && (
            <Header
              tabs={tabs}
              activeId={effectiveActiveId}
              onSelect={jumpToTab}
              onNew={openNewTab}
              onNewShell={openNewShellTab}
              onNewWsl={openNewWslTab}
              onNewBlock={openNewBlockTab}
              onNewPrivate={openNewPrivateTab}
              onNewPreview={() => openPreviewTab("")}
              onNewEditor={openNewEditor}
              onNewApiClient={() => newApiClientTab()}
              onNewRdp={(opts) => newRdpTab(opts)}
              onConnectRemote={() => setGuestConnectOpen(true)}
              onShareTerminal={handleShareTerminal}
              onOpenFile={pickAndOpenFile}
              onOpenFolder={pickAndOpenFolder}
              onNewGitGraph={openGitGraphFromContext}
              onLaunchAgents={launchAgentGroup}
              onClose={handleClose}
              onCloseTabsToRight={handleCloseTabsToRight}
              onCloseOtherTabs={handleCloseOtherTabs}
              onDuplicate={handleDuplicateTab}
              onRename={handleRenameTab}
              onReorder={reorderTabByGap}
              onToggleSidebar={toggleSidebar}
              sidebarCollapsed={sidebarCollapsed}
              onToggleTabStyle={toggleTabStyle}
              tabStyle={tabStyle}
              hideTabStyleToggle={panelOpen}
              onOpenCommandPalette={openCommandPalette}
              onActivateAgent={onActivateAgent}
              onActivateLocalAgent={onActivateLocalAgent}
              onOpenDiff={openGitDiffTab}
              spaceSwitcher={spaceSwitcher}
              onOverrideLanguage={setOverrideLanguage}
              onSetColor={handleSetTabColor}
              onToggleLock={handleToggleLockTab}
              onToggleBlocks={toggleTabBlocks}
              stripEntries={stripEntries}
              viewSpaces={viewSpaces}
              activeStripItem={activeStripItem}
              onSelectSpace={handleSelectViewSpace}
              onExpandSpace={handleExpandViewSpace}
              onRenameSpace={handleRenameViewSpace}
              onSetSpaceColor={handleSetViewSpaceColor}
              onReorderVisual={handleReorderVisualTabs}
              onWorkspaceDrop={handleWorkspaceDrop}
              onPin={(id) => {
                const tab = tabs.find((t) => t.id === id);
                if (tab && (tab.kind === "editor" || tab.kind === "git-diff")) {
                  pinTab(id);
                }
              }}
            />
          )}

          <main className="zoom-content flex min-h-0 flex-1 flex-col">
            <WorkspaceDragLiveRegion viewSpaces={viewSpaces} tabs={tabs} />
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
              onLayoutChanged={(_, { isUserInteraction }) => {
                try {
                  const leftWidth =
                    sidebarRef.current?.getSize()?.inPixels ?? 0;
                  if (leftWidth > 0) {
                    persistSidebarWidth(leftWidth, isUserInteraction);
                  }
                  const rightWidth =
                    verticalTabsPanelRef.current?.getSize()?.inPixels ?? 0;
                  if (rightWidth > 0 && isUserInteraction) {
                    persistRightPanelWidth(rightWidth);
                  }
                } catch {
                  // Ignore layout calculation jitter during rapid panel unmount/mount
                }
              }}
            >
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                groupResizeBehavior="preserve-pixel-size"
                defaultSize={
                  initialSidebarCollapsed
                    ? "0px"
                    : `${sidebarWidthRef.current}px`
                }
                minSize={`${SIDEBAR_MIN_WIDTH}px`}
                maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  persistSidebarCollapsed(size.inPixels <= 0);
                }}
              >
                <div className="h-full min-h-0 border-r border-border/30">
                  <div className="voktty-pane flex h-full min-h-0 flex-col">
                    <div className="min-h-0 flex-1 voktty-panel-in">
                      {sidebarView === "explorer" ? (
                        <FileExplorer
                          ref={explorerRef}
                          rootPath={explorerRoot}
                          navigationKey={`${activeSpaceId ?? DEFAULT_SPACE_ID}:${explorerNavigationScopeKey(activeExplorerWorkspaceEnv)}`}
                          workspaceKey={workspaceScopeKey(
                            activeExplorerWorkspaceEnv,
                          )}
                          workspaceId={activeSpaceId ?? DEFAULT_SPACE_ID}
                          workspaceEnv={activeExplorerWorkspaceEnv}
                          onPrepareNavigationRoot={
                            handlePrepareExplorerNavigationRoot
                          }
                          gitStatus={
                            explorerGitDecorations ? sourceControl.status : null
                          }
                          hasGitRepo={sourceControl.hasRepo}
                          onInitGit={sourceControl.initRepository}
                          activeFilePath={explorerActiveFilePath}
                          onOpenFile={(path, pin) =>
                            handleOpenFile(path, pin, {
                              workspaceEnv: activeExplorerWorkspaceEnv,
                            })
                          }
                          onPathRenamed={handlePathRenamed}
                          onPathDeleted={handlePathDeleted}
                          onRevealInTerminal={cdInNewTab}
                          onOpenInSourceControl={
                            handleOpenRepositoryInSourceControl
                          }
                          onOpenGitHistory={handleOpenGitHistoryForPath}
                          onAttachToAgent={handleAttachFileToAgent}
                          onWorkspaceDrop={(source, target) => {
                            void handleWorkspaceDrop(source, target);
                          }}
                          pathDropTarget={terminalPathDropTarget}
                        />
                      ) : sidebarView === "source-control" ? (
                        <SourceControlPanel
                          open
                          sourceControl={sourceControl}
                          onOpenDiff={openGitDiffTab}
                          onOpenGitGraph={openGitGraphFromContext}
                          onOpenFile={handleOpenFile}
                          onNavigateToPath={cdInNewTab}
                          repositoryTarget={sourceControlRepositoryTarget}
                          onFollowRepositoryContext={
                            handleFollowRepositoryContext
                          }
                          dirtyPaths={workspaceSearchDirtyPaths}
                        />
                      ) : sidebarView === "outline" ? (
                        <OutlinePanel
                          active
                          editorId={
                            activeTab?.kind === "editor" ? activeTab.id : null
                          }
                          path={
                            activeTab?.kind === "editor" ? activeTab.path : null
                          }
                          handle={activeEditorHandle}
                          onNavigate={openOutlineSymbol}
                        />
                      ) : sidebarView === "problems" ? (
                        <ProblemsPanel
                          active
                          root={quickOpenRoot}
                          onNavigate={openProblem}
                        />
                      ) : sidebarView === "run-debug" ? (
                        <WorkbenchPanel
                          active
                          root={quickOpenRoot}
                          workspaceKey={workspaceScopeKey(
                            activeTabWorkspaceEnv,
                          )}
                          activeFilePath={activeFilePath}
                          onNavigate={openDapLocation}
                        />
                      ) : null}
                      {workspaceSearchMounted ? (
                        <div
                          className={cn(
                            "h-full min-h-0",
                            sidebarView !== "search" && "hidden",
                          )}
                        >
                          <WorkspaceSearchPanel
                            active={sidebarView === "search"}
                            root={quickOpenRoot}
                            workspace={activeTabWorkspaceEnv}
                            focusRequest={workspaceSearchFocusRequest}
                            dirtyPaths={workspaceSearchDirtyPaths}
                            onOpenHit={openWorkspaceSearchHit}
                          />
                        </div>
                      ) : null}
                    </div>
                    <SidebarRail
                      activeView={sidebarView}
                      onSelectView={handleSidebarViewSelect}
                      changedCount={sourceControl.changedCount}
                      workspaceRoot={quickOpenRoot}
                    />
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle className="group/divider w-1 rounded-full bg-transparent transition-colors duration-[var(--dur-fast)] after:w-4 hover:bg-border">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSidebar();
                  }}
                  title={t("header.toggleSidebar")}
                  className={cn(
                    "absolute top-8 z-30 flex size-5.5 -translate-x-1/2 items-center justify-center rounded-full border border-border/80 bg-popover/95 text-muted-foreground shadow-md backdrop-blur-md transition-all duration-150 cursor-pointer hover:scale-110 hover:bg-accent hover:text-foreground active:scale-95",
                    "opacity-0 pointer-events-none group-hover/divider:opacity-100 group-hover/divider:pointer-events-auto",
                    sidebarCollapsed ? "left-2.5" : "left-1/2",
                  )}
                >
                  <HugeiconsIcon
                    icon={sidebarCollapsed ? ArrowRight01Icon : ArrowLeft01Icon}
                    size={12}
                    strokeWidth={2.2}
                  />
                </button>
              </ResizableHandle>
              <ResizablePanel
                id="workspace"
                groupResizeBehavior="preserve-relative-size"
                defaultSize="78%"
                minSize="30%"
              >
                <div className="h-full min-h-0">
                  <div className="voktty-pane flex h-full min-h-0 flex-col">
                    <div className="relative min-h-0 flex-1">
                      {spaceTabs.length === 0 && !activeViewSpace ? (
                        <EmptyWorkspace
                          projectName={activeSpace?.name}
                          onOpenFile={pickAndOpenFile}
                          onOpenFolder={pickAndOpenFolder}
                          onNewFile={openNewEditor}
                          onNewTerminal={openNewTab}
                          onDropPath={handleDroppedPath}
                        />
                      ) : (
                        <ErrorBoundary name="Workspace">
                          <SpaceWorkspace
                            tabs={tabs}
                            activeId={effectiveActiveId}
                            activeTab={activeTab}
                            viewSpace={activeViewSpace}
                            onFocusSlot={handleFocusViewSlot}
                            onResizeSplit={handleResizeViewSplit}
                            onNewTerminalInSlot={handleNewTerminalInSlot}
                            onNewFileInSlot={handleNewFileInSlot}
                            onSelectExistingTabInSlot={
                              handleSelectExistingTabInSlot
                            }
                            onDropInSlot={handleDropInSlot}
                            viewSpaces={viewSpaces}
                            onExtractSlot={handleExtractTabFromSpace}
                            onMoveSlotToViewSpace={handleMoveTabToViewSpace}
                            onCloseSlot={handleClose}
                            onWorkspaceDrop={handleWorkspaceDrop}
                            registerTerminalHandle={registerTerminalHandle}
                            onSearchReady={handleSearchReady}
                            onCwd={handleTerminalCwd}
                            onTitle={handleTerminalTitle}
                            onExit={handleLeafExit}
                            onFocusLeaf={handleFocusLeaf}
                            registerEditorHandle={registerEditorHandle}
                            registerEditorGroupHandle={
                              registerEditorGroupHandle
                            }
                            onActivateEditorTab={setActiveId}
                            onEditorDirtyChange={handleEditorDirty}
                            onEditorCloseTab={disposeTab}
                            registerPreviewHandle={registerPreviewHandle}
                            onPreviewUrlChange={handlePreviewUrl}
                            onAiDiffAccept={(id) => respondToApproval(id, true)}
                            onAiDiffReject={(id) =>
                              respondToApproval(id, false)
                            }
                            onOpenCommitFile={openCommitFileDiffTab}
                            onGitHistorySearchHandle={setGitHistoryHandle}
                            onSetMarkdownView={setMarkdownView}
                            registerMarkdownHandle={registerMarkdownHandle}
                            onOpenPreview={openPreviewTab}
                            onWorkspaceEdit={handleWorkspaceEditRequest}
                            canNavigateBack={navigationAvailability.canGoBack}
                            canNavigateForward={
                              navigationAvailability.canGoForward
                            }
                            onNavigateBack={navigateEditorBack}
                            onNavigateForward={navigateEditorForward}
                            gitReview={{
                              sourceControl,
                              dirtyPaths: workspaceSearchDirtyPaths,
                              onOpenDiff: openGitDiffTab,
                            }}
                          />
                        </ErrorBoundary>
                      )}
                    </div>

                    <WorkspaceInputBar
                      isBlockTab={isBlockTab}
                      isTerminalTab={isTerminalTab}
                      activeLeafId={activeLeafId}
                      cwd={activeCwd}
                      home={home}
                      hasComposer={hasComposer}
                      panelOpen={panelOpen}
                      keysLoaded={keysLoaded}
                      onConnect={() => void openSettingsWindow("models")}
                    />
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle className="w-1 rounded-full bg-transparent transition-colors duration-[var(--dur-fast)] after:w-4 hover:bg-border" />
              <ResizablePanel
                id="verticalTabs"
                panelRef={verticalTabsPanelRef}
                groupResizeBehavior="preserve-pixel-size"
                defaultSize={
                  panelOpen ||
                  (tabStyle === "vertical" && !verticalTabsCollapsed)
                    ? `${rightPanelWidthRef.current}px`
                    : "0px"
                }
                minSize={`${RIGHT_PANEL_MIN_WIDTH}px`}
                maxSize={`${RIGHT_PANEL_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  setVerticalTabsCollapsed(size.inPixels <= 0);
                }}
              >
                <div className="h-full min-h-0 border-l border-border/30">
                  <div className="voktty-pane flex h-full min-h-0 flex-col">
                    <div className="relative h-full min-h-0">
                      <div
                        className={cn(
                          "h-full min-h-0",
                          panelOpen ? "hidden" : "block",
                        )}
                      >
                        <VerticalTabBar
                          tabs={tabs}
                          activeId={effectiveActiveId}
                          onSelect={jumpToTab}
                          onClose={handleClose}
                          onCloseTabsToRight={handleCloseTabsToRight}
                          onCloseOtherTabs={handleCloseOtherTabs}
                          onDuplicate={handleDuplicateTab}
                          onPin={(id) => {
                            const tab = tabs.find((t) => t.id === id);
                            if (
                              tab &&
                              (tab.kind === "editor" || tab.kind === "git-diff")
                            ) {
                              pinTab(id);
                            }
                          }}
                          onRename={handleRenameTab}
                          onReorder={reorderTabByGap}
                          onSetColor={handleSetTabColor}
                          onToggleLock={handleToggleLockTab}
                          onToggleBlocks={toggleTabBlocks}
                          stripEntries={stripEntries}
                          viewSpaces={viewSpaces}
                          activeStripItem={activeStripItem}
                          onSelectSpace={handleSelectViewSpace}
                          onExpandSpace={handleExpandViewSpace}
                          onRenameSpace={handleRenameViewSpace}
                          onSetSpaceColor={handleSetViewSpaceColor}
                          onReorderVisual={handleReorderVisualTabs}
                          onWorkspaceDrop={handleWorkspaceDrop}
                          onNew={openNewTab}
                          onNewShell={openNewShellTab}
                          onNewWsl={openNewWslTab}
                          onNewBlock={openNewBlockTab}
                          onNewPrivate={openNewPrivateTab}
                          onNewPreview={() => openPreviewTab("")}
                          onNewEditor={openNewEditor}
                          onNewRdp={(opts) => newRdpTab(opts)}
                          onConnectRemote={() => setGuestConnectOpen(true)}
                          onShareTerminal={handleShareTerminal}
                          onOpenFile={pickAndOpenFile}
                          onOpenFolder={pickAndOpenFolder}
                          onNewGitGraph={openGitGraphFromContext}
                          onLaunchAgents={launchAgentGroup}
                        />
                      </div>
                      {aiSidebarMounted && hasComposer && (
                        <div
                          className={cn(
                            "h-full min-h-0",
                            panelOpen ? "block" : "hidden",
                          )}
                        >
                          <ErrorBoundary name="AI Panel">
                            <AiSidebarPanel
                              onClose={closePanel}
                              composer={
                                <WorkspaceInputBar
                                  isBlockTab={isBlockTab}
                                  isTerminalTab={isTerminalTab}
                                  activeLeafId={activeLeafId}
                                  cwd={activeCwd}
                                  home={home}
                                  hasComposer={hasComposer}
                                  panelOpen
                                  keysLoaded={keysLoaded}
                                  onConnect={() =>
                                    void openSettingsWindow("models")
                                  }
                                  placement="sidebar"
                                />
                              }
                            />
                          </ErrorBoundary>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>

          {!zenMode && (
            <StatusBar
              cwd={activeCwd}
              filePath={activeFilePath}
              home={home}
              onCd={sendCd}
              onWorkspaceChange={handleWorkspaceChange}
              onConnectSsh={handleConnectSsh}
              onConnectDocker={handleConnectDocker}
              onConnectRdp={(conn) =>
                newRdpTab({
                  host: conn.host,
                  port: conn.port,
                  username: conn.username,
                  domain: conn.domain,
                  autoConnect: true,
                })
              }
              onNewSsh={() => setNewSshDialogOpen(true)}
              onNewRdp={() => newRdpTab()}
              onNewSerial={() => setSerialDialogOpen(true)}
              activeWorkspaceEnv={activeTerminalTab?.workspaceEnv}
              activeLeafId={activeTerminalTab?.activeLeafId}
              activeEditorId={
                activeTab?.kind === "editor" ? activeTab.id : null
              }
              onEditorGotoLine={() => activeEditorHandle?.openGotoLine()}
              onToggleAi={togglePanelAndFocus}
              onOpenAi={togglePanelAndFocus}
              onOpenSettings={() => void openSettingsWindow()}
              onRunCommand={handleRunTerminalCommand}
              onOpenFile={(path) => openFileTab(path, true)}
              onOpenDevServer={openDevServerPreview}
              onOpenPreview={openPreviewTab}
              searchTarget={searchTarget}
              searchRef={searchInlineRef}
              hasComposer={hasComposer}
              privateActive={
                activeTab?.kind === "terminal" && activeTab.private === true
              }
            />
          )}

          <WindowVibrancyBridge />

          {hasComposer ? (
            <AgentNotificationsBridge
              tabs={tabs}
              activeId={effectiveActiveId}
              onActivate={onActivateAgent}
            />
          ) : null}
          <Toaster position="bottom-right" />

          {hasComposer ? (
            <>
              <AgentRunBridge
                openAiDiffTab={openAiDiffTab}
                closeAiDiffTab={closeAiDiffTab}
              />
              <LocalAgentNotificationsBridge />
            </>
          ) : null}

          {hasComposer && askPresence.mounted ? (
            <SelectionAskAi
              state={askPresence.state}
              x={askPopup?.x ?? 0}
              y={askPopup?.y ?? 0}
              top={askPopup?.top}
              bottom={askPopup?.bottom}
              onAsk={onAskFromSelection}
              onEdit={
                activeTab?.kind === "editor" ? editFromSelection : undefined
              }
              onDismiss={() => setAskPopup(null)}
            />
          ) : null}

          {switcherState && (
            <TabSwitcherHud tabs={tabs} state={switcherState} />
          )}

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            initialMode={commandPaletteMode}
            commandItems={commandItems}
            workspaceRoot={explorerRoot}
            onOpenContentHit={openContentHit}
            insertCommand={isTerminalTab ? handleRunTerminalCommand : null}
          />

          <QuickOpenDialog
            open={quickOpenOpen}
            onOpenChange={setQuickOpenOpen}
            workspaceRoot={quickOpenRoot}
            workspace={activeTabWorkspaceEnv}
            onOpenFile={openQuickOpenFile}
          />

          <WorkspaceTextEditDialog
            request={workspaceEditContext?.request ?? null}
            workspace={workspaceEditContext?.workspace ?? LOCAL_WORKSPACE}
            dirtyPaths={workspaceSearchDirtyPaths}
            onClose={() => setWorkspaceEditContext(null)}
          />

          <ActiveTabsLaunchpad
            open={activeTabsLaunchpadOpen}
            onOpenChange={(open) => {
              setActiveTabsLaunchpadOpen(open);
              if (!open) pendingSpaceSlotRef.current = null;
            }}
            tabs={tabs}
            activeTabId={effectiveActiveId}
            activeSpaceId={activeSpaceId}
            spaces={spaces}
            onSelectTab={handleSelectTabFromLaunchpad}
            onCloseTab={handleClose}
          />

          <NewEditorDialog
            open={newEditorOpen}
            onOpenChange={(open) => {
              setNewEditorOpen(open);
              if (!open) {
                pendingSpaceSlotRef.current = null;
                pendingAdaptiveViewSpaceRef.current = null;
              }
            }}
            rootPath={explorerRoot ?? home}
            onCreated={(path) => {
              const id = openFileTab(path);
              const pending = pendingSpaceSlotRef.current;
              const adaptiveTarget = pendingAdaptiveViewSpaceRef.current;
              pendingSpaceSlotRef.current = null;
              pendingAdaptiveViewSpaceRef.current = null;
              if (pending) {
                window.setTimeout(() => {
                  assignTabToViewSlot(pending.viewSpaceId, pending.slotId, id);
                }, 0);
              } else if (adaptiveTarget) {
                appendCreatedTabToViewSpace(adaptiveTarget, id);
              }
            }}
          />

          <SshConnectionDialog
            open={newSshDialogOpen}
            onOpenChange={setNewSshDialogOpen}
            onSaved={(conn, autoConnect) => {
              if (autoConnect) handleConnectSsh(conn);
            }}
          />

          <SerialConnectModal
            open={serialDialogOpen}
            onOpenChange={setSerialDialogOpen}
            onConnect={handleConnectSerial}
          />
          <GuestConnectDialog
            open={guestConnectOpen}
            onOpenChange={setGuestConnectOpen}
            onConnect={handleConnectGuest}
          />
          <HostShareDialog
            open={hostShareOpen}
            target={hostShareTarget}
            onOpenChange={setHostShareOpen}
          />

          <UpdaterDialog />
          <SettingsModal />
          <OnboardingWizard
            open={onboardingOpen}
            onOpenChange={setOnboardingOpen}
          />

          <CloseDialogs
            tabs={tabs}
            pendingCloseTab={pendingCloseTab}
            onCancelClose={cancelClose}
            onConfirmClose={confirmClose}
            pendingTerminalCloseTab={pendingTerminalCloseTab}
            onCancelTerminalClose={cancelTerminalClose}
            onConfirmTerminalClose={confirmTerminalClose}
            pendingDeleteTabs={pendingDeleteTabs}
            onCancelDeleteClose={cancelDeleteClose}
            onConfirmDeleteClose={confirmDeleteClose}
            pendingCloseMany={pendingCloseMany}
            closeManyConfirming={closeManyConfirming}
            onCancelCloseMany={cancelCloseMany}
            onConfirmCloseMany={confirmCloseMany}
            pendingAppClose={pendingAppClose}
            onCancelAppClose={cancelAppClose}
            onConfirmAppClose={confirmAppClose}
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );

  return (
    <ErrorBoundary name="Voktty Application">
      <AiComposerProvider>{shell}</AiComposerProvider>
    </ErrorBoundary>
  );
}
