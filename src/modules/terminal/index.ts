export * from "./copilot";
export {
  type AgentTabStatus,
  tabAgentStatus,
  useAgentActivityStore,
} from "./lib/agentActivity";
export {
  findLeafCwd,
  hasLeaf,
  isLeaf,
  leafIds,
  type PaneBounds,
  type PaneId,
  type PaneNode,
  type SplitDir,
} from "./lib/panes";
export {
  extractProgressFromText,
  type LeafProcessInfo,
  type ProcessState,
  parseOsc9Progress,
  useTerminalProgressStore,
} from "./lib/terminalProgressStore";
export {
  type TerminalPathDropTarget,
  useTerminalFileDrop,
} from "./lib/useTerminalFileDrop";
export {
  clearFocusedTerminal,
  disposeSession,
  getLeafTerminalStats,
  leafCwd,
  leafHasForegroundProcess,
  leafHasKnownActivity,
  leafIdForPty,
  navigateFocusedBlocks,
  ptyIdForLeaf,
  respawnSession,
  waitForLeafConnection,
  whenSessionReady,
  writeToSession,
} from "./lib/useTerminalSession";
export { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
export { TerminalStack } from "./TerminalStack";
