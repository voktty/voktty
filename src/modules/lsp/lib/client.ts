import { highlightingFor, indentUnit, language } from "@codemirror/language";
import {
  type Extension,
  Facet,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { highlightCode } from "@lezer/highlight";
import {
  LanguageServerClient,
  languageServerPlugin,
} from "codemirror-languageserver";
import {
  normalizeLspWorkspaceEdit,
  type WorkspaceTextEditRequest,
} from "@/modules/workspace-edit";
import type { IdeSymbol } from "@/modules/editor/lib/outlineSymbols";
import { useDiagnosticsStore } from "@/modules/editor/lib/diagnosticsStore";
import { normalizeLspDiagnostics } from "@/modules/editor/lib/problems";
import { t } from "@/modules/i18n";
import { toast } from "sonner";
import {
  boundedCodeActionDiagnostics,
  diagnosticsOverlappingRange,
  type LspRange as CodeActionRange,
  type NativeCodeAction,
  normalizeCodeActions,
  prepareWorkspaceEditForDocument,
  type RawCodeActionDiagnostic,
} from "./codeActions";
import {
  type CodeActionPanelItem,
  codeActionsPanel,
  openCodeActionsPanel,
} from "./codeActionsPanel";
import { readPublishedDiagnostics } from "./diagnostics";
import { inlayHintsExtension } from "./inlayHintsExtension";
import {
  type LspLocation,
  type LspPosition,
  lspLocationLabel,
  normalizeLspLocations,
} from "./locations";
import {
  type LocationItem,
  locationsPanel,
  openLocationsPanel,
} from "./locationsPanel";
import {
  type LspDocumentSymbol,
  type LspSymbolInformation,
  normalizeDocumentSymbols,
  normalizeWorkspaceSymbols,
} from "./symbols";
import { normalizeSignatureHelp } from "./signatureHelp";
import {
  closeSignatureTooltip,
  openSignatureTooltip,
  signatureHelpTooltip,
} from "./signatureHelpTooltip";
import { openRenamePanel, renamePanel } from "./renamePanel";
import { semanticTokensExtension } from "./semanticTokensExtension";
import { fileUriToPath } from "./uri";

export {
  languageServerWithTransport,
  SynchronizationMethod,
} from "codemirror-languageserver";

type LspPos = LspPosition;
type DefinitionResult = unknown;

function offsetOf(doc: Text, pos: LspPos): number {
  if (pos.line >= doc.lines) return doc.length;
  const line = doc.line(pos.line + 1);
  return Math.min(line.from + pos.character, line.to);
}

export type LspFormatResult = "done" | "unsupported";

export async function documentSymbolsForView(
  view: EditorView,
  path: string,
): Promise<IdeSymbol[] | null> {
  const plugin = view.plugin(languageServerPlugin);
  if (!plugin) return null;
  const client = plugin.client as VokttyLspClient;
  if (!client.ready || !client.capabilities?.documentSymbolProvider) {
    return null;
  }
  const result = await client.textDocumentSymbols(plugin.documentUri);
  return normalizeDocumentSymbols(result, path);
}

function positionAt(view: EditorView, offset: number): LspPos {
  const line = view.state.doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

function codeActionRangeAt(view: EditorView): CodeActionRange {
  const selection = view.state.selection.main;
  if (selection.from !== selection.to) {
    return {
      start: positionAt(view, selection.from),
      end: positionAt(view, selection.to),
    };
  }
  const line = view.state.doc.lineAt(selection.head);
  return {
    start: { line: line.number - 1, character: 0 },
    end: { line: line.number - 1, character: line.length },
  };
}

export async function workspaceSymbolsForView(
  view: EditorView,
  query: string,
): Promise<IdeSymbol[] | null> {
  const plugin = view.plugin(languageServerPlugin);
  if (!plugin) return null;
  const client = plugin.client as VokttyLspClient;
  if (!client.ready || !client.capabilities?.workspaceSymbolProvider) {
    return null;
  }
  const result = await client.workspaceSymbols(query);
  return normalizeWorkspaceSymbols(result);
}

export type OpenCodeActionsResult =
  | "opened"
  | "empty"
  | "unsupported"
  | "error";

function disabledReasonForAction(
  action: NativeCodeAction,
  snapshot: string,
  documentUri: string,
  canResolve: boolean,
): string | null {
  if (action.disabledReason) return action.disabledReason;
  if (action.command) return t("editor.codeActions.commandUnsupported");
  if (!action.edit) {
    return action.needsResolve && canResolve
      ? null
      : t("editor.codeActions.invalidEdit");
  }
  const prepared = prepareWorkspaceEditForDocument(
    snapshot,
    documentUri,
    action.edit,
  );
  if (prepared.kind === "requires-preview") {
    return t("editor.codeActions.requiresPreview");
  }
  if (prepared.kind === "invalid" || prepared.kind === "none") {
    return t("editor.codeActions.invalidEdit");
  }
  return null;
}

async function resolveCodeAction(
  client: VokttyLspClient,
  action: NativeCodeAction,
): Promise<NativeCodeAction> {
  if (!action.needsResolve) return action;
  const resolved = await client.codeActionResolve(action.payload);
  return normalizeCodeActions([resolved])[0] ?? action;
}

async function applyCodeAction(
  view: EditorView,
  client: VokttyLspClient,
  action: NativeCodeAction,
  documentUri: string,
  snapshot: Text,
): Promise<void> {
  let resolved: NativeCodeAction;
  try {
    resolved = await resolveCodeAction(client, action);
  } catch (error) {
    toast.error(t("editor.codeActions.resolveFailed"), {
      description: String(error),
    });
    return;
  }
  if (view.state.doc !== snapshot) {
    toast.warning(t("editor.codeActions.documentChanged"));
    return;
  }
  if (resolved.command) {
    toast.warning(t("editor.codeActions.commandUnsupported"));
    return;
  }
  const prepared = prepareWorkspaceEditForDocument(
    snapshot.toString(),
    documentUri,
    resolved.edit,
  );
  if (prepared.kind === "requires-preview") {
    toast.warning(t("editor.codeActions.requiresPreview"));
    return;
  }
  if (prepared.kind !== "applicable") {
    toast.error(t("editor.codeActions.invalidEdit"));
    return;
  }
  view.dispatch({ changes: prepared.changes });
  view.focus();
  toast.success(t("editor.codeActions.applied"));
}

export async function openNativeCodeActions(
  view: EditorView,
  onAiFallback: () => void,
): Promise<OpenCodeActionsResult> {
  const plugin = view.plugin(languageServerPlugin);
  if (!plugin) return "unsupported";
  const client = plugin.client as VokttyLspClient;
  if (!client.ready || !client.capabilities?.codeActionProvider) {
    return "unsupported";
  }
  const snapshot = view.state.doc;
  const range = codeActionRangeAt(view);
  let response: unknown[] | null;
  try {
    response = await client.textDocumentCodeAction({
      textDocument: { uri: plugin.documentUri },
      range,
      context: {
        diagnostics: diagnosticsOverlappingRange(
          client.diagnosticsForDocument(plugin.documentUri),
          range,
        ),
        triggerKind: 1,
      },
    });
  } catch (error) {
    toast.error(t("editor.codeActions.requestFailed"), {
      description: String(error),
    });
    return "error";
  }
  if (view.state.doc !== snapshot) return "empty";
  const actions = normalizeCodeActions(response);
  if (actions.length === 0) return "empty";

  const snapshotText = snapshot.toString();
  const provider = client.capabilities?.codeActionProvider;
  const canResolve =
    typeof provider === "object" && provider.resolveProvider === true;
  const items: CodeActionPanelItem[] = actions.map((action) => ({
    id: action.id,
    title: action.title,
    detail: action.kind,
    preferredLabel: action.preferred ? t("editor.codeActions.preferred") : null,
    disabledReason: disabledReasonForAction(
      action,
      snapshotText,
      plugin.documentUri,
      canResolve,
    ),
    onPick: () =>
      applyCodeAction(view, client, action, plugin.documentUri, snapshot),
  }));
  items.push({
    id: "voktty.ai-fallback",
    title: t("editor.codeActions.fixWithAi"),
    detail: t("editor.codeActions.activeModel"),
    preferredLabel: null,
    disabledReason: null,
    onPick: onAiFallback,
  });
  openCodeActionsPanel(view, {
    pos: view.state.selection.main.head,
    title: t("editor.codeActions.title"),
    items,
  });
  return "opened";
}

const signatureRequestGeneration = new WeakMap<EditorView, number>();

async function requestSignatureHelp(
  view: EditorView,
  triggerKind: number,
  triggerCharacter?: string,
  isRetrigger = false,
): Promise<boolean> {
  const plugin = view.plugin(languageServerPlugin);
  if (!plugin) return false;
  const client = plugin.client as VokttyLspClient;
  if (!client.ready || !client.capabilities?.signatureHelpProvider) {
    return false;
  }
  const snapshot = view.state.doc;
  const position = view.state.selection.main.head;
  const generation = (signatureRequestGeneration.get(view) ?? 0) + 1;
  signatureRequestGeneration.set(view, generation);
  const response = await client.textDocumentSignatureHelp({
    textDocument: { uri: plugin.documentUri },
    position: positionAt(view, position),
    context: {
      triggerKind,
      ...(triggerCharacter ? { triggerCharacter } : {}),
      isRetrigger,
    },
  });
  if (
    signatureRequestGeneration.get(view) !== generation ||
    view.state.doc !== snapshot ||
    view.state.selection.main.head !== position
  ) {
    return true;
  }
  const help = normalizeSignatureHelp(response);
  if (!help) {
    closeSignatureTooltip(view);
    return true;
  }
  openSignatureTooltip(view, {
    pos: position,
    help,
    labels: {
      previous: t("editor.signatureHelp.previous"),
      next: t("editor.signatureHelp.next"),
      close: t("editor.signatureHelp.close"),
    },
  });
  return true;
}

export async function requestSignatureHelpForView(
  view: EditorView,
): Promise<boolean> {
  return requestSignatureHelp(view, 1);
}

function insertedSignatureTrigger(
  update: ViewUpdate,
  triggerCharacters: readonly string[],
  retriggerCharacters: readonly string[],
): { character: string; retrigger: boolean } | null {
  let trigger: { character: string; retrigger: boolean } | null = null;
  update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (inserted.length !== 1) return;
    const character = inserted.toString();
    if (retriggerCharacters.includes(character)) {
      trigger = { character, retrigger: true };
    } else if (triggerCharacters.includes(character)) {
      trigger = { character, retrigger: false };
    }
  });
  return trigger;
}

