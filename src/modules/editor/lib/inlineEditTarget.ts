import type { EditorState } from "@codemirror/state";

export type InlineEditProposal = Readonly<{
  text: string;
  apply: () => boolean;
  discard: () => void;
}>;

export function captureInlineEditTarget(state: EditorState) {
  const selection = state.selection.main;
  const range = selection.empty ? state.doc.lineAt(selection.from) : selection;
  const { from, to } = range;
  return {
    document: state.doc,
    from,
    to,
    code: state.doc.sliceString(from, to),
    prefix: state.doc.sliceString(Math.max(0, from - 400), from),
    suffix: state.doc.sliceString(to, Math.min(state.doc.length, to + 400)),
  };
}
