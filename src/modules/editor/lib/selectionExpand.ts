import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

export function getExpandedRange(
  docText: string,
  from: number,
  to: number,
): { from: number; to: number } | null {
  if (from === 0 && to === docText.length) return null;

  // 1. If cursor is a single point, select current word
  if (from === to) {
    let start = from;
    let end = to;
    while (start > 0 && /[A-Za-z0-9_$]/.test(docText[start - 1])) start--;
    while (end < docText.length && /[A-Za-z0-9_$]/.test(docText[end])) end++;
    if (start < end) return { from: start, to: end };
  }

  // 2. Expand to enclosing quotes or brackets
  const pairs = [
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: "`", close: "`" },
    { open: "(", close: ")" },
    { open: "[", close: "]" },
    { open: "{", close: "}" },
  ];

  let bestRange: { from: number; to: number } | null = null;
  let minDistance = Infinity;

  for (const pair of pairs) {
    let openPos = from - 1;
    while (openPos >= 0) {
      if (docText[openPos] === pair.open) {
        // find matching close
        let closePos = to;
        while (closePos < docText.length) {
          if (docText[closePos] === pair.close) {
            const span = closePos - openPos;
            if (span > to - from && span < minDistance) {
              minDistance = span;
              // If inside quotes/brackets, first expand to inner content, then including delimiters
              if (from > openPos + 1 || to < closePos) {
                bestRange = { from: openPos + 1, to: closePos };
              } else {
                bestRange = { from: openPos, to: closePos + 1 };
              }
            }
            break;
          }
          closePos++;
        }
        break;
      }
      openPos--;
    }
  }

  if (bestRange) return bestRange;

  // 3. Expand to full current line
  let lineStart = from;
  while (lineStart > 0 && docText[lineStart - 1] !== "\n") lineStart--;
  let lineEnd = to;
  while (lineEnd < docText.length && docText[lineEnd] !== "\n") lineEnd++;

  if (lineStart < from || lineEnd > to) {
    return { from: lineStart, to: lineEnd };
  }

  // 4. Expand to entire document
  return { from: 0, to: docText.length };
}

export function expandSelectionCommand(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const next = getExpandedRange(view.state.doc.toString(), from, to);
  if (!next) return false;

  view.dispatch({
    selection: EditorSelection.single(next.from, next.to),
  });
  return true;
}