function signatureHelpTriggers(client: VokttyLspClient): Extension {
  return ViewPlugin.define(() => ({
    update(update) {
      if (!update.docChanged || !client.ready) return;
      const provider = client.capabilities?.signatureHelpProvider;
      if (!provider || typeof provider !== "object") return;
      const trigger = insertedSignatureTrigger(
        update,
        provider.triggerCharacters ?? [],
        provider.retriggerCharacters ?? [],
      );
      if (!trigger) return;
      void requestSignatureHelp(
        update.view,
        2,
        trigger.character,
        trigger.retrigger,
      ).catch(() => {});
    },
  }));
}

// The lib's formatDocument command fires and forgets; save needs to await
// the edits before writing to disk. "unsupported" surfaces servers that
// simply have no formatter (pyright) so the UI can say so instead of
// silently doing nothing.
export async function formatDocumentAndWait(
  view: EditorView,
): Promise<LspFormatResult> {
  const plugin = view.plugin(languageServerPlugin);
  if (!plugin) return "unsupported";
  const { client } = plugin;
  if (!client.ready || !client.capabilities?.documentFormattingProvider) {
    return "unsupported";
  }
  const doc = view.state.doc;
  const edits = await client.textDocumentFormatting({
    textDocument: { uri: plugin.documentUri },
    options: {
      tabSize: view.state.tabSize,
      insertSpaces: view.state.facet(indentUnit) !== "\t",
    },
  });
  if (!edits || edits.length === 0) return "done";
  // Edits are offsets into the requested snapshot; typing during the
  // round-trip would corrupt the document.
  if (view.state.doc !== doc) return "done";
  view.dispatch({
    changes: edits.map((e) => ({
      from: offsetOf(doc, e.range.start),
      to: offsetOf(doc, e.range.end),
      insert: e.newText,
    })),
  });
  return "done";
}

