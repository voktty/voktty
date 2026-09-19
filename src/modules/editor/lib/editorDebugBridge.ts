import { lspDebugStats } from "@/modules/lsp/lib/sessionManager";
import { editorDebugStats } from "./editorInstrumentation";

export function collectEditorDiagnostics() {
  const editors = editorDebugStats();
  const lsp = lspDebugStats();
  return {
    ...editors,
    lsp,
    jsHeapBytes:
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize ?? null,
  };
}

/**
 * Also on window, like the terminal counterpart, for a dev build. A release
 * build has no console to call it from, so the command palette is the path
 * that actually works there.
 */
if (typeof window !== "undefined") {
  (window as unknown as { __vokttyEditors?: unknown }).__vokttyEditors =
    collectEditorDiagnostics;
}
