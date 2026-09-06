import {
  type EditorState,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

const setSuggestion = StateEffect.define<string>();

/** A suggestion is only ever offered for a line being typed forward, so the
 * caret has to sit at the very end with nothing selected. */
export function atLineEnd(state: EditorState): boolean {
  const sel = state.selection.main;
  return sel.empty && sel.head === state.doc.length;
}

const suggestionField = StateField.define<string>({
  create: () => "",
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setSuggestion)) return e.value;
    if (!value) return value;
    if (tr.docChanged) {
      const doc = tr.state.doc.toString();
      return doc.length > 0 && value.startsWith(doc) && value.length > doc.length
        ? value
        : "";
    }
    // Moving the caret off the end retires the suggestion rather than just
    // hiding it. Otherwise arrowing back through your own line would revive
    // it, and the next ArrowRight - pressed to move, not to accept - would
    // dump a history entry into a command you were still editing.
    if (tr.selection && !atLineEnd(tr.state)) return "";
    return value;
  },
});

class GhostWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }
  eq(other: GhostWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghost";
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

function tail(state: EditorState): string | null {
  const sugg = state.field(suggestionField, false);
  if (!sugg) return null;
  if (!atLineEnd(state)) return null;
  const doc = state.doc.toString();
  if (doc.length === 0) return null;
  if (!sugg.startsWith(doc) || sugg.length <= doc.length) return null;
  return sugg.slice(doc.length);
}

const ghostDecorations = EditorView.decorations.compute(
  [suggestionField, "doc", "selection"],
  (state): DecorationSet => {
    const t = tail(state);
    if (t === null) return Decoration.none;
    return Decoration.set([
      Decoration.widget({
        widget: new GhostWidget(t),
        side: 1,
      }).range(state.doc.length),
    ]);
  },
);

export function acceptInlineSuggestion(view: EditorView): boolean {
  const t = tail(view.state);
  if (t === null) return false;
  view.dispatch({
    changes: { from: view.state.doc.length, insert: t },
    selection: { anchor: view.state.doc.length + t.length },
    effects: setSuggestion.of(""),
  });
  return true;
}

export function extractNextWordChunk(tail: string): string {
  const match = tail.match(/^(\s*\S+|\s+)/);
  return match ? match[0] : "";
}

export function acceptInlineSuggestionWord(view: EditorView): boolean {
  const t = tail(view.state);
  if (t === null) return false;
  const chunk = extractNextWordChunk(t);
  if (!chunk) return false;
  view.dispatch({
    changes: { from: view.state.doc.length, insert: chunk },
    selection: { anchor: view.state.doc.length + chunk.length },
  });
  return true;
}

function fetcherPlugin(fetch: (line: string) => Promise<string | null>) {
  return ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        if (this.timer) clearTimeout(this.timer);
        const view = update.view;
        const line = view.state.doc.toString();
        if (!line) return;
        if (!atLineEnd(view.state)) return;
        this.timer = setTimeout(() => {
          if (view.state.doc.toString() !== line) return;
          fetch(line)
            .then((sugg) => {
              // The caret can have moved into the line while the lookup was in
              // flight; landing a suggestion then would arm the same accident.
              if (
                sugg &&
                view.state.doc.toString() === line &&
                atLineEnd(view.state)
              ) {
                view.dispatch({ effects: setSuggestion.of(sugg) });
              }
            })
            .catch(() => {});
        }, 70);
      }
      destroy() {
        if (this.timer) clearTimeout(this.timer);
      }
    },
  );
}

export function inlineSuggestion(fetch: (line: string) => Promise<string | null>) {
  return [
    suggestionField,
    ghostDecorations,
    fetcherPlugin(fetch),
    Prec.highest(
      keymap.of([
        { key: "ArrowRight", run: acceptInlineSuggestion },
        { key: "Alt-ArrowRight", run: acceptInlineSuggestionWord },
        { key: "Ctrl-ArrowRight", run: acceptInlineSuggestionWord },
        { key: "End", run: acceptInlineSuggestion },
        { key: "Mod-f", run: acceptInlineSuggestion },
      ]),
    ),
  ];
}