function highlightBlock(el: HTMLElement, view: EditorView): void {
  const lang = view.state.facet(language);
  const code = el.textContent;
  if (!lang || !code) return;
  const frag = document.createDocumentFragment();
  highlightCode(
    code,
    lang.parser.parse(code),
    { style: (tags) => highlightingFor(view.state, tags) },
    (text, classes) => {
      if (!classes) {
        frag.appendChild(document.createTextNode(text));
        return;
      }
      const span = document.createElement("span");
      span.className = classes;
      span.textContent = text;
      frag.appendChild(span);
    },
    () => frag.appendChild(document.createTextNode("\n")),
  );
  el.replaceChildren(frag);
}

// Tooltip docs arrive as plain markdown-rendered code; tokenize them with
// the file's own parser so signatures match the editor theme. Tooltips are
// direct children of the editor DOM, so the outer observer never fires on
// typing; the subtree observer lives only while a tooltip is mounted.
const hoverCodeHighlight = ViewPlugin.define((view) => {
  const seen = new WeakSet<HTMLElement>();
  const inner = new Map<Element, MutationObserver>();

  const scan = (root: Element) => {
    const blocks = root.querySelectorAll<HTMLElement>(
      ".documentation pre code",
    );
    for (const el of blocks) {
      if (seen.has(el)) continue;
      seen.add(el);
      highlightBlock(el, view);
    }
  };

  const outer = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (
          !(node instanceof Element) ||
          !node.classList.contains("cm-tooltip")
        ) {
          continue;
        }
        scan(node);
        const ob = new MutationObserver(() => scan(node));
        ob.observe(node, { childList: true, subtree: true });
        inner.set(node, ob);
      }
      for (const node of m.removedNodes) {
        if (!(node instanceof Element)) continue;
        inner.get(node)?.disconnect();
        inner.delete(node);
      }
    }
  });
  outer.observe(view.dom, { childList: true });

  return {
    destroy: () => {
      outer.disconnect();
      for (const ob of inner.values()) ob.disconnect();
      inner.clear();
    },
  };
});

