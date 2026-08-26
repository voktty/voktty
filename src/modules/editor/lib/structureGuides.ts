import { indentUnit, syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";

export function indentGuideColumns(
  line: string,
  unit: string,
  limit = 12,
): number[] {
  const indent = /^[\t ]*/.exec(line)?.[0] ?? "";
  if (!indent || !unit) return [];
  const depth =
    unit === "\t"
      ? (indent.match(/^\t+/)?.[0].length ?? 0)
      : Math.floor((indent.match(/^ +/)?.[0].length ?? 0) / unit.length);
  const capped = Math.min(Math.max(0, depth), Math.max(0, limit));
  return Array.from({ length: capped }, (_, index) =>
    unit === "\t" ? index + 1 : (index + 1) * unit.length,
  );
}

class IndentGuidesWidget extends WidgetType {
  constructor(readonly columns: number[]) {
    super();
  }

  override eq(other: IndentGuidesWidget): boolean {
    return (
      other.columns.length === this.columns.length &&
      other.columns.every((column, index) => column === this.columns[index])
    );
  }

  toDOM(): HTMLElement {
    const container = document.createElement("span");
    container.className = "cm-voktty-indent-guides";
    for (const column of this.columns) {
      const guide = document.createElement("span");
      guide.className = "cm-voktty-indent-guide";
      guide.style.left = `${column}ch`;
      container.appendChild(guide);
    }
    return container;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function guideDecorations(view: EditorView): DecorationSet {
  const unit = view.state.facet(indentUnit) || "  ";
  const ranges: ReturnType<ReturnType<typeof Decoration.widget>["range"]>[] = [];
  for (const visible of view.visibleRanges) {
    let line = view.state.doc.lineAt(visible.from);
    while (line.from <= visible.to) {
      const columns = indentGuideColumns(line.text, unit);
      if (columns.length > 0 && line.text.trim()) {
        ranges.push(
          Decoration.widget({
            widget: new IndentGuidesWidget(columns),
            side: -1,
          }).range(line.from),
        );
      }
      if (line.to >= view.state.doc.length) break;
      line = view.state.doc.lineAt(line.to + 1);
    }
  }
  return Decoration.set(ranges, true);
}

const guidePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = guideDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = guideDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

class StickyScrollView {
  private readonly panel: HTMLDivElement;

  constructor(private readonly view: EditorView) {
    this.panel = document.createElement("div");
    this.panel.className = "cm-voktty-sticky-scroll";
    this.view.dom.appendChild(this.panel);
    this.render();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) this.render();
  }

  destroy() {
    this.panel.remove();
  }

  private render() {
    const doc = this.view.state.doc;
    const topLine = doc.lineAt(this.view.viewport.from);
    const headings: string[] = [];
    const seen = new Set<number>();
    let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null =
      syntaxTree(this.view.state).resolveInner(topLine.from, 1);
    while (node) {
      if (node.from < topLine.from && node.to > topLine.from) {
        const line = doc.lineAt(node.from);
        const text = line.text.trim();
        if (
          line.number < topLine.number &&
          !seen.has(line.number) &&
          text &&
          !/^[{}()[\],;]+$/.test(text)
        ) {
          headings.push(text.slice(0, 180));
          seen.add(line.number);
        }
      }
      node = node.parent;
    }
    const visible = headings.reverse().slice(-3);
    this.panel.replaceChildren(
      ...visible.map((heading) => {
        const row = document.createElement("div");
        row.textContent = heading;
        return row;
      }),
    );
    this.panel.hidden = visible.length === 0;
  }
}

const stickyScrollPlugin = ViewPlugin.define(
  (view) => new StickyScrollView(view),
);

const structureTheme = EditorView.theme({
  ".cm-voktty-indent-guides": {
    display: "inline-block",
    position: "relative",
    width: "0",
    pointerEvents: "none",
  },
  ".cm-voktty-indent-guide": {
    position: "absolute",
    top: "-0.15em",
    height: "1.5em",
    borderLeft: "1px solid color-mix(in srgb, var(--border) 55%, transparent)",
  },
  ".cm-voktty-sticky-scroll": {
    position: "absolute",
    zIndex: "4",
    top: "0",
    left: "0",
    right: "0",
    paddingLeft: "calc(3rem + 8px)",
    borderBottom: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
    background: "color-mix(in srgb, var(--background) 96%, transparent)",
    boxShadow: "0 2px 5px color-mix(in srgb, black 14%, transparent)",
    color: "var(--muted-foreground)",
    fontFamily: "inherit",
    fontSize: "0.92em",
    lineHeight: "1.45",
    pointerEvents: "none",
    overflow: "hidden",
  },
  ".cm-voktty-sticky-scroll > div": {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

export function structureGuidesExtension(): Extension {
  return [guidePlugin, stickyScrollPlugin, structureTheme];
}
