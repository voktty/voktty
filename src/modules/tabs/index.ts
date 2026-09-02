export { TabBar, TabIcon } from "./TabBar";
export { VerticalTabBar } from "./VerticalTabBar";
export { TabColorBubbles, TAB_PALETTE } from "./TabColorBubbles";
export { TabSwitcherHud } from "./TabSwitcherHud";
export { ActiveTabsLaunchpad } from "./ActiveTabsLaunchpad";
export {
  useTabSwitcher,
  type TabSwitcherState,
} from "./lib/useTabSwitcher";
export {
  useTabProcessStatus,
  type TabProcessStatus,
} from "./lib/useTabProcessStatus";
export { labelFor } from "./lib/tabLabel";
export { getTabPath } from "./lib/tabMetadata";
export {
  MAX_PANES_PER_TAB,
  DEFAULT_SPACE_ID,
  NO_ACTIVE_TAB_ID,
  useTabs,
  nextActiveInSpace,
  planSingleTabClose,
  planCloseTabsToRight,
  planCloseOtherTabs,
  type CloseTabsPlan,
  type SingleTabCloseResult,
  type Tab,
  type TerminalTab,
  type EditorTab,
  type PreviewTab,
  type MarkdownTab,
  type AiDiffTab,
  type GitDiffTab,
  type GitHistoryTab,
  type GitCommitFileDiffTab,
  type RdpTab,
  type ApiClientTab,
  type HarnessTab,
  type AiDiffStatus,
  type TabPatch,
  type OpenFileTabOptions,
  type GitDiffOpenInput,
} from "./lib/useTabs";
export {
  selectLocalTerminalSpawnContext,
  useWorkspaceCwd,
} from "./lib/useWorkspaceCwd";
export { useWindowTitle } from "./lib/useWindowTitle";
export {
  asTabKey,
  asWorkspaceScopeId,
  createTabIdentity,
  createTabKey,
  duplicateTabKeys,
  isTabKey,
  resolveTabKey,
  workspaceScopeIdFromLegacySpace,
  type TabKey,
  type WorkspaceScopeId,
} from "./lib/tabIdentity";