const setLinkRange = StateEffect.define<{ from: number; to: number } | null>();
const linkMark = Decoration.mark({ class: "cm-lsp-link" });

const linkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setLinkRange)) {
        return e.value
          ? Decoration.set([linkMark.range(e.value.from, e.value.to)])
          : Decoration.none;
      }
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function currentLink(view: EditorView): { from: number; to: number } | null {
  const iter = view.state.field(linkField).iter();
  return iter.value ? { from: iter.from, to: iter.to } : null;
}

function updateLink(view: EditorView, event: MouseEvent | null): void {
  const prev = currentLink(view);
  let next: { from: number; to: number } | null = null;
  if (event && (event.metaKey || event.ctrlKey)) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos != null) next = view.state.wordAt(pos);
  }
  if (prev?.from === next?.from && prev?.to === next?.to) return;
  view.dispatch({ effects: setLinkRange.of(next) });
}

// Cmd/Ctrl-hover underlines the symbol under the pointer, matching the
// mod-click go-to-definition affordance.
const linkHover: Extension = [
  linkField,
  EditorView.domEventHandlers({
    mousemove: (event, view) => updateLink(view, event),
    keyup: (event, view) => {
      if (event.key === "Meta" || event.key === "Control") {
        updateLink(view, null);
      }
    },
    mouseleave: (_e, view) => updateLink(view, null),
  }),
  EditorView.theme({
    ".cm-lsp-link": {
      textDecoration: "underline",
      textUnderlineOffset: "2.5px",
      color: "var(--primary)",
      cursor: "pointer",
    },
  }),
];

export type LspNavigationKind =
  | "definition"
  | "typeDefinition"
  | "implementation"
  | "references";

export type LspNavigationResult = "opened" | "empty" | "unsupported" | "error";

export type LspPeekKind = "definition" | "references";

export type LspPeekItem = {
  uri: string;
  path: string;
  line: number;
  character: number;
  label: string;
};

export type LspPeekResult =
  | { status: "ready"; items: LspPeekItem[]; truncated: boolean }
  | { status: "empty" | "unsupported" | "error" | "stale" };

type LspNavigationHandler = (
  view: EditorView,
  kind: LspNavigationKind,
) => Promise<LspNavigationResult>;

const lspNavigationHandlers = Facet.define<
  LspNavigationHandler,
  readonly LspNavigationHandler[]
>();

type LspPeekHandler = (
  view: EditorView,
  kind: LspPeekKind,
) => Promise<LspPeekResult>;

const lspPeekHandlers = Facet.define<
  LspPeekHandler,
  readonly LspPeekHandler[]
>();

type LspPeekOpenHandler = (view: EditorView, item: LspPeekItem) => boolean;

const lspPeekOpenHandlers = Facet.define<
  LspPeekOpenHandler,
  readonly LspPeekOpenHandler[]
>();

export async function lspNavigateForView(
  view: EditorView,
  kind: LspNavigationKind,
): Promise<LspNavigationResult> {
  const handler = view.state.facet(lspNavigationHandlers)[0];
  return handler ? handler(view, kind) : "unsupported";
}

export async function lspPeekForView(
  view: EditorView,
  kind: LspPeekKind,
): Promise<LspPeekResult> {
  const handler = view.state.facet(lspPeekHandlers)[0];
  return handler ? handler(view, kind) : { status: "unsupported" };
}

