export type EditorSelectionLocation = {
  anchor: number;
  head: number;
};

export function editorSelectionForLocation(
  lineFrom: number,
  lineTo: number,
  column: number,
  matchLength: number,
): EditorSelectionLocation {
  const anchor = Math.min(lineTo, lineFrom + Math.max(0, column - 1));
  const head = Math.min(lineTo, anchor + Math.max(0, matchLength));
  return { anchor, head };
}
