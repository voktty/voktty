import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import {
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import type {
  DocumentHighlight,
  HighlightColor,
} from "../store/documentHighlightStore";

export const setDocumentHighlightsEffect = StateEffect.define<
  DocumentHighlight[]
>();

const colorClassMap: Record<HighlightColor, string> = {
  yellow: "cm-doc-highlight-yellow",
  green: "cm-doc-highlight-green",
  blue: "cm-doc-highlight-blue",
  pink: "cm-doc-highlight-pink",
  purple: "cm-doc-highlight-purple",
};

function buildDecorations(
  docLength: number,
  highlights: DocumentHighlight[],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const valid = highlights
    .filter((h) => h.from < h.to && h.from >= 0 && h.to <= docLength)
    .sort((a, b) => a.from - b.from || a.to - b.to);

  for (const h of valid) {
    const cls = colorClassMap[h.color] || colorClassMap.yellow;
    builder.add(
      h.from,
      h.to,
      Decoration.mark({
        class: `cm-doc-highlight ${cls}`,
        attributes: {
          "data-highlight-id": h.id,
        },
      }),
    );
  }

  return builder.finish();
}

export const documentHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setDocumentHighlightsEffect)) {
        decorations = buildDecorations(tr.newDoc.length, effect.value);
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const HIGHLIGHT_THEME = EditorView.baseTheme({
  ".cm-doc-highlight": {
    borderRadius: "2px",
    padding: "1px 0",
    transition: "background-color 0.15s ease",
  },
  ".cm-doc-highlight-yellow": {
    backgroundColor: "rgba(234, 179, 8, 0.28)",
    borderBottom: "2px solid rgba(234, 179, 8, 0.75)",
  },
  ".cm-doc-highlight-green": {
    backgroundColor: "rgba(34, 197, 94, 0.28)",
    borderBottom: "2px solid rgba(34, 197, 94, 0.75)",
  },
  ".cm-doc-highlight-blue": {
    backgroundColor: "rgba(56, 189, 248, 0.28)",
    borderBottom: "2px solid rgba(56, 189, 248, 0.75)",
  },
  ".cm-doc-highlight-pink": {
    backgroundColor: "rgba(244, 114, 182, 0.28)",
    borderBottom: "2px solid rgba(244, 114, 182, 0.75)",
  },
  ".cm-doc-highlight-purple": {
    backgroundColor: "rgba(168, 85, 247, 0.28)",
    borderBottom: "2px solid rgba(168, 85, 247, 0.75)",
  },
});

/**
 * Reconciles stored highlight positions with the current document string.
 * If lines shifted due to external edits, searches for the exact highlighted text snippet.
 */
export function reconcileHighlightsWithDoc(
  docString: string,
  highlights: DocumentHighlight[],
): DocumentHighlight[] {
  const result: DocumentHighlight[] = [];
  const docLen = docString.length;

  for (const h of highlights) {
    if (h.to <= docLen && docString.slice(h.from, h.to) === h.text) {
      result.push(h);
      continue;
    }

    if (!h.text) continue;

    // Search for the snippet near original position first
    const searchWindow = 2000;
    const windowStart = Math.max(0, h.from - searchWindow);
    const windowEnd = Math.min(docLen, h.to + searchWindow);
    const localSlice = docString.slice(windowStart, windowEnd);
    const localIdx = localSlice.indexOf(h.text);

    if (localIdx !== -1) {
      const newFrom = windowStart + localIdx;
      const newTo = newFrom + h.text.length;
      result.push({ ...h, from: newFrom, to: newTo });
      continue;
    }

    // Global fallback search
    const globalIdx = docString.indexOf(h.text);
    if (globalIdx !== -1) {
      const newFrom = globalIdx;
      const newTo = newFrom + h.text.length;
      result.push({ ...h, from: newFrom, to: newTo });
    }
  }

  return result;
}

export function documentHighlightExtension(filePath?: string | null): Extension {
  if (!filePath) {
    return [documentHighlightField, HIGHLIGHT_THEME];
  }

  return [
    documentHighlightField,
    HIGHLIGHT_THEME,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        // When document text changes, keep positions updated in memory if needed
      }
    }),
  ];
}