export function lspOpenPeekItemForView(
  view: EditorView,
  item: LspPeekItem,
): boolean {
  const handler = view.state.facet(lspPeekOpenHandlers)[0];
  return handler?.(view, item) ?? false;
}

export function lspInteractions(opts: {
  client: VokttyLspClient;
  documentUri: string;
  rootPath: string;
  onNavigate: (uri: string, line: number, column: number) => boolean;
  onWorkspaceEdit?: (request: WorkspaceTextEditRequest) => void;
  semanticTokens: boolean;
  inlayHints: boolean;
}): Extension {
  const navigate = (view: EditorView, loc: LspLocation): boolean => {
    if (
      opts.onNavigate(
        loc.uri,
        loc.range.start.line + 1,
        loc.range.start.character + 1,
      )
    ) {
      return true;
    }
    if (loc.uri === opts.documentUri) {
      const targetLine = Math.min(
        loc.range.start.line + 1,
        view.state.doc.lines,
      );
      const lineObj = view.state.doc.line(targetLine);
      const target = Math.min(
        lineObj.from + loc.range.start.character,
        lineObj.to,
      );
      view.dispatch({
        selection: { anchor: target },
        effects: EditorView.scrollIntoView(target, { y: "center" }),
      });
      view.focus();
      return true;
    }
    return false;
  };

  const label = (loc: LspLocation): string => {
    const path = fileUriToPath(loc.uri) ?? loc.uri;
    return lspLocationLabel(
      path,
      opts.rootPath,
      loc.range.start.line,
      loc.range.start.character,
    );
  };

  const showResults = (
    view: EditorView,
    title: string,
    locs: LspLocation[],
  ): boolean => {
    if (locs.length === 0) return false;
    if (locs.length === 1) {
      navigate(view, locs[0]);
      return true;
    }
    const byLoc = new Map<string, LspLocation>();
    for (const loc of locs) byLoc.set(label(loc), loc);
    const items: LocationItem[] = [...byLoc.entries()]
      .map(([text, loc]) => ({
        uri: loc.uri,
        line: loc.range.start.line,
        character: loc.range.start.character,
        label: text,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    openLocationsPanel(view, {
      title,
      items,
      onPick: (item) =>
        navigate(view, {
          uri: item.uri,
          range: { start: { line: item.line, character: item.character } },
        }),
    });
    return true;
  };

  const navigationCapability = (kind: LspNavigationKind): boolean => {
    if (!opts.client.ready) return false;
    const capabilities = opts.client.capabilities;
    if (kind === "definition") return !!capabilities.definitionProvider;
    if (kind === "typeDefinition") {
      return !!capabilities.typeDefinitionProvider;
    }
    if (kind === "implementation") {
      return !!capabilities.implementationProvider;
    }
    return !!capabilities.referencesProvider;
  };

  const navigationTitle = (kind: LspNavigationKind): string =>
    t(`editor.navigation.${kind}`);

  type LocationQueryResult =
    | { status: "ready"; locations: LspLocation[]; truncated: boolean }
    | { status: "empty" | "unsupported" | "error" | "stale" };

  const requestLocationsAt = async (
    view: EditorView,
    pos: number,
    kind: LspNavigationKind,
  ): Promise<LocationQueryResult> => {
    if (!navigationCapability(kind)) return { status: "unsupported" };
    const snapshot = view.state.doc;
    const params = {
      textDocument: { uri: opts.documentUri },
      position: positionAt(view, pos),
    };
    let result: DefinitionResult;
    try {
      if (kind === "definition") {
        result = await opts.client.textDocumentDefinition(params);
      } else if (kind === "typeDefinition") {
        result = await opts.client.textDocumentTypeDefinition(params);
      } else if (kind === "implementation") {
        result = await opts.client.textDocumentImplementation(params);
      } else {
        result = await opts.client.textDocumentReferences({
          ...params,
          context: { includeDeclaration: true },
        });
      }
    } catch (error) {
      toast.error(t("editor.navigation.requestFailed"), {
        description: String(error),
      });
      return { status: "error" };
    }
    if (view.state.doc !== snapshot) return { status: "stale" };
    const normalized = normalizeLspLocations(result);
    if (normalized.locations.length === 0) return { status: "empty" };
    return {
      status: "ready",
      locations: normalized.locations,
      truncated: normalized.truncated,
    };
  };

  const navigateAt = async (
    view: EditorView,
    pos: number,
    kind: LspNavigationKind,
  ): Promise<LspNavigationResult> => {
    const result = await requestLocationsAt(view, pos, kind);
    if (result.status !== "ready") {
      if (result.status === "unsupported") {
        toast.info(t("editor.navigation.unavailable"));
        return "unsupported";
      }
      if (result.status === "error") return "error";
      if (result.status === "empty") {
        toast.info(t("editor.navigation.empty"));
      }
      return "empty";
    }
    if (result.truncated) {
      toast.warning(t("editor.navigation.resultsTruncated"));
    }
    showResults(view, navigationTitle(kind), result.locations);
    return "opened";
  };

  const navigateFromCursor: LspNavigationHandler = (view, kind) =>
    navigateAt(view, view.state.selection.main.head, kind);

  const peekFromCursor: LspPeekHandler = async (view, kind) => {
    const result = await requestLocationsAt(
      view,
      view.state.selection.main.head,
      kind,
    );
    if (result.status !== "ready") return result;
    const maxItems = 500;
    const items: LspPeekItem[] = [];
    for (const loc of result.locations) {
      try {
        const path = fileUriToPath(loc.uri);
        if (!path) continue;
        items.push({
          uri: loc.uri,
          path,
          line: loc.range.start.line,
          character: loc.range.start.character,
          label: label(loc),
        });
      } catch {
        continue;
      }
      if (items.length >= maxItems) break;
    }
    if (items.length === 0) return { status: "empty" };
    items.sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.line - b.line ||
        a.character - b.character,
    );
    return {
      status: "ready",
      items,
      truncated: result.truncated || result.locations.length > maxItems,
    };
  };

  const openPeekItem: LspPeekOpenHandler = (view, item) => {
    return navigate(view, {
      uri: item.uri,
      range: { start: { line: item.line, character: item.character } },
    });
  };

  const performRename = async (
    view: EditorView,
    position: number,
    previousName: string,
    newName: string,
  ): Promise<void> => {
    const snapshot = view.state.doc;
    let result: unknown;
    try {
      result = await opts.client.textDocumentRename({
        textDocument: { uri: opts.documentUri },
        position: positionAt(view, position),
        newName,
      });
    } catch (error) {
      toast.error(t("editor.rename.requestFailed"), {
        description: String(error),
      });
      return;
    }
    if (view.state.doc !== snapshot) {
      toast.warning(t("editor.rename.documentChanged"));
      return;
    }
    const normalized = normalizeLspWorkspaceEdit(opts.rootPath, result);
    if (normalized.kind === "empty") {
      toast.info(t("editor.rename.noChanges"));
      return;
    }
    if (normalized.kind !== "ready") {
      toast.error(t(`editor.rename.${normalized.reason}`));
      return;
    }
    if (!opts.onWorkspaceEdit) {
      toast.error(t("editor.rename.previewUnavailable"));
      return;
    }
    opts.onWorkspaceEdit({
      root: opts.rootPath,
      sourcePath: fileUriToPath(opts.documentUri) ?? opts.documentUri,
      previousName,
      newName,
      documents: normalized.documents,
      totalEdits: normalized.totalEdits,
    });
  };

  const renameAtCursor = (view: EditorView): boolean => {
    if (!opts.client.ready || !opts.client.capabilities?.renameProvider) {
      toast.info(t("editor.rename.unavailable"));
      return true;
    }
    const position = view.state.selection.main.head;
    const snapshot = view.state.doc;
    const word = view.state.wordAt(position);
    const fallback = word ? view.state.sliceDoc(word.from, word.to) : "";
    const open = (previousName: string) => {
      if (view.state.doc !== snapshot) return;
      openRenamePanel(view, {
        pos: position,
        title: t("editor.rename.title"),
        inputLabel: t("editor.rename.inputLabel"),
        submitLabel: t("editor.rename.preview"),
        placeholder: previousName,
        onSubmit: (newName) =>
          performRename(view, position, previousName, newName),
      });
    };
    const provider = opts.client.capabilities.renameProvider;
    if (typeof provider !== "object" || provider.prepareProvider !== true) {
      open(fallback);
      return true;
    }
    void opts.client
      .textDocumentPrepareRename({
        textDocument: { uri: opts.documentUri },
        position: positionAt(view, position),
      })
      .then((prepared) => {
        const placeholder = prepareRenamePlaceholder(snapshot, prepared);
        if (placeholder !== null) open(placeholder || fallback);
      })
      .catch((error) => {
        toast.error(t("editor.rename.prepareFailed"), {
          description: String(error),
        });
      });
    return true;
  };

  return [
    locationsPanel,
    codeActionsPanel,
    signatureHelpTooltip,
    renamePanel,
    signatureHelpTriggers(opts.client),
    ...(opts.semanticTokens
      ? [semanticTokensExtension(opts.client, opts.documentUri)]
      : []),
    ...(opts.inlayHints
      ? [inlayHintsExtension(opts.client, opts.documentUri)]
      : []),
    lspNavigationHandlers.of(navigateFromCursor),
    lspPeekHandlers.of(peekFromCursor),
    lspPeekOpenHandlers.of(openPeekItem),
    hoverCodeHighlight,
    linkHover,
    keymap.of([
      {
        key: "F2",
        preventDefault: true,
        run: renameAtCursor,
      },
      {
        key: "Shift-Alt-f",
        preventDefault: true,
        run: (view) => {
          void formatDocumentAndWait(view);
          return true;
        },
      },
    ]),
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) {
          return false;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        void navigateAt(view, pos, "definition");
        return true;
      },
    }),
  ];
}

