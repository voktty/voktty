export { SpaceWorkspace } from "./components/SpaceWorkspace";
export { WorkspaceDragLiveRegion } from "./components/WorkspaceDropOverlay";
export {
  planWorkspaceDrop,
  slotIdForTab,
  type WorkspaceDropPlan,
  type WorkspaceDropReason,
} from "./lib/planWorkspaceDrop";
export {
  calculateSpaceGeometry,
  type SpaceGeometry,
  type SpaceGeometryOptions,
  type SpaceSlotPlacement,
  type SpaceSplitHandlePlacement,
  updateSpaceSplitRatio,
  type WorkspacePlacement,
  type WorkspaceRect,
} from "./lib/spaceGeometry";
export {
  asSlotId,
  asViewSpaceId,
  collectLayoutSlots,
  createSlot,
  createSplit,
  mapLayoutSlots,
  type SlotId,
  type SpaceLayoutNode,
  type SpaceValidationIssue,
  type SpaceValidationIssueCode,
  updateLayoutSplitRatio,
  type ViewSpace,
  type ViewSpaceId,
  validateViewSpaces,
} from "./lib/spaceLayout";
export {
  buildSpaceMenuModels,
  type SpaceMenuModel,
  type SpaceMenuPresentation,
} from "./lib/spaceMenuModel";
export {
  assignMemberToSlot,
  closeSpaceMember,
  createViewSpace,
  deleteViewSpace,
  expandViewSpace,
  extractSpaceMember,
  focusViewSpaceSlot,
  openViewSpace,
  splitSpaceSlot,
  swapSpaceSlots,
} from "./lib/spaceOperations";
export type { ActiveStripItem, StripEntry } from "./lib/spaceProjection";
export type { SpaceMeta } from "./lib/store";
export { useSpacePersistence } from "./lib/useSpacePersistence";
export { useSpaces } from "./lib/useSpaces";
export { useSpacesBoot } from "./lib/useSpacesBoot";
export { useWorkspaceDrag } from "./lib/useWorkspaceDrag";
export {
  MAX_VISIBLE_TERMINAL_LEAVES,
  projectPaneBudget,
  tabAssignmentPaneBudget,
  terminalLeafCount,
  viewSpacePaneBudget,
  visibleTerminalLeafCount,
  type PaneBudget,
  type PaneBudgetTab,
} from "./lib/spacePaneBudget";
export {
  isDroppedResourceStatCompatible,
  type DroppedResourceStatKind,
} from "./lib/resourceDrop";
export {
  beginWorkspaceDrag,
  cancelWorkspaceDrag,
  finishWorkspaceDrag,
  getWorkspaceDragState,
  subscribeWorkspaceDrag,
  updateWorkspaceDragTarget,
  type WorkspaceDragSource,
  type WorkspaceDragState,
  type WorkspaceDropTarget,
  workspaceDragSourceForTab,
} from "./lib/workspaceDrag";
export { SpaceAvatar } from "./SpaceAvatar";
export { SpaceSwitcher } from "./SpaceSwitcher";
