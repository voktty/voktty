export { AiDiffStack } from "./AiDiffStackLazy";
export type { EditorPaneHandle } from "./EditorPane";
export { OutlinePanel } from "./OutlinePanelLazy";
export type { IdeSymbol } from "./lib/outlineSymbols";
export { ProblemsPanel } from "./ProblemsPanelLazy";
export {
  collectWorkspaceProblems,
  type IdeProblem,
} from "./lib/problems";
export { EditorStack } from "./EditorStackLazy";
export type { EditorGroupHandle } from "./EditorStack";
export { GitDiffStack } from "./GitDiffStackLazy";
export {
  type DiagnosticCounts,
  useDiagnosticsStore,
} from "./lib/diagnosticsStore";
export {
  DEFAULT_EDITOR_STATUS,
  deriveEditorCursorStatus,
  useEditorStatusStore,
  type EditorStatus,
} from "./lib/editorStatus";
export { useApplyEditorFontSize } from "./lib/useApplyEditorFontSize";
export { NewEditorDialog } from "./NewEditorDialog";
export { useEditorFileSync } from "./useEditorFileSync";