function prepareRenamePlaceholder(doc: Text, value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.placeholder === "string") return candidate.placeholder;
  const rawRange =
    candidate.range && typeof candidate.range === "object"
      ? (candidate.range as Record<string, unknown>)
      : candidate;
  const start = rawRange.start as LspPos | undefined;
  const end = rawRange.end as LspPos | undefined;
  if (!start || !end) return candidate.defaultBehavior === true ? "" : null;
  const from = offsetOf(doc, start);
  const to = offsetOf(doc, end);
  return to >= from ? doc.sliceString(from, to) : null;
}

type RawRpc = {
  notify(method: string, params: unknown): Promise<void>;
  request(method: string, params: unknown, timeout: number): Promise<unknown>;
};

type ClientNotification = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params: unknown;
};

type DiagnosticsContext = {
  owner: string;
  root: string;
};

// The lib's notify/request maps omit didClose, didSave and the
// shutdown/exit handshake; servers need all three for correct lifecycle.
export class VokttyLspClient extends LanguageServerClient {
  static hostPid: number | null = null;
  private diagnosticsContext: DiagnosticsContext | null = null;
  private publishedDiagnostics = new Map<string, RawCodeActionDiagnostic[]>();

  setDiagnosticsContext(context: DiagnosticsContext): void {
    this.diagnosticsContext = context;
  }

