import { highlightingFor } from "@codemirror/language";
import {
  type Extension,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { type Tag, tags } from "@lezer/highlight";
import {
  normalizeSemanticTokens,
  semanticTokenLegend,
  semanticTokenOffsets,
  type SemanticTokenOffset,
} from "./semanticTokens";

export type SemanticTokensClient = {
  ready: boolean;
  capabilities: unknown;
  initializePromise: Promise<void>;
  textDocumentSemanticTokensFull: (uri: string) => Promise<unknown>;
};

const REQUEST_DELAY_MS = 300;
const setSemanticTokens = StateEffect.define<DecorationSet>();

const semanticTokensField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSemanticTokens)) return effect.value;
    }
    return transaction.docChanged ? Decoration.none : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function tokenTag(type: string): Tag | null {
  switch (type) {
    case "namespace":
      return tags.namespace;
    case "type":
    case "enum":
    case "interface":
    case "struct":
    case "typeParameter":
      return tags.typeName;
    case "class":
      return tags.className;
    case "parameter":
    case "variable":
      return tags.variableName;
    case "property":
    case "enumMember":
    case "event":
      return tags.propertyName;
    case "function":
      return tags.function(tags.variableName);
    case "method":
      return tags.function(tags.propertyName);
    case "macro":
      return tags.macroName;
    case "keyword":
      return tags.keyword;
    case "modifier":
      return tags.modifier;
    case "comment":
      return tags.comment;
    case "string":
      return tags.string;
    case "number":
      return tags.number;
    case "regexp":
      return tags.regexp;
    case "operator":
      return tags.operator;
    case "decorator":
      return tags.annotation;
    default:
      return null;
  }
}

function decoratedTag(token: SemanticTokenOffset): Tag | null {
  let tag = tokenTag(token.type);
  if (!tag) return null;
  if (token.modifiers.includes("readonly")) tag = tags.constant(tag);
  if (
    token.modifiers.includes("declaration") ||
    token.modifiers.includes("definition")
  ) {
    tag = tags.definition(tag);
  }
  return tag;
}

function buildDecorations(
  view: EditorView,
  tokens: readonly SemanticTokenOffset[],
): DecorationSet {
  const ranges = [];
  for (const token of tokens) {
    const tag = decoratedTag(token);
    if (!tag) continue;
    const syntaxClass = highlightingFor(view.state, [tag]);
    const classes = [
      "cm-lsp-semantic-token",
      syntaxClass,
      token.modifiers.includes("deprecated")
        ? "cm-lsp-semantic-deprecated"
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    ranges.push(
      Decoration.mark({ class: classes }).range(token.from, token.to),
    );
  }
  return Decoration.set(ranges, true);
}

class SemanticTokensPlugin {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private destroyed = false;

  constructor(
    private readonly view: EditorView,
    private readonly client: SemanticTokensClient,
    private readonly documentUri: string,
  ) {
    void client.initializePromise.then(
      () => this.schedule(0),
      () => {},
    );
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.transactions.some((transaction) => transaction.reconfigured)
    ) {
      this.schedule(update.docChanged ? REQUEST_DELAY_MS : 0);
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
    const legend = semanticTokenLegend(this.client.capabilities);
    if (this.destroyed || !this.client.ready || !legend) return;
    const snapshot = this.view.state.doc;
    let response: unknown;
    try {
      response = await this.client.textDocumentSemanticTokensFull(
        this.documentUri,
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
    const normalized = normalizeSemanticTokens(response, legend);
    if (!normalized) {
      this.view.dispatch({ effects: setSemanticTokens.of(Decoration.none) });
      return;
    }
    const offsets = semanticTokenOffsets(
      snapshot.toString(),
      normalized.tokens,
    );
    this.view.dispatch({
      effects: setSemanticTokens.of(buildDecorations(this.view, offsets)),
    });
  }
}

export function semanticTokensExtension(
  client: SemanticTokensClient,
  documentUri: string,
): Extension {
  return [
    Prec.high(semanticTokensField),
    ViewPlugin.define(
      (view) => new SemanticTokensPlugin(view, client, documentUri),
    ),
  ];
}
