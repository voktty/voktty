import { Compartment, type Extension, RangeSet, RangeSetBuilder } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";

export type LineChangeType = "added" | "modified" | "deleted";

export class DiffGutterMarker extends GutterMarker {
  constructor(readonly type: LineChangeType) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = `cm-diff-marker cm-diff-${this.type}`;
    return el;
  }
}

const addedMarker = new DiffGutterMarker("added");
const modifiedMarker = new DiffGutterMarker("modified");
const deletedMarker = new DiffGutterMarker("deleted");

/**
 * Computes line-by-line diff between original text and current text.
 * Returns a map from 1-based line number in currentText to change type.
 */
export function computeLineChanges(
  originalText: string,
  currentText: string,
): Map<number, LineChangeType> {
  const changes = new Map<number, LineChangeType>();
  if (originalText === currentText || !originalText) return changes;

  const orig = originalText.split(/\r?\n/);
  const curr = currentText.split(/\r?\n/);

  const n = orig.length;
  const m = curr.length;

  if (n === 0) {
    for (let i = 1; i <= m; i++) changes.set(i, "added");
    return changes;
  }

  // Compute LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (orig[i] === curr[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to identify additions and modifications
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && orig[i - 1] === curr[j - 1]) {
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      const lineNum = j;
      if (i > 0 && dp[i][j - 1] === dp[i - 1][j - 1] && orig[i - 1] !== curr[j - 1] && dp[i - 1][j] === dp[i][j - 1]) {
        changes.set(lineNum, "modified");
        i--;
      } else {
        changes.set(lineNum, "added");
      }
      j--;
    } else {
      if (j > 0 && !changes.has(j)) {
        changes.set(j, "modified");
      }
      i--;
    }
  }

  return changes;
}

export const diffGutterCompartment = new Compartment();

const diffTheme = EditorView.theme({
  ".cm-diff-gutter": {
    width: "4px",
    minWidth: "4px",
    backgroundColor: "transparent !important",
  },
  ".cm-diff-gutter .cm-gutterElement": {
    padding: "0 !important",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  ".cm-diff-marker": {
    width: "3px",
    height: "100%",
    borderRadius: "1px",
  },
  ".cm-diff-added": {
    backgroundColor: "#10b981",
    boxShadow: "0 0 6px rgba(16, 185, 129, 0.4)",
  },
  ".cm-diff-modified": {
    backgroundColor: "#0ea5e9",
    boxShadow: "0 0 6px rgba(14, 165, 233, 0.4)",
  },
  ".cm-diff-deleted": {
    backgroundColor: "#f43f5e",
    height: "2px !important",
    alignSelf: "flex-start",
  },
});

export function createDiffGutter(originalText: string): Extension {
  return [
    diffTheme,
    gutter({
      class: "cm-diff-gutter",
      markers(view) {
        const changes = computeLineChanges(originalText, view.state.doc.toString());
        if (changes.size === 0) return RangeSet.empty;

        const builder = new RangeSetBuilder<GutterMarker>();
        const doc = view.state.doc;

        for (let i = 1; i <= doc.lines; i++) {
          const change = changes.get(i);
          if (change) {
            const line = doc.line(i);
            const marker =
              change === "added"
                ? addedMarker
                : change === "modified"
                  ? modifiedMarker
                  : deletedMarker;
            builder.add(line.from, line.from, marker);
          }
        }

        return builder.finish();
      },
      initialSpacer: () => new DiffGutterMarker("added"),
    }),
  ];
}
