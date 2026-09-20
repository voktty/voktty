/**
 * Synchronous access to the editor find handlers without importing CodeMirror.
 *
 * The harness shell binds these to a keydown and to a menu event, and importing
 * `editorSearch` for them pulled the whole CodeMirror stack into the graph
 * parsed on the first click, before the harness could paint.
 *
 * Both handlers resolve the active editor from the DOM and do nothing when
 * there is none, and the only surface that mounts an editor imports
 * `editorSearch` itself. So "not registered yet" means "no editor is open",
 * and answering false is the same answer the real handler would give, not a
 * dropped keystroke.
 */

export type EditorSearchHandlers = {
  handleEditorFindKey: (event: KeyboardEvent) => boolean;
  openFindInActiveEditor: () => boolean;
};

let handlers: EditorSearchHandlers | null = null;

/** Called by `editorSearch` as it is evaluated, so no caller has to remember. */
export function registerEditorSearchHandlers(next: EditorSearchHandlers): void {
  handlers = next;
}

export function handleEditorFindKey(event: KeyboardEvent): boolean {
  return handlers?.handleEditorFindKey(event) ?? false;
}

export function openFindInActiveEditor(): boolean {
  return handlers?.openFindInActiveEditor() ?? false;
}

/** Test seam: drops the registration so a case can assert the unloaded path. */
export function resetEditorSearchHandlers(): void {
  handlers = null;
}
