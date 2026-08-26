import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { endpointIdFromCompatModel } from "@/modules/ai/config";
import {
  isAiRuntimeAvailable,
  useAiAvailable,
} from "@/modules/ai/lib/runtimeAvailability";
import { getCustomEndpointKey, getKey } from "@/modules/ai/lib/keyring";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useTranslation } from "@/modules/i18n";
import type { WorkspaceTextEditRequest } from "@/modules/workspace-edit";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  lspFormatDocument,
  lspNavigate,
  lspOpenPeekItem,
  lspOpenCodeActions,
  lspPeek,
  lspRequestSignatureHelp,
  useLspExtension,
} from "@/modules/lsp";
import type { LspPeekItem, LspPeekKind } from "@/modules/lsp/lib/client";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";
import { playVokttySound } from "@/modules/sound";
import { acceptCompletion, startCompletion } from "@codemirror/autocomplete";
import {
  addCursorAbove,
  addCursorBelow,
  copyLineDown,
  copyLineUp,
  moveLineDown,
  moveLineUp,
  redo,
  simplifySelection,
  undo,
} from "@codemirror/commands";
import {
  findNext,
  findPrevious,
  gotoLine,
  openSearchPanel,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  Alert02Icon,
  BookOpen01Icon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  CodeIcon,
  Copy01Icon,
  PlayIcon,
  RefreshIcon,
  Search01Icon,
  Shield01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { vim } from "@replit/codemirror-vim";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { Button } from "@/components/ui/button";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { EditorBreadcrumbs } from "./components/EditorBreadcrumbs";
import type { PeekDocumentState } from "./components/PeekPanel";
import { InlineAiWidget } from "./components/InlineAiWidget";
import {
  buildQuickFixPrompt,
  getDiagnosticsAtCursor,
  resolveQuickFixRange,
} from "./lib/agenticQuickFix";
import {
  acceptInlineSuggestion,
  acceptInlineSuggestionPart,
  dismissInlineSuggestion,
  inlineCompletion,
  triggerInlineCompletion,
} from "./lib/autocomplete/inlineExtension";
import { resolveAutocompleteSelection } from "./lib/autocomplete/selection";
import { useCompletionStatusStore } from "./lib/autocomplete/statusStore";
import {
  type CurrentSymbol,
  resolveCurrentSymbol,
} from "./lib/breadcrumbs/symbolResolver";
import { extractDocumentSymbols, type IdeSymbol } from "./lib/outlineSymbols";
import { diagnosticsReporter } from "./lib/diagnosticsReporter";
import { useDiagnosticsStore } from "./lib/diagnosticsStore";
import { createDiffGutter, diffGutterCompartment } from "./lib/diffGutter";
import { breakpointGutter } from "./lib/breakpointGutter";
import { editorSelectionForLocation } from "./lib/editorLocation";
import {
  deriveEditorCursorStatus,
  useEditorStatusStore,
} from "./lib/editorStatus";
import {
  buildSharedExtensions,
  DEFAULT_INDENT,
  indentCompartment,
  indentExtension,
  languageCompartment,
  lspCompartment,
  minimapCompartment,
  vimCompartment,
  wordWrapExtension,
  wrapCompartment,
} from "./lib/extensions";
import {
  applyFormattedContent,
  readFileText,
  resolveFormatter,
  runExternalFormatter,
} from "./lib/externalFormat";
import { detectIndentUnit } from "./lib/indent";
import { requestInlineEdit } from "./lib/inlineEditService";
import { type LanguageResult, resolveLanguage } from "./lib/languageResolver";
import { loadMinimapExtension } from "./lib/minimap";
import { expandSelectionCommand } from "./lib/selectionExpand";
import { editorSnippetExtension } from "./lib/snippetExtension";
import { structureGuidesExtension } from "./lib/structureGuides";
import { normalizeEditorViewState } from "./lib/editorViewState";
import {
  loadEditorViewState,
  saveEditorViewState,
} from "./lib/editorViewStateStore";
import { sendActiveEditorCodeToTerminal } from "./lib/terminalExecution";
import { FORCE_READ_LIMIT, useDocument } from "./lib/useDocument";
import { useEditorThemeExt } from "./lib/useEditorThemeExt";
import { initVimGlobals, vimHandlersExtension } from "./lib/vim";
import { classifyMediaExtension, MediaPreview } from "./MediaPreview";
import { PeekPanel } from "./PeekPanelLazy";
import { buildPeekExcerpt, samePeekPath } from "./lib/peekModel";
import { readPeekFile } from "./lib/peekFile";

initVimGlobals();

export type EditorEditCommand =
  | "addCursorAbove"
  | "addCursorBelow"
  | "clearMultipleCursors"
  | "moveLineUp"
  | "moveLineDown"
  | "copyLineUp"
  | "copyLineDown"
  | "expandSelection";

export type InlineSuggestionCommand =
  | "accept"
  | "acceptLine"
  | "acceptToken"
  | "dismiss";

function runEditorEditCommand(
  view: EditorView,
  command: EditorEditCommand,
): boolean {
  switch (command) {
    case "addCursorAbove":
      return addCursorAbove(view);
    case "addCursorBelow":
      return addCursorBelow(view);
    case "clearMultipleCursors":
      return simplifySelection(view);
    case "moveLineUp":
      return moveLineUp(view);
    case "moveLineDown":
      return moveLineDown(view);
    case "copyLineUp":
      return copyLineUp(view);
    case "copyLineDown":
      return copyLineDown(view);
    case "expandSelection":
      return expandSelectionCommand(view);
  }
}

function runInlineSuggestionCommand(
  view: EditorView,
  command: InlineSuggestionCommand,
): boolean {
  switch (command) {
    case "accept":
      return acceptInlineSuggestion(view);
    case "acceptLine":
      return acceptInlineSuggestionPart(view, "line");
    case "acceptToken":
      return acceptInlineSuggestionPart(view, "token");
    case "dismiss":
      return dismissInlineSuggestion(view);
  }
}

export type EditorSearchMatchInfo = {
  current: number;
  total: number;
};

export type EditorPaneHandle = {
  setQuery: (q: string) => EditorSearchMatchInfo | void;
  findNext: () => EditorSearchMatchInfo | void;
  findPrevious: () => EditorSearchMatchInfo | void;
  clearQuery: () => void;
  /** Open CodeMirror's find/replace panel. */
  openSearch: () => void;
  /** Open CodeMirror's go-to-line panel. */
  openGotoLine: () => void;
  focus: () => void;
  getSelection: () => string | null;
  getPath: () => string;
  getLocation: () => { line: number; column: number };
  getDevelopmentBuffer: () => Promise<
    import("@/modules/ai/lib/developmentContext").DevelopmentBuffer | null
  >;
  getDocumentSymbols: () => Promise<{
    source: "lsp" | "fallback";
    symbols: IdeSymbol[];
  }>;
  getWorkspaceSymbols: (query: string) => Promise<IdeSymbol[] | null>;
  subscribeDocumentChanges: (listener: () => void) => () => void;
  /** Re-read the file from disk. */
  reload: (force?: boolean) => boolean | Promise<boolean>;
  /** Notify that the file was modified externally. */
  notifyExternalChange: () => void;
  /** Check if the file was modified externally on disk. */
  checkExternalChange: () => Promise<boolean>;
  /** Move the cursor to a 1-based line and center it, once content is ready. */
  gotoLine: (line: number, options?: { focus?: boolean }) => void;
  /** Move to a 1-based line/column and select an optional match range. */
  gotoLocation: (
    line: number,
    column: number,
    matchLength?: number,
    options?: { focus?: boolean },
  ) => void;
  /** Apply CodeMirror's undo/redo commands. */
  undo: () => void;
  redo: () => void;
  /** Request an AI ghost suggestion at the cursor. */
  triggerAiComplete: () => void;
  /** Open CodeMirror's completion popup. */
  triggerCodeComplete: () => void;
  /** Open Inline AI widget with optional initial prompt. */
  triggerInlineAi: (initialPrompt?: string) => void;
  /** Run the configured formatter for this document. */
  formatDocument: () => void;
  /** Show native code actions, falling back to the active AI model. */
  triggerQuickFix: () => void;
  /** Show parameter information from the active language server. */
  triggerSignatureHelp: () => void;
  /** Navigate through semantic locations provided by the language server. */
  triggerLspNavigation: (
    kind: "definition" | "typeDefinition" | "implementation" | "references",
  ) => void;
  /** Show semantic locations without leaving the current editor. */
  triggerLspPeek: (kind: "definition" | "references") => void;
  runEditCommand: (command: EditorEditCommand) => void;
  runInlineSuggestionCommand: (command: InlineSuggestionCommand) => void;
};

type Props = {
  editorId: number;
  spaceId: string;
  path: string;
  workspaceEnv: WorkspaceEnv;
  overrideLanguage?: string | null;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  onClose?: () => void;
  onOpenPreview?: (url: string) => void;
  onWorkspaceEdit?: (request: WorkspaceTextEditRequest) => void;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
};

// Above this, syntax highlighting and LSP are disabled: a multi-MB lezer
// parse tree and a didOpen of that size cost far more than they give.
const SYNTAX_MAX_BYTES = 4 * 1024 * 1024;
const EMPTY_DIAG: { errors: number; warnings: number } = {
  errors: 0,
  warnings: 0,
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function safeCompletionError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(
      /(?:api[-_ ]?key|authorization|bearer)\s*[:=]\s*\S+/gi,
      "[redacted]",
    )
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 320);
}

