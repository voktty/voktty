import { formatPerfSnapshot } from "@/lib/perfSnapshot";
import { t } from "@/modules/i18n";
import { collectEditorDiagnostics } from "@/modules/editor/lib/editorDebugBridge";
import { writeTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";
import { terminalDebugStats } from "@/modules/terminal/lib/useTerminalSession";
import { toast } from "sonner";

/**
 * Collects the renderer-retention counters and puts them on the clipboard.
 *
 * A release build has no console: devtools are not compiled in and the inspect
 * shortcuts and context menu are suppressed, so the window globals these
 * counters also hang off are only reachable from a dev build, whose memory
 * profile is not the one worth measuring.
 */
export async function copyPerfSnapshot(): Promise<void> {
  try {
    const terminal = terminalDebugStats();
    const editor = collectEditorDiagnostics();
    const report = formatPerfSnapshot({
      terminal: {
        poolSize: terminal.poolSize,
        webglContexts: terminal.webglContexts,
        idleSlots: terminal.idleSlots,
        sessionCount: terminal.sessionCount,
        ringBytesTotal: terminal.ringBytesTotal,
        snapshotCharsTotal: terminal.snapshotCharsTotal,
        domCanvases: terminal.domCanvases,
        jsHeapBytes: terminal.jsHeapBytes ?? editor.jsHeapBytes,
      },
      editor: {
        mountedPanes: editor.mountedPanes,
        visiblePanes: editor.visiblePanes,
        dirtyPanes: editor.dirtyPanes,
        documentBytes: editor.documentBytes,
        largestDocumentBytes: editor.largestDocumentBytes,
        domEditors: editor.domEditors,
      },
      lsp: {
        sessions: editor.lsp.sessions.length,
        totalDocuments: editor.lsp.totalDocuments,
        totalRefs: editor.lsp.totalRefs,
      },
      platform: document.documentElement.dataset.platform,
    });
    await writeTerminalClipboard(report);
    toast.success(t("commandPalette.commands.copyPerfSnapshotDone"));
  } catch (error) {
    console.error("[voktty] perf snapshot failed:", error);
    toast.error(t("commandPalette.commands.copyPerfSnapshotFailed"));
  }
}
