import { lspDebugStats } from "@/modules/lsp/lib/sessionManager";
import { editorDebugStats } from "./editorInstrumentation";

/**
 * Exposed in production, like the terminal counterpart: the cost of keeping an
 * editor mounted per open file is the open question of the view-switch
 * fluidity plan, and it can only be settled with numbers from a real machine.
 */
if (typeof window !== "undefined") {
  (window as unknown as { __vokttyEditors?: unknown }).__vokttyEditors = () => {
    const editors = editorDebugStats();
    const lsp = lspDebugStats();
    return {
      ...editors,
      lsp,
      jsHeapBytes:
        (performance as unknown as { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? null,
    };
  };
}