function getCmSearchMatchInfo(
  view: EditorView,
  search: string,
): EditorSearchMatchInfo {
  if (!search) return { current: 0, total: 0 };
  const sq = new SearchQuery({ search, caseSensitive: false });
  const cursor = sq.getCursor(view.state.doc);
  let total = 0;
  let current = 0;
  const selFrom = view.state.selection.main.from;
  let m = cursor.next();
  while (!m.done) {
    total++;
    if (m.value.from <= selFrom) {
      current = total;
    }
    m = cursor.next();
  }
  if (current === 0 && total > 0) current = 1;
  return { current, total };
}

// memo: EditorStack passes identity-stable props, so background editors
// skip re-rendering entirely when App re-renders (terminal events, tab churn).
export const EditorPane = memo(
  forwardRef<EditorPaneHandle, Props>(function EditorPane(props, ref) {
    const {
      editorId,
      spaceId,
      path,
      workspaceEnv,
      overrideLanguage,
      onDirtyChange,
      onSaved,
      onClose,
      onOpenPreview,
      onWorkspaceEdit,
      canNavigateBack,
      canNavigateForward,
      onNavigateBack,
      onNavigateForward,
    } = props;
    const { t } = useTranslation();

    const {
      doc,
      dirty,
      eol,
      externalChange,
      notifyExternalChange,
      dismissExternalChange,
      checkExternalChange,
      onChange,
      save,
      reload,
      adoptDiskText,
      openAnyway,
      retry,
      cancelRead,
    } = useDocument({
      path,
      workspaceEnv,
      onDirtyChange,
    });
    const reloadRef = useRef(reload);
    reloadRef.current = reload;
    const adoptDiskTextRef = useRef(adoptDiskText);
    adoptDiskTextRef.current = adoptDiskText;
    const cmRef = useRef<ReactCodeMirrorRef>(null);
    const documentChangeListenersRef = useRef(new Set<() => void>());
    const viewStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
    const viewStateRestoredRef = useRef<string | null>(null);
    const themeExt = useEditorThemeExt();
    const aiAvailable = useAiAvailable();
    const vimMode = usePreferencesStore((s) => s.vimMode);
    const showMinimap = usePreferencesStore((s) => s.editorMinimap);
    const wordWrapColumn = usePreferencesStore((s) =>
      s.editorWordWrap ? s.editorWordWrapColumn : null,
    );
    const languageRef = useRef<string | null>(null);
    const [langId, setLangId] = useState<string | null>(null);
    const [currentSymbol, setCurrentSymbol] = useState<CurrentSymbol | null>(
      null,
    );
    const currentSymbolRef = useRef<CurrentSymbol | null>(null);
    const [inlineAiOpen, setInlineAiOpen] = useState(false);
    const [inlineAiPrompt, setInlineAiPrompt] = useState<string | undefined>(
      undefined,
    );
    const [peekSession, setPeekSession] = useState<{
      kind: LspPeekKind;
      items: LspPeekItem[];
      activeIndex: number;
    } | null>(null);
    const [peekDocument, setPeekDocument] = useState<PeekDocumentState>({
      status: "loading",
    });
    const peekRequestRef = useRef(0);
    const peekFileCacheRef = useRef(new Map<string, string>());
    const diagCounts = useDiagnosticsStore((s) => s.byPath[path] ?? EMPTY_DIAG);
    const apiKeyRef = useRef<string | null>(null);
    const completionErrorRef = useRef<(error: unknown) => void>(() => {});
    completionErrorRef.current = (error) => {
      toast.error(
        t("feedback.errorIn", {
          name: t("settings.models.autocomplete"),
        }),
        {
          description:
            safeCompletionError(error) || t("feedback.somethingWentWrong"),
        },
      );
    };

    useEffect(
      () => () => useCompletionStatusStore.getState().remove(editorId),
      [editorId],
    );

    useEffect(() => {
      let cancelled = false;
      const refresh = async () => {
        const s = usePreferencesStore.getState();
        const provider = s.autocompleteProvider;
        if (
          provider === "lmstudio" ||
          provider === "mlx" ||
          provider === "ollama"
        ) {
          apiKeyRef.current = null;
          return;
        }
        // OpenAI-compatible keys live in a per-endpoint keyring slot.
        if (provider === "openai-compatible") {
          const eid = endpointIdFromCompatModel(s.autocompleteModelId);
          const k = eid ? await getCustomEndpointKey(eid) : null;
          if (!cancelled) apiKeyRef.current = k;
          return;
        }
        const k = await getKey(provider);
        if (!cancelled) apiKeyRef.current = k;
      };
      void refresh();
      let unlistenKeys: (() => void) | undefined;
      void onKeysChanged(() => void refresh()).then((un) => {
        if (cancelled) un();
        else unlistenKeys = un;
      });
      const unsubPrefs = usePreferencesStore.subscribe((state, prev) => {
        if (
          state.autocompleteProvider !== prev.autocompleteProvider ||
          state.autocompleteModelId !== prev.autocompleteModelId
        ) {
          void refresh();
        }
      });
      return () => {
        cancelled = true;
        unlistenKeys?.();
        unsubPrefs();
      };
    }, []);
    // Stabilize save + onSaved via refs so the extensions array never changes
    // identity — a new identity makes @uiw/react-codemirror reconfigure the
    // whole state, wiping the language compartment.
    const saveRef = useRef(save);
    saveRef.current = save;
    const onSavedRef = useRef(onSaved);
    onSavedRef.current = onSaved;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const lspActiveRef = useRef(false);
    const warnedNoLspRef = useRef(false);
    const warnedNoFormatRef = useRef(false);
    const docContent = doc.status === "ready" ? doc.content : "";
    const docSize = doc.status === "ready" ? doc.size : 0;

    const performSave = useCallback(async () => {
      const view = cmRef.current?.view;
      const prefs = usePreferencesStore.getState();
      const formatter = resolveFormatter(languageRef.current, prefs);
      if (prefs.editorFormatOnSave && formatter === "lsp" && view) {
        if (lspActiveRef.current) {
          let res: "done" | "unsupported" = "done";
          try {
            res = await lspFormatDocument(view);
          } catch (e) {
            toast.error(t("feedback.editorLanguageServerFormatFailed"), {
              description: String(e),
            });
          }
          if (res === "unsupported" && !warnedNoFormatRef.current) {
            warnedNoFormatRef.current = true;
            toast.warning(t("feedback.editorFormatOnSaveSkipped"), {
              description: t("feedback.editorNoFormatter"),
            });
          }
        } else if (!warnedNoLspRef.current) {
          warnedNoLspRef.current = true;
          toast.warning(t("feedback.editorFormatOnSaveSkipped"), {
            description: t("feedback.editorNoLanguageServer"),
          });
        }
      }
      // Snapshot before save: edits typed during the formatter round-trip
      const docAtSave = view?.state.doc;
      const saved = await saveRef.current();
      if (!saved) return;
      initialContentRef.current = view ? view.state.doc.toString() : docContent;
      if (view) {
        view.dispatch({
          effects: diffGutterCompartment.reconfigure(
            createDiffGutter(initialContentRef.current),
          ),
        });
      }
      if (prefs.editorFormatOnSave && formatter !== "lsp") {
        const error = await runExternalFormatter(
          formatter,
          pathRef.current,
          prefs.editorCustomFormatCommand,
        );
        if (error) {
          toast.error(t("feedback.formatterFormatFailed", { formatter }), {
            description: error,
          });
        } else {
          const readBack = await readFileText(pathRef.current);
          if (readBack !== null && view && view.state.doc === docAtSave) {
            applyFormattedContent(
              view,
              adoptDiskTextRef.current(readBack.text, readBack.mtime),
            );
          }
        }
      }
      onSavedRef.current?.();
      playVokttySound("success", { retrigger: "restart" });
    }, [docContent, t]);
    const performSaveRef = useRef(performSave);
    performSaveRef.current = performSave;

    const pathRef = useRef(path);
    pathRef.current = path;

    const initialContentRef = useRef<string>("");
    useEffect(() => {
      if (doc.status === "ready" && !initialContentRef.current) {
        initialContentRef.current = docContent;
      }
    }, [docContent, doc.status]);

    useEffect(() => {
      if (doc.status !== "ready") return;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: diffGutterCompartment.reconfigure(
          createDiffGutter(initialContentRef.current || docContent),
        ),
      });
    }, [docContent, doc.status]);

    const handleDocChange = useCallback(
      (value: string) => {
        setPeekSession(null);
        onChange(value);
        const view = cmRef.current?.view;
        if (view && initialContentRef.current) {
          view.dispatch({
            effects: diffGutterCompartment.reconfigure(
              createDiffGutter(initialContentRef.current),
            ),
          });
        }
      },
      [onChange],
    );

    const handleReloadFromDisk = useCallback(async () => {
      const res = await reload(true);
      if (res && cmRef.current?.view) {
        const view = cmRef.current.view;
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: res.content,
          },
        });
      }
      dismissExternalChange();
      toast.success(
        t("editor.fileReloadedSuccess", {
          name: path.split(/[\\/]/).pop() ?? path,
        }),
      );
    }, [reload, dismissExternalChange, path, t]);

    useEffect(() => {
      const onFocus = () => {
        void checkExternalChange();
      };
      window.addEventListener("focus", onFocus);
      return () => window.removeEventListener("focus", onFocus);
    }, [checkExternalChange]);

    const handleChatAiAction = useCallback(
      (promptPrefix: string) => {
        if (!isAiRuntimeAvailable()) return;
        const view = cmRef.current?.view;
        const selection = view
          ? view.state.sliceDoc(
              view.state.selection.main.from,
              view.state.selection.main.to,
            )
          : "";
        const textToAttach =
          selection.trim() || (doc.status === "ready" ? doc.content : "");
        const chat = useChatStore.getState();
        chat.attachSelection(textToAttach, "editor");
        chat.focusInput(`${promptPrefix}\n\n`);
      },
      [doc],
    );

    useEffect(() => {
      const handler = (e: Event) => {
        const customEvent = e as CustomEvent<{
          path?: string;
          prompt?: string;
        }>;
        if (
          isAiRuntimeAvailable() &&
          (!customEvent.detail?.path ||
            customEvent.detail.path === pathRef.current)
        ) {
          setInlineAiPrompt(customEvent.detail?.prompt);
          setInlineAiOpen(true);
        }
      };
      window.addEventListener("voktty:editor-inline-ai", handler);
      return () =>
        window.removeEventListener("voktty:editor-inline-ai", handler);
    }, []);

    const openAiQuickFix = useCallback((activeView: EditorView) => {
      if (!isAiRuntimeAvailable()) return;
      const diagnostics = getDiagnosticsAtCursor(activeView);
      const prompt = buildQuickFixPrompt(diagnostics);
      const range = resolveQuickFixRange(activeView, diagnostics);

      activeView.dispatch({
        selection: { anchor: range.from, head: range.to },
      });

      setInlineAiPrompt(prompt);
      setInlineAiOpen(true);
    }, []);

    const handleQuickFix = useCallback(
      async (view?: EditorView) => {
        const activeView = view ?? cmRef.current?.view;
        if (!activeView) return;
        if (lspActiveRef.current) {
          try {
            const result = await lspOpenCodeActions(activeView, () =>
              openAiQuickFix(activeView),
            );
            if (result === "opened" || result === "error") return;
          } catch (error) {
            toast.error(t("editor.codeActions.requestFailed"), {
              description: String(error),
            });
            return;
          }
        }
        openAiQuickFix(activeView);
      },
      [openAiQuickFix, t],
    );

    const handleSignatureHelp = useCallback(async () => {
      const view = cmRef.current?.view;
      if (!view) return;
      try {
        const supported = await lspRequestSignatureHelp(view);
        if (!supported) toast.info(t("editor.signatureHelp.unavailable"));
      } catch (error) {
        toast.error(t("editor.signatureHelp.requestFailed"), {
          description: String(error),
        });
      }
    }, [t]);

    const handleLspNavigation = useCallback(
      async (
        kind: "definition" | "typeDefinition" | "implementation" | "references",
      ) => {
        const view = cmRef.current?.view;
        if (!view) return;
        const result = await lspNavigate(view, kind);
        if (result === "unsupported" && !lspActiveRef.current) {
          toast.info(t("editor.navigation.unavailable"));
        }
      },
      [t],
    );

    const closePeek = useCallback(() => {
      peekRequestRef.current += 1;
      setPeekSession(null);
      requestAnimationFrame(() => cmRef.current?.view?.focus());
    }, []);

    const handleLspPeek = useCallback(
      async (kind: LspPeekKind) => {
        const view = cmRef.current?.view;
        if (!view) return;
        const request = ++peekRequestRef.current;
        const result = await lspPeek(view, kind);
        if (request !== peekRequestRef.current) return;
        if (result.status !== "ready") {
          if (result.status === "unsupported") {
            toast.info(t("editor.navigation.unavailable"));
          } else if (result.status === "empty") {
            toast.info(t("editor.navigation.empty"));
          }
          return;
        }
        if (result.truncated) {
          toast.warning(t("editor.peek.resultsTruncated"));
        }
        setPeekDocument({ status: "loading" });
        setPeekSession({ kind, items: result.items, activeIndex: 0 });
      },
      [t],
    );

    const openPeekItem = useCallback(
      (item: LspPeekItem) => {
        const view = cmRef.current?.view;
        if (!view) return;
        void lspOpenPeekItem(view, item).then((opened) => {
          if (opened) setPeekSession(null);
          else toast.info(t("editor.navigation.unavailable"));
        });
      },
      [t],
    );

    const activePeekItem = peekSession?.items[peekSession.activeIndex];
    useEffect(() => {
      if (!activePeekItem) return;
      let cancelled = false;
      setPeekDocument({ status: "loading" });
      const load = async () => {
        let source: string;
        const samePath = samePeekPath(activePeekItem.path, path);
        if (samePath) {
          const view = cmRef.current?.view;
          if (!view) return;
          source = view.state.doc.toString();
        } else {
          const cached = peekFileCacheRef.current.get(activePeekItem.path);
          if (cached !== undefined) {
            source = cached;
          } else {
            const result = await readPeekFile(activePeekItem.path);
            if (cancelled) return;
            if (result.status !== "ready") {
              setPeekDocument({ status: result.status });
              return;
            }
            source = result.content;
            const cache = peekFileCacheRef.current;
            cache.set(activePeekItem.path, source);
            while (cache.size > 4) {
              const oldest = cache.keys().next().value;
              if (oldest === undefined) break;
              cache.delete(oldest);
            }
          }
        }
        if (cancelled) return;
        const excerpt = buildPeekExcerpt(
          source,
          activePeekItem.line,
          activePeekItem.character,
        );
        setPeekDocument(
          excerpt ? { status: "ready", excerpt } : { status: "invalid" },
        );
      };
      void load().catch(() => {
        if (!cancelled) setPeekDocument({ status: "error" });
      });
      return () => {
        cancelled = true;
      };
    }, [activePeekItem, path]);

    const handleFormatDocument = useCallback(async () => {
      const view = cmRef.current?.view;
      if (!view) return;
      if (lspActiveRef.current) {
        try {
          await lspFormatDocument(view);
        } catch (e) {
          toast.error(t("feedback.editorFormatFailed"), {
            description: String(e),
          });
        }
      } else {
        const prefs = usePreferencesStore.getState();
        const formatter = resolveFormatter(languageRef.current, prefs);
        if (formatter !== "lsp") {
          const err = await runExternalFormatter(
            formatter,
            pathRef.current,
            prefs.editorCustomFormatCommand,
          );
          if (err) {
            toast.error(t("feedback.formatterFormatFailed", { formatter }), {
              description: err,
            });
          } else {
            const readBack = await readFileText(pathRef.current);
            if (readBack !== null) {
              applyFormattedContent(
                view,
                adoptDiskTextRef.current(readBack.text, readBack.mtime),
              );
            }
          }
        }
      }
    }, [t]);

    const pendingLineRef = useRef<{
      path: string;
      line: number;
      column: number;
      matchLength: number;
      focus: boolean;
    } | null>(null);
    const pendingFocusRef = useRef<string | null>(null);
    const statusRef = useRef(doc.status);
    useLayoutEffect(() => {
      statusRef.current = doc.status;
    }, [doc.status]);

    useEffect(() => {
      if (pendingLineRef.current?.path !== path) {
        pendingLineRef.current = null;
      }
      if (pendingFocusRef.current !== path) {
        pendingFocusRef.current = null;
      }
    }, [path]);

    const focusWhenRendered = useCallback(
      (view: EditorView, targetPath: string) => {
        requestAnimationFrame(() => {
          if (cmRef.current?.view === view && pathRef.current === targetPath) {
            view.focus();
          }
        });
      },
      [],
    );

    const applyPendingGoto = useCallback(() => {
      const view = cmRef.current?.view;
      const pending = pendingLineRef.current;
      if (!view || pending == null || statusRef.current !== "ready") return;
      if (pending.path !== path) {
        pendingLineRef.current = null;
        return;
      }
      const target = Math.max(1, Math.min(pending.line, view.state.doc.lines));
      const line = view.state.doc.line(target);
      const selection = editorSelectionForLocation(
        line.from,
        line.to,
        pending.column,
        pending.matchLength,
      );
      view.dispatch({
        selection,
        effects: EditorView.scrollIntoView(selection.anchor, { y: "center" }),
      });
      if (pending.focus) focusWhenRendered(view, pending.path);
      pendingLineRef.current = null;
    }, [focusWhenRendered, path]);

    const applyPendingFocus = useCallback(() => {
      const view = cmRef.current?.view;
      const pendingPath = pendingFocusRef.current;
      if (!view || pendingPath === null || statusRef.current !== "ready")
        return;
      pendingFocusRef.current = null;
      if (pendingPath === path) focusWhenRendered(view, pendingPath);
    }, [focusWhenRendered, path]);

    useEffect(() => {
      if (doc.status !== "ready") return;
      applyPendingGoto();
      applyPendingFocus();
    }, [doc.status, applyPendingFocus, applyPendingGoto]);

    const extensions = useMemo(
      () => [
        // basicSetup is added before user extensions by @uiw/react-codemirror,
        // so we must elevate vim's precedence to win the keymap.
        vimCompartment.of(
          usePreferencesStore.getState().vimMode ? Prec.highest(vim()) : [],
        ),
        wrapCompartment.of(
          wordWrapExtension(
            usePreferencesStore.getState().editorWordWrap
              ? usePreferencesStore.getState().editorWordWrapColumn
              : null,
          ),
        ),
        vimHandlersExtension(() => ({
          save: () => {
            void performSaveRef.current();
          },
          close: () => onCloseRef.current?.(),
        })),
        ...buildSharedExtensions(),
        indentCompartment.of(DEFAULT_INDENT),
        languageCompartment.of([]),
        lspCompartment.of([]),
        diffGutterCompartment.of([]),
        breakpointGutter(() => pathRef.current),
        minimapCompartment.of([]),
        diagnosticsReporter(() => pathRef.current),
        // Before inlineCompletion so an open popup wins Tab over the ghost.
        Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
        inlineCompletion({
          getPrefs: () => {
            const s = usePreferencesStore.getState();
            const selection = resolveAutocompleteSelection(s);
            return {
              enabled: s.autocompleteEnabled && isAiRuntimeAvailable(),
              trigger: s.autocompleteTrigger,
              apiKey: apiKeyRef.current,
              ...selection,
            };
          },
          getPath: () => pathRef.current,
          getLanguage: () => languageRef.current,
          onError: (error) => completionErrorRef.current(error),
          onStatus: (status) =>
            useCompletionStatusStore.getState().report(editorId, status),
          getSemanticMetadata: (view) => {
            const symbol = currentSymbolRef.current;
            const cursorLine = view.state.doc.lineAt(
              view.state.selection.main.head,
            ).number;
            const diagnostics = Object.values(
              useDiagnosticsStore.getState().problemDocuments,
            )
              .filter((document) =>
                samePeekPath(document.path, pathRef.current),
              )
              .flatMap((document) => document.problems)
              .sort(
                (left, right) =>
                  Math.abs(left.line - cursorLine) -
                  Math.abs(right.line - cursorLine),
              )
              .slice(0, 6)
              .map((problem) => ({
                severity: problem.severity,
                message: problem.message,
                line: problem.line,
              }));
            return {
              symbols: symbol
                ? [
                    {
                      name: symbol.name,
                      kind: symbol.kind,
                      line: symbol.line,
                    },
                  ]
                : [],
              diagnostics,
            };
          },
        }),
        editorSnippetExtension(() => languageRef.current),
        docSize <= SYNTAX_MAX_BYTES ? structureGuidesExtension() : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            for (const listener of documentChangeListenersRef.current) {
              listener();
            }
          }
          if (update.selectionSet || update.docChanged) {
            useEditorStatusStore
              .getState()
              .report(editorId, deriveEditorCursorStatus(update.state));
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head).number;
            const sym = resolveCurrentSymbol(update.state.doc.toString(), line);
            currentSymbolRef.current = sym;
            setCurrentSymbol((prev) => {
              if (
                (!prev && !sym) ||
                (prev &&
                  sym &&
                  prev.name === sym.name &&
                  prev.kind === sym.kind &&
                  prev.line === sym.line)
              ) {
                return prev;
              }
              return sym;
            });
          }
          if (update.selectionSet || update.viewportChanged) {
            if (viewStateTimerRef.current) {
              clearTimeout(viewStateTimerRef.current);
            }
            const { anchor, head } = update.state.selection.main;
            const scrollTop = update.view.scrollDOM.scrollTop;
            const scrollLeft = update.view.scrollDOM.scrollLeft;
            const statePath = pathRef.current;
            viewStateTimerRef.current = setTimeout(() => {
              viewStateTimerRef.current = null;
              void saveEditorViewState(spaceId, statePath, {
                anchor,
                head,
                scrollTop,
                scrollLeft,
              });
            }, 400);
          }
        }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void performSaveRef.current();
              return true;
            },
          },
          { key: "Ctrl-g", run: gotoLine },
          {
            key: "Mod-k",
            preventDefault: true,
            run: () => {
              setInlineAiOpen(true);
              return true;
            },
          },
          {
            key: "Alt-Enter",
            preventDefault: true,
            run: (view) => {
              void handleQuickFix(view);
              return true;
            },
          },
          {
            key: "Shift-Enter",
            preventDefault: true,
            run: (view) => {
              sendActiveEditorCodeToTerminal(view);
              return true;
            },
          },
          {
            key: "Alt-Shift-ArrowRight",
            run: (view) => {
              expandSelectionCommand(view);
              return true;
            },
          },
          { key: "Mod-Alt-ArrowUp", run: addCursorAbove },
          { key: "Mod-Alt-ArrowDown", run: addCursorBelow },
          { key: "Alt-ArrowUp", run: moveLineUp },
          { key: "Alt-ArrowDown", run: moveLineDown },
          { key: "Alt-Shift-ArrowUp", run: copyLineUp },
          { key: "Alt-Shift-ArrowDown", run: copyLineDown },
        ]),
      ],
      [docSize, editorId, handleQuickFix, spaceId],
    );

    useEffect(() => {
      if (doc.status !== "ready") return;
      const key = `${spaceId}\u0000${path}`;
      if (viewStateRestoredRef.current === key) return;
      let cancelled = false;
      void loadEditorViewState(spaceId, path)
        .then((stored) => {
          if (cancelled || !stored) return;
          const view = cmRef.current?.view;
          if (!view || pathRef.current !== path) return;
          const restored = normalizeEditorViewState(
            stored,
            view.state.doc.length,
          );
          view.dispatch({
            selection: { anchor: restored.anchor, head: restored.head },
          });
          requestAnimationFrame(() => {
            if (cancelled || cmRef.current?.view !== view) return;
            view.scrollDOM.scrollTop = restored.scrollTop;
            view.scrollDOM.scrollLeft = restored.scrollLeft;
          });
        })
        .catch(() => {});
      viewStateRestoredRef.current = key;
      return () => {
        cancelled = true;
      };
    }, [doc.status, path, spaceId]);

    useEffect(
      () => () => {
        if (viewStateTimerRef.current) clearTimeout(viewStateTimerRef.current);
        const view = cmRef.current?.view;
        if (!view) return;
        const { anchor, head } = view.state.selection.main;
        void saveEditorViewState(spaceId, path, {
          anchor,
          head,
          scrollTop: view.scrollDOM.scrollTop,
          scrollLeft: view.scrollDOM.scrollLeft,
        });
      },
      [path, spaceId],
    );

    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;

      if (!showMinimap) {
        view.dispatch({ effects: minimapCompartment.reconfigure([]) });
        return;
      }

      let cancelled = false;
      void loadMinimapExtension()
        .then((extension) => {
          if (cancelled || cmRef.current?.view !== view) return;
          view.dispatch({
            effects: minimapCompartment.reconfigure(extension),
          });
        })
        .catch(() => {
          // The optional feature must not affect the editor if its chunk fails.
        });

      return () => {
        cancelled = true;
      };
    }, [showMinimap]);

    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: vimCompartment.reconfigure(vimMode ? Prec.highest(vim()) : []),
      });
    }, [vimMode]);

    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: wrapCompartment.reconfigure(wordWrapExtension(wordWrapColumn)),
      });
    }, [wordWrapColumn]);

    useEffect(() => {
      if (doc.status !== "ready") return;
      const view = cmRef.current?.view;
      if (!view) return;
      const indentUnit = detectIndentUnit(doc.content);
      view.dispatch({
        effects: indentCompartment.reconfigure(indentExtension(indentUnit)),
      });
      useEditorStatusStore.getState().report(editorId, {
        ...deriveEditorCursorStatus(view.state),
        indentUnit,
        eol: eol === "\r\n" ? "crlf" : "lf",
      });
    }, [doc, editorId, eol]);

    const lspExt = useLspExtension(
      path,
      langId,
      doc.status === "ready",
      onWorkspaceEdit,
    );
    useEffect(() => {
      lspActiveRef.current = lspExt !== null;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: lspCompartment.reconfigure(lspExt ?? []),
      });
    }, [lspExt]);

    useEffect(
      () => () => useDiagnosticsStore.getState().report(pathRef.current, null),
      [],
    );

    useEffect(
      () => () => useEditorStatusStore.getState().remove(editorId),
      [editorId],
    );

    // Warm the language chunk while the file is still being read; the
    // ready-gated effect below then resolves from cache.
    useEffect(() => {
      const resolvePath = overrideLanguage ? `dummy.${overrideLanguage}` : path;
      void resolveLanguage(resolvePath).catch(() => {});
    }, [path, overrideLanguage]);

    useEffect(() => {
      const ext =
        overrideLanguage || (path.split(".").pop()?.toLowerCase() ?? null);
      languageRef.current = ext;
      if (doc.status !== "ready") return;
      if (docSize > SYNTAX_MAX_BYTES) {
        setLangId(null);
        const view = cmRef.current?.view;
        view?.dispatch({ effects: languageCompartment.reconfigure([]) });
        return;
      }
      let cancelled = false;
      const resolve = async (): Promise<LanguageResult> => {
        const resolvePath = overrideLanguage
          ? `dummy.${overrideLanguage}`
          : path;
        return (
          (await resolveLanguage(resolvePath)) ?? { ext: [], name: "", id: "" }
        );
      };
      void resolve().then((result) => {
        if (cancelled) return;
        if (result.id) languageRef.current = result.id;
        setLangId(result.id || ext);
        useEditorStatusStore.getState().report(editorId, {
          languageId: result.id || ext || "text",
        });
        const view = cmRef.current?.view;
        if (!view) return;
        view.dispatch({
          effects: languageCompartment.reconfigure(result.ext),
        });
      });
      return () => {
        cancelled = true;
      };
    }, [editorId, path, docSize, doc.status, overrideLanguage]);

    const lastSearchQueryRef = useRef("");

    useImperativeHandle(
      ref,
      () => ({
        setQuery: (q: string) => {
          lastSearchQueryRef.current = q;
          const view = cmRef.current?.view;
          if (!view) return { current: 0, total: 0 };
          view.dispatch({
            effects: setSearchQuery.of(
              new SearchQuery({ search: q, caseSensitive: false }),
            ),
          });
          if (q) findNext(view);
          return getCmSearchMatchInfo(view, q);
        },
        findNext: () => {
          const view = cmRef.current?.view;
          if (!view) return { current: 0, total: 0 };
          findNext(view);
          return getCmSearchMatchInfo(view, lastSearchQueryRef.current);
        },
        findPrevious: () => {
          const view = cmRef.current?.view;
          if (!view) return { current: 0, total: 0 };
          findPrevious(view);
          return getCmSearchMatchInfo(view, lastSearchQueryRef.current);
        },
        clearQuery: () => {
          lastSearchQueryRef.current = "";
          const view = cmRef.current?.view;
          if (!view) return;
          view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({ search: "" })),
          });
        },
        openSearch: () => {
          const view = cmRef.current?.view;
          if (view) openSearchPanel(view);
        },
        openGotoLine: () => {
          const view = cmRef.current?.view;
          if (view) gotoLine(view);
        },
        focus: () => {
          pendingFocusRef.current = path;
          applyPendingFocus();
        },
        getSelection: () => {
          const view = cmRef.current?.view;
          if (!view) return null;
          const { from, to } = view.state.selection.main;
          if (from === to) return null;
          return view.state.sliceDoc(from, to);
        },
        getPath: () => path,
        getLocation: () => {
          const view = cmRef.current?.view;
          if (!view) return { line: 1, column: 1 };
          const head = view.state.selection.main.head;
          const line = view.state.doc.lineAt(head);
          return { line: line.number, column: head - line.from + 1 };
        },
        getDevelopmentBuffer: async () => {
          const view = cmRef.current?.view;
          if (!view) return null;
          const head = view.state.selection.main.head;
          const line = view.state.doc.lineAt(head);
          const radius = 4_000;
          const from = Math.max(0, head - radius);
          const to = Math.min(view.state.doc.length, head + radius);
          let symbols: IdeSymbol[] = [];
          if (view.state.doc.length <= 1024 * 1024) {
            try {
              const { documentSymbolsForView } = await import(
                "@/modules/lsp/lib/client"
              );
              const lspSymbols = await documentSymbolsForView(view, path);
              symbols =
                lspSymbols ??
                extractDocumentSymbols(
                  view.state.doc.toString(),
                  languageRef.current ?? "text",
                  path,
                );
            } catch {
              symbols = extractDocumentSymbols(
                view.state.doc.toString(),
                languageRef.current ?? "text",
                path,
              );
            }
          }
          return {
            path,
            language: languageRef.current ?? "text",
            dirty,
            cursor: { line: line.number, column: head - line.from + 1 },
            excerpt: view.state.sliceDoc(from, to),
            symbols: symbols.slice(0, 80).map((symbol) => ({
              name: symbol.name,
              kind: symbol.kind,
              line: symbol.line,
            })),
          };
        },
        getDocumentSymbols: async () => {
          const view = cmRef.current?.view;
          if (!view) return { source: "fallback", symbols: [] };
          try {
            const { documentSymbolsForView } = await import(
              "@/modules/lsp/lib/client"
            );
            const symbols = await documentSymbolsForView(view, path);
            if (symbols) return { source: "lsp", symbols };
          } catch {
            // A stopped language server falls back to local symbols.
          }
          return {
            source: "fallback",
            symbols: extractDocumentSymbols(
              view.state.doc.toString(),
              languageRef.current ?? "text",
              path,
            ),
          };
        },
        getWorkspaceSymbols: async (query: string) => {
          const view = cmRef.current?.view;
          if (!view || !query.trim()) return null;
          try {
            const { workspaceSymbolsForView } = await import(
              "@/modules/lsp/lib/client"
            );
            return await workspaceSymbolsForView(view, query.trim());
          } catch {
            return null;
          }
        },
        subscribeDocumentChanges: (listener: () => void) => {
          documentChangeListenersRef.current.add(listener);
          return () => documentChangeListenersRef.current.delete(listener);
        },
        reload: (force?: boolean) => {
          void reloadRef.current(force).then((res) => {
            if (res && cmRef.current?.view) {
              const view = cmRef.current.view;
              view.dispatch({
                changes: {
                  from: 0,
                  to: view.state.doc.length,
                  insert: res.content,
                },
              });
            }
          });
          return true;
        },
        notifyExternalChange: () => {
          notifyExternalChange();
        },
        checkExternalChange: () => checkExternalChange(),
        gotoLine: (line: number, options) => {
          pendingLineRef.current = {
            path,
            line,
            column: 1,
            matchLength: 0,
            focus: options?.focus ?? true,
          };
          applyPendingGoto();
        },
        gotoLocation: (line, column, matchLength = 0, options) => {
          pendingLineRef.current = {
            path,
            line,
            column,
            matchLength,
            focus: options?.focus ?? true,
          };
          applyPendingGoto();
        },
        undo: () => {
          const view = cmRef.current?.view;
          if (view) undo(view);
        },
        redo: () => {
          const view = cmRef.current?.view;
          if (view) redo(view);
        },
        triggerAiComplete: () => {
          const view = cmRef.current?.view;
          if (view) {
            view.focus();
            triggerInlineCompletion(view);
          }
        },
        triggerCodeComplete: () => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.focus();
          startCompletion(view);
        },
        triggerInlineAi: (initialPrompt?: string) => {
          if (!isAiRuntimeAvailable()) return;
          setInlineAiPrompt(initialPrompt);
          setInlineAiOpen(true);
        },
        formatDocument: () => {
          void handleFormatDocument();
        },
        triggerQuickFix: () => {
          void handleQuickFix();
        },
        triggerSignatureHelp: () => {
          void handleSignatureHelp();
        },
        triggerLspNavigation: (kind) => {
          void handleLspNavigation(kind);
        },
        triggerLspPeek: (kind) => {
          void handleLspPeek(kind);
        },
        runEditCommand: (command) => {
          const view = cmRef.current?.view;
          if (view) runEditorEditCommand(view, command);
        },
        runInlineSuggestionCommand: (command) => {
          const view = cmRef.current?.view;
          if (view) runInlineSuggestionCommand(view, command);
        },
      }),
      [
        path,
        applyPendingFocus,
        applyPendingGoto,
        handleFormatDocument,
        handleQuickFix,
        handleSignatureHelp,
        handleLspNavigation,
        handleLspPeek,
        dirty,
      ],
    );

    const handleInlineAiSubmit = useCallback(
      async (instruction: string) => {
        const view = cmRef.current?.view;
        if (!view) throw new Error(t("feedback.editorUnavailable"));

        const { from, to } = view.state.selection.main;
        const docText = view.state.doc.toString();
        const selectedCode =
          from !== to
            ? docText.slice(from, to)
            : docText.slice(
                view.state.doc.lineAt(from).from,
                view.state.doc.lineAt(from).to,
              );
        const prefix = docText.slice(0, from);
        const suffix = docText.slice(to);

        return await requestInlineEdit({
          instruction,
          code: selectedCode,
          path,
          language: languageRef.current ?? undefined,
          prefix,
          suffix,
        });
      },
      [path, t],
    );

    const handleInlineAiAccept = useCallback((newCode: string) => {
      const view = cmRef.current?.view;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const range =
        from !== to
          ? { from, to }
          : {
              from: view.state.doc.lineAt(from).from,
              to: view.state.doc.lineAt(from).to,
            };
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: newCode },
      });
      setInlineAiOpen(false);
    }, []);

    if (doc.status === "loading" || doc.status === "slow") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-xs text-muted-foreground">
          <div>
            {doc.status === "slow"
              ? t("editor.status.slowRead")
              : t("editor.loading")}
          </div>
          {doc.status === "slow" && (
            <button
              type="button"
              onClick={cancelRead}
              className="rounded-md border border-border bg-muted/60 px-3 py-1 text-foreground hover:bg-accent"
            >
              {t("common.cancel")}
            </button>
          )}
        </div>
      );
    }
    if (doc.status === "error" || doc.status === "cancelled") {
      const errorLabel =
        doc.status === "cancelled"
          ? t("editor.status.readCancelled")
          : doc.kind === "offline"
            ? t("editor.status.readOffline")
            : doc.kind === "not-found"
              ? t("editor.status.readNotFound")
              : doc.kind === "permission-denied"
                ? t("editor.status.readPermissionDenied")
                : t("editor.status.readFailed");
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-xs">
          <div className="text-destructive">{errorLabel}</div>
          {doc.status === "error" && (
            <div className="max-w-xl break-words text-muted-foreground">
              {doc.message}
            </div>
          )}
          <button
            type="button"
            onClick={retry}
            className="rounded-md border border-border bg-muted/60 px-3 py-1 text-foreground hover:bg-accent"
          >
            {t("common.retry")}
          </button>
        </div>
      );
    }
    if (doc.status === "binary" || doc.status === "toolarge") {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const mediaKind = classifyMediaExtension(ext);

      if (mediaKind) {
        return <MediaPreview path={path} size={doc.size} kind={mediaKind} />;
      }

      const canForce =
        doc.status === "toolarge" && doc.size <= FORCE_READ_LIMIT;
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
          <div className="text-sm text-foreground">
            {doc.status === "binary"
              ? t("editor.status.binaryFile")
              : t("editor.status.fileTooLarge")}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(doc.size)} ·{" "}
            {canForce
              ? t("editor.status.syntaxDisabled")
              : t("editor.status.previewNotSupported")}
          </div>
          {canForce && (
            <button
              type="button"
              onClick={openAnyway}
              className="mt-2 rounded-md border border-border bg-muted/60 px-3 py-1 text-xs text-foreground hover:bg-accent"
            >
              {t("editor.status.openAnyway")}
            </button>
          )}
        </div>
      );
    }

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative flex h-full min-h-0 flex-col zoom-exempt">
            <EditorBreadcrumbs
              editorId={editorId}
              path={path}
              symbol={currentSymbol}
              language={langId ?? languageRef.current ?? "text"}
              indentUnit={
                doc.status === "ready" ? detectIndentUnit(doc.content) : "  "
              }
              eol={eol === "\r\n" ? "crlf" : "lf"}
              errorCount={diagCounts.errors}
              warningCount={diagCounts.warnings}
              onQuickFix={() => void handleQuickFix()}
              onTriggerInlineAi={() => {
                if (aiAvailable) setInlineAiOpen(true);
              }}
              onTriggerAiCompletion={() => {
                const view = cmRef.current?.view;
                if (!view) return;
                view.focus();
                triggerInlineCompletion(view);
              }}
              onOpenPreview={onOpenPreview}
              canNavigateBack={canNavigateBack}
              canNavigateForward={canNavigateForward}
              onNavigateBack={onNavigateBack}
              onNavigateForward={onNavigateForward}
            />

            {externalChange && (
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 animate-in fade-in-0 duration-150">
                <div className="flex min-w-0 items-center gap-2">
                  <HugeiconsIcon
                    icon={Alert02Icon}
                    size={14}
                    strokeWidth={2}
                    className="shrink-0 text-amber-400"
                  />
                  <span className="truncate">
                    {dirty
                      ? t("editor.externalChangeConflict", {
                          name: path.split(/[\\/]/).pop() ?? path,
                        })
                      : t("editor.externalChangeDetected", {
                          name: path.split(/[\\/]/).pop() ?? path,
                        })}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="default"
                    className="h-6 bg-amber-600 px-2.5 text-[11px] font-medium text-white hover:bg-amber-500 shadow-xs cursor-pointer"
                    onClick={() => void handleReloadFromDisk()}
                  >
                    <HugeiconsIcon
                      icon={RefreshIcon}
                      size={12}
                      strokeWidth={2}
                      className="mr-1"
                    />
                    {t("editor.reloadFile")}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] text-amber-200/80 hover:bg-amber-500/20 hover:text-amber-100 cursor-pointer"
                    onClick={dismissExternalChange}
                  >
                    {dirty ? t("editor.keepCurrentEdits") : t("ai.dismiss")}
                  </Button>
                </div>
              </div>
            )}

            {aiAvailable ? (
              <InlineAiWidget
                isOpen={inlineAiOpen}
                initialPrompt={inlineAiPrompt}
                onClose={() => {
                  setInlineAiOpen(false);
                  setInlineAiPrompt(undefined);
                }}
                onSubmit={handleInlineAiSubmit}
                onAccept={handleInlineAiAccept}
              />
            ) : null}

            <CodeMirror
              ref={cmRef}
              value={doc.content}
              onChange={handleDocChange}
              theme={themeExt}
              extensions={extensions}
              height="100%"
              className="voktty-editor-surface flex-1 min-h-0 overflow-hidden"
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: true,
                foldGutter: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                highlightActiveLine: true,
                highlightSelectionMatches: true,
                searchKeymap: true,
              }}
            />
            {peekSession && (
              <PeekPanel
                kind={peekSession.kind}
                items={peekSession.items}
                activeIndex={peekSession.activeIndex}
                document={peekDocument}
                onSelect={(activeIndex) =>
                  setPeekSession((current) =>
                    current ? { ...current, activeIndex } : current,
                  )
                }
                onOpen={openPeekItem}
                onClose={closePeek}
              />
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64 rounded-xl border border-border/40 bg-popover/95 p-1 shadow-2xl backdrop-blur-xl z-50">
          <ContextMenuItem
            onSelect={() => void handleQuickFix()}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground font-medium text-amber-300"
          >
            <HugeiconsIcon icon={CodeIcon} size={14} className="text-sky-400" />
            <span className="flex-1">{t("editor.quickFixAction")}</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              Alt+Enter
            </span>
          </ContextMenuItem>

          {aiAvailable ? (
            <>
              <ContextMenuSeparator className="my-1 border-border/30" />

              <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <HugeiconsIcon
                  icon={SparklesIcon}
                  size={12}
                  className="text-violet-400"
                />
                <span>{t("editor.assistantChat")}</span>
              </div>

              <ContextMenuItem
                onSelect={() => handleChatAiAction(t("editor.askAgentPrompt"))}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground font-medium text-foreground"
              >
                <HugeiconsIcon
                  icon={SparklesIcon}
                  size={14}
                  className="text-violet-400"
                />
                <span className="flex-1">{t("editor.askAgent")}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  Ctrl+J
                </span>
              </ContextMenuItem>

              <ContextMenuItem
                onSelect={() =>
                  handleChatAiAction(t("editor.context.explainPrompt"))
                }
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground"
              >
                <HugeiconsIcon
                  icon={BookOpen01Icon}
                  size={14}
                  className="text-sky-400"
                />
                <span className="flex-1">{t("editor.explainHowItWorks")}</span>
              </ContextMenuItem>

              <ContextMenuItem
                onSelect={() =>
                  handleChatAiAction(t("editor.analyzeArchitecturePrompt"))
                }
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground"
              >
                <HugeiconsIcon
                  icon={CodeIcon}
                  size={14}
                  className="text-indigo-400"
                />
                <span className="flex-1">
                  {t("editor.analyzeArchitecture")}
                </span>
              </ContextMenuItem>

              <ContextMenuItem
                onSelect={() =>
                  handleChatAiAction(t("editor.auditSecurityPrompt"))
                }
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground"
              >
                <HugeiconsIcon
                  icon={Shield01Icon}
                  size={14}
                  className="text-rose-400"
                />
                <span className="flex-1">{t("editor.auditSecurity")}</span>
              </ContextMenuItem>

              <ContextMenuItem
                onSelect={() =>
                  handleChatAiAction(t("editor.designTestCasesPrompt"))
                }
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground"
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle01Icon}
                  size={14}
                  className="text-teal-400"
                />
                <span className="flex-1">{t("editor.designTestCases")}</span>
              </ContextMenuItem>

              <ContextMenuSeparator className="my-1 border-border/30" />
            </>
          ) : null}

          <ContextMenuItem
            onSelect={() => {
              const view = cmRef.current?.view;
              if (view) {
                const { from, to } = view.state.selection.main;
                const text = view.state.sliceDoc(from, to);
                if (text) {
                  void navigator.clipboard.writeText(text);
                  view.dispatch({ changes: { from, to, insert: "" } });
                }
              }
            }}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground"
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              size={14}
              className="text-muted-foreground"
            />
            <span className="flex-1">{t("editor.context.cut")}</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              Ctrl+X
            </span>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              const view = cmRef.current?.view;
              if (view) {
                const { from, to } = view.state.selection.main;
                const text = view.state.sliceDoc(from, to);
                if (text) void navigator.clipboard.writeText(text);
              }
            }}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground"
          >
            <HugeiconsIcon
              icon={Copy01Icon}
              size={14}
              className="text-muted-foreground"
            />
            <span className="flex-1">{t("editor.context.copy")}</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              Ctrl+C
            </span>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              void navigator.clipboard.readText().then((text) => {
                const view = cmRef.current?.view;
                if (view && text) {
                  const { from, to } = view.state.selection.main;
                  view.dispatch({ changes: { from, to, insert: text } });
                }
              });
            }}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground"
          >
            <HugeiconsIcon
              icon={Copy01Icon}
              size={14}
              className="text-muted-foreground"
            />
            <span className="flex-1">{t("editor.context.paste")}</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              Ctrl+V
            </span>
          </ContextMenuItem>

          <ContextMenuSeparator className="my-1 border-border/30" />

          <ContextMenuItem
            onSelect={() => {
              const view = cmRef.current?.view;
              if (view) openSearchPanel(view);
            }}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground"
          >
            <HugeiconsIcon
              icon={Search01Icon}
              size={14}
              className="text-muted-foreground"
            />
            <span className="flex-1">{t("editor.context.find")}</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              Ctrl+F
            </span>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => void handleFormatDocument()}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground"
          >
            <HugeiconsIcon
              icon={CodeIcon}
              size={14}
              className="text-muted-foreground"
            />
            <span className="flex-1">{t("editor.context.format")}</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              Shift+Alt+F
            </span>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              if (cmRef.current?.view)
                sendActiveEditorCodeToTerminal(cmRef.current.view);
            }}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer focus:bg-accent focus:text-accent-foreground text-emerald-400"
          >
            <HugeiconsIcon
              icon={PlayIcon}
              size={14}
              className="text-emerald-400"
            />
            <span className="flex-1">{t("editor.runInTerminal")}</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              Shift+Enter
            </span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }),
);