  clearPublishedDiagnostics(): void {
    this.publishedDiagnostics.clear();
    if (!this.diagnosticsContext) return;
    useDiagnosticsStore
      .getState()
      .clearProblemOwner(this.diagnosticsContext.owner);
  }

  protected override processNotification(
    notification: ClientNotification,
  ): void {
    const published = readPublishedDiagnostics(notification);
    const context = this.diagnosticsContext;
    if (published && context) {
      const diagnostics = boundedCodeActionDiagnostics(published.diagnostics);
      if (diagnostics.length > 0) {
        this.publishedDiagnostics.set(published.uri, diagnostics);
      } else {
        this.publishedDiagnostics.delete(published.uri);
      }
      let path: string | null = null;
      try {
        path = fileUriToPath(published.uri);
      } catch {
        path = null;
      }
      if (path) {
        useDiagnosticsStore
          .getState()
          .publishProblems(
            context.owner,
            context.root,
            path,
            normalizeLspDiagnostics(path, published.diagnostics),
          );
      }
    }
    super.processNotification(notification as never);
  }

  // The lib omits the publishDiagnostics capability and servers like
  // typescript-language-server push no diagnostics without it. processId
  // enables the server-side parent watchdog.
  protected override getInitializeParams() {
    const params = super.getInitializeParams();
    params.processId = VokttyLspClient.hostPid;
    params.capabilities.textDocument = {
      ...params.capabilities.textDocument,
      publishDiagnostics: { relatedInformation: true },
      codeAction: {
        dynamicRegistration: false,
        isPreferredSupport: true,
        disabledSupport: true,
        dataSupport: true,
        resolveSupport: { properties: ["edit", "command"] },
        codeActionLiteralSupport: {
          codeActionKind: {
            valueSet: [
              "",
              "quickfix",
              "refactor",
              "refactor.extract",
              "refactor.inline",
              "refactor.rewrite",
              "source",
              "source.organizeImports",
              "source.fixAll",
            ],
          },
        },
      },
      references: { dynamicRegistration: false },
      definition: { dynamicRegistration: false, linkSupport: true },
      typeDefinition: { dynamicRegistration: false, linkSupport: true },
      implementation: { dynamicRegistration: false, linkSupport: true },
      documentSymbol: {
        dynamicRegistration: false,
        hierarchicalDocumentSymbolSupport: true,
      },
      semanticTokens: {
        dynamicRegistration: false,
        requests: { range: false, full: { delta: false } },
        tokenTypes: [
          "namespace",
          "type",
          "class",
          "enum",
          "interface",
          "struct",
          "typeParameter",
          "parameter",
          "variable",
          "property",
          "enumMember",
          "event",
          "function",
          "method",
          "macro",
          "keyword",
          "modifier",
          "comment",
          "string",
          "number",
          "regexp",
          "operator",
          "decorator",
        ],
        tokenModifiers: [
          "declaration",
          "definition",
          "readonly",
          "static",
          "deprecated",
          "abstract",
          "async",
          "modification",
          "documentation",
          "defaultLibrary",
        ],
        formats: ["relative"],
        overlappingTokenSupport: false,
        multilineTokenSupport: false,
        serverCancelSupport: true,
        augmentsSyntaxTokens: true,
      },
      inlayHint: { dynamicRegistration: false },
    };
    params.capabilities.workspace = {
      ...params.capabilities.workspace,
      applyEdit: false,
      workspaceEdit: {
        documentChanges: true,
        failureHandling: "textOnlyTransactional",
        normalizesLineEndings: true,
      },
      symbol: { dynamicRegistration: false },
    };
    return params;
  }

