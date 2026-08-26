import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type RangeSet,
  RangeSetBuilder,
} from "@codemirror/state";
import { EditorView, GutterMarker, gutter, ViewPlugin } from "@codemirror/view";
import { useDapStore, type DapBreakpoint } from "@/modules/workbench/dapStore";

function normalized(path: string): string {
  const slashed = path.replace(/\\/g, "/").replace(/\/$/, "");
  return /^[a-zA-Z]:\//.test(slashed) ? slashed.toLowerCase() : slashed;
}

export function breakpointLinesForPath(
  breakpoints: DapBreakpoint[],
  path: string,
  documentLines: number,
): number[] {
  const target = normalized(path);
  return [
    ...new Set(
      breakpoints
        .filter((breakpoint) => normalized(breakpoint.path) === target)
        .map((breakpoint) => breakpoint.line)
        .filter(
          (line) =>
            Number.isInteger(line) && line >= 1 && line <= documentLines,
        ),
    ),
  ].sort((left, right) => left - right);
}

class BreakpointMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "cm-breakpoint-marker";
    return element;
  }
}

const marker = new BreakpointMarker();
const refreshBreakpoints = StateEffect.define<void>();

function markers(state: EditorState, getPath: () => string) {
  const builder = new RangeSetBuilder<GutterMarker>();
  const lines = breakpointLinesForPath(
    useDapStore.getState().breakpoints,
    getPath(),
    state.doc.lines,
  );
  for (const lineNumber of lines) {
    const line = state.doc.line(lineNumber);
    builder.add(line.from, line.from, marker);
  }
  return builder.finish();
}

export function breakpointGutter(getPath: () => string): Extension {
  const field = StateField.define<RangeSet<GutterMarker>>({
    create: (state) => markers(state, getPath),
    update(value, transaction) {
      if (
        !transaction.docChanged &&
        !transaction.effects.some((effect) => effect.is(refreshBreakpoints))
      ) {
        return value;
      }
      return markers(transaction.state, getPath);
    },
  });

  return [
    field,
    ViewPlugin.fromClass(
      class {
        private unsubscribe: () => void;
        constructor(readonly view: EditorView) {
          let previous = useDapStore.getState().breakpoints;
          this.unsubscribe = useDapStore.subscribe((state) => {
            if (state.breakpoints === previous) return;
            previous = state.breakpoints;
            this.view.dispatch({ effects: refreshBreakpoints.of() });
          });
        }
        destroy() {
          this.unsubscribe();
        }
      },
    ),
    gutter({
      class: "cm-breakpoint-gutter",
      markers: (view) => view.state.field(field),
      initialSpacer: () => marker,
      domEventHandlers: {
        mousedown(view, line) {
          const path = getPath();
          const lineNumber = view.state.doc.lineAt(line.from).number;
          const exists = useDapStore.getState().breakpoints.some(
            (breakpoint) =>
              normalized(breakpoint.path) === normalized(path) &&
              breakpoint.line === lineNumber,
          );
          if (exists) {
            void useDapStore.getState().removeBreakpoint(path, lineNumber);
          } else {
            void useDapStore.getState().addBreakpoint(path, lineNumber);
          }
          return true;
        },
      },
    }),
    EditorView.baseTheme({
      ".cm-breakpoint-gutter": { width: "12px", cursor: "pointer" },
      ".cm-breakpoint-gutter .cm-gutterElement": { padding: "0 2px" },
      ".cm-breakpoint-marker": {
        display: "block",
        width: "7px",
        height: "7px",
        borderRadius: "999px",
        backgroundColor: "var(--destructive)",
      },
    }),
  ];
}
