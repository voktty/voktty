import {
  type Extension,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import {
  inlayHintOffsets,
  type InlayHintOffset,
  normalizeInlayHints,
  supportsInlayHints,
} from "./inlayHints";

type LspPosition = { line: number; character: number };
type LspRange = { start: LspPosition; end: LspPosition };

export type InlayHintsClient = {
  ready: boolean;
  capabilities: unknown;
  initializePromise: Promise<void>;
  textDocumentInlayHints: (uri: string, range: LspRange) => Promise<unknown>;
};

const REQUEST_DELAY_MS = 180;
const VIEWPORT_MARGIN_LINES = 20;
const setInlayHints = StateEffect.define<DecorationSet>();

const inlayHintsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setInlayHints)) return effect.value;
    }
    return transaction.docChanged ? Decoration.none : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

class InlayHintWidget extends WidgetType {
  constructor(private readonly hint: InlayHintOffset) {
    super();
  }

  eq(other: InlayHintWidget): boolean {
    return (
      this.hint.label === other.hint.label &&
      this.hint.kind === other.hint.kind &&
      this.hint.paddingLeft === other.hint.paddingLeft &&
      this.hint.paddingRight === other.hint.paddingRight &&
      this.hint.tooltip === other.hint.tooltip
    );
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = [
      "cm-lsp-inlay-hint",
      this.hint.kind ? `cm-lsp-inlay-${this.hint.kind}` : null,
      this.hint.paddingLeft ? "cm-lsp-inlay-pad-left" : null,
      this.hint.paddingRight ? "cm-lsp-inlay-pad-right" : null,
    ]
      .filter(Boolean)
      .join(" ");
    element.textContent = this.hint.label;
    element.setAttribute("aria-label", this.hint.label);
    if (this.hint.tooltip) element.title = this.hint.tooltip;
    return element;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function positionAt(doc: Text, offset: number): LspPosition {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

function requestedRange(view: EditorView): {
  from: number;
  to: number;
  range: LspRange;
} {
  const doc = view.state.doc;
  const firstVisible = doc.lineAt(view.viewport.from).number;
  const lastVisible = doc.lineAt(view.viewport.to).number;
  const first = Math.max(1, firstVisible - VIEWPORT_MARGIN_LINES);
  const last = Math.min(doc.lines, lastVisible + VIEWPORT_MARGIN_LINES);
  const from = doc.line(first).from;
  const to = doc.line(last).to;
  return {
    from,
    to,
    range: { start: positionAt(doc, from), end: positionAt(doc, to) },
  };
}

function buildDecorations(
  hints: readonly InlayHintOffset[],
  from: number,
  to: number,
): DecorationSet {
  return Decoration.set(
    hints
      .filter((hint) => hint.offset >= from && hint.offset <= to)
      .map((hint) =>
        Decoration.widget({
          widget: new InlayHintWidget(hint),
          side: hint.kind === "parameter" ? -1 : 1,
        }).range(hint.offset),
      ),
    true,
  );
}

class InlayHintsPlugin {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private destroyed = false;

  constructor(
    private readonly view: EditorView,
    private readonly client: InlayHintsClient,
    private readonly documentUri: string,
  ) {
    void client.initializePromise.then(
      () => this.schedule(0),
      () => {},
    );
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.schedule(REQUEST_DELAY_MS);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number): void {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.request(generation);
    }, delay);
  }

  private async request(generation: number): Promise<void> {
    if (
      this.destroyed ||
      !this.client.ready ||
      !supportsInlayHints(this.client.capabilities)
    ) {
      return;
    }
    const snapshot = this.view.state.doc;
    const requested = requestedRange(this.view);
    let response: unknown;
    try {
      response = await this.client.textDocumentInlayHints(
        this.documentUri,
        requested.range,
      );
    } catch {
      return;
    }
    if (
      this.destroyed ||
      generation !== this.generation ||
      this.view.state.doc !== snapshot
    ) {
      return;
    }
    const normalized = normalizeInlayHints(response);
    const hints = inlayHintOffsets(snapshot.toString(), normalized.hints);
    this.view.dispatch({
      effects: setInlayHints.of(
        buildDecorations(hints, requested.from, requested.to),
      ),
    });
  }
}

export function inlayHintsExtension(
  client: InlayHintsClient,
  documentUri: string,
): Extension {
  return [
    inlayHintsField,
    ViewPlugin.define(
      (view) => new InlayHintsPlugin(view, client, documentUri),
    ),
  ];
}
