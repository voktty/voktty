/**
 * Editor instrumentation, Milestone 0 of the view-switch fluidity plan.
 *
 * Every editor tab mounts its own CodeMirror and never releases it, so the
 * cost of an open file is paid for the whole session. Before changing that
 * ownership model the plan requires real numbers from the target machine
 * rather than estimates, and this is how they are read.
 *
 * Collection is pull-based: panes register a probe and nothing is computed
 * until someone asks, so an unobserved session pays nothing.
 */

export type EditorProbe = {
  editorId: number;
  path: string;
  workspaceKey: string;
  /** Characters in the live buffer; 0 unless the document reached `ready`. */
  docChars: number;
  dirty: boolean;
  status: string;
  visible: boolean;
};

export type EditorPoolStats = {
  mountedPanes: number;
  dirtyPanes: number;
  visiblePanes: number;
  /** Rough lower bound: JS strings are at least one byte per character. */
  documentBytes: number;
  largestDocumentBytes: number;
  panes: EditorProbe[];
  domEditors: number;
};

const probes = new Map<number, () => EditorProbe>();

export function registerEditorProbe(
  editorId: number,
  probe: () => EditorProbe,
): () => void {
  probes.set(editorId, probe);
  return () => {
    if (probes.get(editorId) === probe) probes.delete(editorId);
  };
}

/** Pure aggregation, so the shape can be asserted without mounting an editor. */
export function summarizeEditorProbes(
  panes: readonly EditorProbe[],
  domEditors: number,
): EditorPoolStats {
  let documentBytes = 0;
  let largestDocumentBytes = 0;
  let dirtyPanes = 0;
  let visiblePanes = 0;
  for (const pane of panes) {
    documentBytes += pane.docChars;
    if (pane.docChars > largestDocumentBytes)
      largestDocumentBytes = pane.docChars;
    if (pane.dirty) dirtyPanes += 1;
    if (pane.visible) visiblePanes += 1;
  }
  return {
    mountedPanes: panes.length,
    dirtyPanes,
    visiblePanes,
    documentBytes,
    largestDocumentBytes,
    panes: [...panes],
    domEditors,
  };
}

export function editorDebugStats(): EditorPoolStats {
  const panes: EditorProbe[] = [];
  for (const probe of probes.values()) {
    try {
      panes.push(probe());
    } catch {
      // A pane mid-unmount must not break the reading of the others.
    }
  }
  const domEditors =
    typeof document === "undefined"
      ? 0
      : document.querySelectorAll(".cm-editor").length;
  return summarizeEditorProbes(panes, domEditors);
}