  textDocumentReferences(params: {
    textDocument: { uri: string };
    position: LspPos;
    context: { includeDeclaration: boolean };
  }): Promise<LspLocation[] | null> {
    return this.raw.request(
      "textDocument/references",
      params,
      10_000,
    ) as Promise<LspLocation[] | null>;
  }

  textDocumentImplementation(params: {
    textDocument: { uri: string };
    position: LspPos;
  }): Promise<unknown> {
    return this.raw.request("textDocument/implementation", params, 10_000);
  }

  textDocumentSemanticTokensFull(uri: string): Promise<unknown> {
    return this.raw.request(
      "textDocument/semanticTokens/full",
      { textDocument: { uri } },
      15_000,
    );
  }

  textDocumentInlayHints(
    uri: string,
    range: { start: LspPos; end: LspPos },
  ): Promise<unknown> {
    return this.raw.request(
      "textDocument/inlayHint",
      { textDocument: { uri }, range },
      10_000,
    );
  }

  textDocumentSymbols(
    uri: string,
  ): Promise<Array<LspDocumentSymbol | LspSymbolInformation> | null> {
    return this.raw.request(
      "textDocument/documentSymbol",
      { textDocument: { uri } },
      10_000,
    ) as Promise<Array<LspDocumentSymbol | LspSymbolInformation> | null>;
  }

  workspaceSymbols(query: string): Promise<LspSymbolInformation[] | null> {
    return this.raw.request("workspace/symbol", { query }, 10_000) as Promise<
      LspSymbolInformation[] | null
    >;
  }

  diagnosticsForDocument(uri: string): RawCodeActionDiagnostic[] {
    return this.publishedDiagnostics.get(uri) ?? [];
  }

  textDocumentCodeAction(params: {
    textDocument: { uri: string };
    range: CodeActionRange;
    context: {
      diagnostics: RawCodeActionDiagnostic[];
      triggerKind: number;
    };
  }): Promise<unknown[] | null> {
    return this.raw.request(
      "textDocument/codeAction",
      params,
      10_000,
    ) as Promise<unknown[] | null>;
  }

  codeActionResolve(action: Record<string, unknown>): Promise<unknown> {
    return this.raw.request("codeAction/resolve", action, 10_000);
  }

  textDocumentSignatureHelp(params: {
    textDocument: { uri: string };
    position: LspPos;
    context: {
      triggerKind: number;
      triggerCharacter?: string;
      isRetrigger: boolean;
    };
  }): Promise<unknown> {
    return this.raw.request("textDocument/signatureHelp", params, 10_000);
  }

  textDocumentDidClose(uri: string): void {
    void this.raw.notify("textDocument/didClose", { textDocument: { uri } });
  }

  textDocumentDidSave(uri: string): void {
    void this.raw.notify("textDocument/didSave", { textDocument: { uri } });
  }

  async shutdownGracefully(timeoutMs = 2000): Promise<void> {
    try {
      await this.raw.request("shutdown", null, timeoutMs);
      await this.raw.notify("exit", null);
    } catch {
      // Server already dead or unresponsive; the transport kill follows.
    }
  }

  private get raw(): RawRpc {
    return this as unknown as RawRpc;
  }
}
