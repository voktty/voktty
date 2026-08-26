export {
  applyWorkspaceTextEdit,
  dirtyWorkspaceTextEditPaths,
  previewWorkspaceTextEdit,
  workspaceTextEditTargets,
} from "./lib/service";
export { WorkspaceTextEditDialog } from "./components/WorkspaceTextEditDialogLazy";
export { normalizeLspWorkspaceEdit } from "./lib/lspWorkspaceEdit";
export type {
  NormalizedLspWorkspaceEdit,
  WorkspaceTextDocumentEdit,
  WorkspaceTextEdit,
  WorkspaceTextEditFilePreview,
  WorkspaceTextEditOccurrence,
  WorkspaceTextEditOutcome,
  WorkspaceTextEditPreview,
  WorkspaceTextEditRequest,
  WorkspaceTextEditTarget,
} from "./types";
