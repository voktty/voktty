import { openExternalUrl } from "@/lib/external-link";
import { resolveFontFamily } from "@/lib/fonts";
import { t } from "@/modules/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { TerminalCursorStyle } from "@/modules/settings/store";
import { buildTerminalTheme } from "@/styles/terminalTheme";
import { toast } from "sonner";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { type FontWeight, Terminal } from "@xterm/xterm";
import { shouldCursorBlink } from "./cursorBlink";
import {
  clearXtermKeyData,
  createImeBridgeState,
  type ImeBridgeState,
  imeBridgeInput,
  noteNativeComposition,
  noteXtermKeyData,
  resetImeBridge,
  transitionImeBridgeOwner,
} from "./imeBridge";
import { terminalReadlineSequence } from "./keymap";
import { RENDERER_POOL_SIZE } from "./paneLimits";
import {
  readTerminalClipboard,
  writeTerminalClipboard,
} from "./terminalClipboard";
import {
  copyTerminalSelection,
  pasteClipboardIntoTerminal,
} from "./terminalInteraction";
import {
  createTerminalLinkHandler,
  DUBIOUS_OWNERSHIP_LINK_REGEX,
  handleTerminalGitTrust,
  SAFE_DIR_LINK_REGEX,
} from "./terminalLinks";
import { pasteIntoTerminal } from "./terminalPaste";
import { useTerminalCopilotStore } from "../copilot/terminalCopilotStore";
import {
  extractCurrentPromptInput,
  useTerminalSuggestStore,
} from "./terminalSuggestStore";
import { predictTerminalSuggestions } from "./terminalPredictor";
import { historyRecord } from "../block/lib/history";
import { SHORTCUTS, matchBinding } from "@/modules/shortcuts";
import type { WorkspaceEnv } from "@/modules/workspace";
import { IS_WINDOWS } from "@/lib/platform";

const PTY_RESIZE_DEBOUNCE_MS = 256;
const SNAPSHOT_SCROLLBACK_CAP = 5_000;

export type LeafSessionInfo = {
  workspaceEnv: WorkspaceEnv;
  cwd: string | null;
  shellOverride?: string;
  isUnix: boolean;
};

export type SlotAdapter = {
  resolveLeaf(leafId: number): LeafBridge | null;
  evictLeaf(leafId: number): void;
  isLeafFocused(leafId: number): boolean;
  isLeafBlocks(leafId: number): boolean;
  isLeafBusy(leafId: number): boolean;
  isLeafVisible(leafId: number): boolean;
  storeSnapshot(leafId: number, out: SerializeOutput): void;
  getSessionInfo?(leafId: number): LeafSessionInfo | null;
};

export type LeafBridge = {
  writeToPty(data: string): void;
  resizePty(cols: number, rows: number): void;
  // Force a SIGWINCH on the underlying PTY at the given dims. Implemented
  // as a +1 row / restore bump because the Linux kernel suppresses winsize
  // ioctls that don't actually change the size. Used to make alt-screen
  // TUIs repaint from scratch after they were dormant.
  kickPty(cols: number, rows: number): void;
};

export type Slot = {
  readonly id: number;
  readonly term: Terminal;
  readonly fitAddon: FitAddon;
  readonly searchAddon: SearchAddon;
  readonly serializeAddon: SerializeAddon;
  readonly host: HTMLDivElement;
  webglAddon: WebglAddon | null;
  webglCanvases: HTMLCanvasElement[];
  currentLeafId: number | null;
  // Leaf whose buffer this slot still holds intact after release; serialized
  // only if another leaf steals the slot.
  retainedLeafId: number | null;
  fixedGrid: boolean;
  parked: boolean;
  oscDisposers: (() => void)[];
  observer: ResizeObserver | null;
  fitTimer: ReturnType<typeof setTimeout> | null;
  ptyTimer: ReturnType<typeof setTimeout> | null;
  webglReapTimer: ReturnType<typeof setTimeout> | null;
  slotReapTimer: ReturnType<typeof setTimeout> | null;
  unhideRaf: number | null;
  resizeRaf: number | null;
  lastCols: number;
  lastRows: number;
  lastW: number;
  lastH: number;
  lastUsedAt: number;
  imeState: ImeBridgeState;
  selectionCopyTimer: ReturnType<typeof setTimeout> | null;
  isDirectTyping: boolean;
};

const slots: Slot[] = [];
let recyclerEl: HTMLDivElement | null = null;
let adapter: SlotAdapter | null = null;
let configuredFont: RendererFont | null = null;
let appliedThemeSignature: string | null = null;

type RendererFont = {
  fontFamily: string;
  fontWeight: string;
  fontSize: number;
};

let windowActive =
  typeof document === "undefined" || (!document.hidden && document.hasFocus());
let windowActivityBound = false;
let cursorBlinkEnabled = false;

function bindWindowActivityListeners(): void {
  if (windowActivityBound || typeof window === "undefined") return;
  windowActivityBound = true;
  const sync = () => setWindowActive(!document.hidden && document.hasFocus());
  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);
  document.addEventListener("visibilitychange", sync);
}

function setWindowActive(active: boolean): void {
  if (windowActive === active) return;
  windowActive = active;
  for (const slot of slots) {
    if (slot.currentLeafId === null) continue;
    applyCursorBlinkOnSlot(
      slot,
      adapter?.isLeafFocused(slot.currentLeafId) ?? false,
    );
  }
}

export function configureRendererPool(a: SlotAdapter): void {
  adapter = a;
  bindWindowActivityListeners();
}

export function forEachSlot(fn: (slot: Slot) => void): void {
  for (const s of slots) fn(s);
}

export function poolSize(): number {
  return slots.length;
}

export type PoolSlotStat = {
  id: number;
  leafId: number | null;
  retainedLeafId: number | null;
  parked: boolean;
  cols: number;
  rows: number;
  bufferLines: number;
  webgl: boolean;
  canvases: number;
};

export function poolSlotStats(): PoolSlotStat[] {
  return slots.map((s) => ({
    id: s.id,
    leafId: s.currentLeafId,
    retainedLeafId: s.retainedLeafId,
    parked: s.parked,
    cols: s.term.cols,
    rows: s.term.rows,
    bufferLines: s.term.buffer.active.length,
    webgl: !!s.webglAddon,
    canvases: s.webglCanvases.length,
  }));
}

// Bracketed paste via xterm, so an app that enabled it (Claude Code) treats a
// dropped path as a real paste while a plain shell gets the literal text.
export function pasteIntoLeaf(leafId: number, text: string): boolean {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  return pasteIntoTerminal(slot?.term ?? null, text);
}

function getRecycler(): HTMLDivElement {
  if (recyclerEl?.isConnected) return recyclerEl;
  const el = document.createElement("div");
  el.setAttribute("data-voktty-recycler", "");
  el.style.cssText =
    "position:fixed;left:-99999px;top:-99999px;width:1024px;height:768px;overflow:hidden;pointer-events:none;contain:strict;";
  document.body.appendChild(el);
  recyclerEl = el;
  return el;
}

const MCR_BG_ACTIVE = 4.5;
const MCR_BG_INACTIVE = 1;

function bgActive(
  prefs: ReturnType<typeof usePreferencesStore.getState>,
): boolean {
  return prefs.backgroundKind === "image" && !!prefs.backgroundImageId;
}

function termOptions() {
  const prefs = usePreferencesStore.getState();
  const font = configuredFont ?? {
    fontFamily: resolveFontFamily(prefs.terminalFontFamily),
    fontWeight: prefs.terminalFontWeight,
    fontSize: Math.max(4, Math.round(prefs.terminalFontSize * prefs.zoomLevel)),
  };
  return {
    fontFamily: font.fontFamily,
    fontWeight: font.fontWeight as FontWeight,
    letterSpacing: prefs.terminalLetterSpacing,
    fontSize: font.fontSize,
    theme: buildTerminalTheme(),
    cursorBlink: false,
    cursorStyle: prefs.terminalCursorStyle,
    cursorInactiveStyle: "outline" as const,
    scrollback: prefs.terminalScrollback,
    allowProposedApi: true,
    allowTransparency: true,
    minimumContrastRatio: bgActive(prefs) ? MCR_BG_ACTIVE : MCR_BG_INACTIVE,
  };
}

export function applyBackgroundActive(active: boolean): void {
  const value = active ? MCR_BG_ACTIVE : MCR_BG_INACTIVE;
  for (const slot of slots) {
    if (slot.term.options.minimumContrastRatio === value) continue;
    slot.term.options.minimumContrastRatio = value;
  }
}

let suggestDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function syncTerminalSuggestions(slot: Slot): void {
  const leafId = slot.currentLeafId;
  if (leafId === null) return;
  if (isAltScreen(slot)) {
    useTerminalSuggestStore.getState().clear(leafId);
    return;
  }

  // Respect user preference for terminal suggestions
  const suggestEnabled = usePreferencesStore.getState().terminalSuggestEnabled;
  if (!suggestEnabled) {
    useTerminalSuggestStore.getState().clear(leafId);
    return;
  }

  // Only synchronize suggestions when the user is actively typing in the prompt
  if (!slot.isDirectTyping) {
    useTerminalSuggestStore.getState().clear(leafId);
    return;
  }

  if (suggestDebounceTimer !== null) {
    clearTimeout(suggestDebounceTimer);
  }

  suggestDebounceTimer = setTimeout(async () => {
    suggestDebounceTimer = null;
    if (
      slot.currentLeafId !== leafId ||
      isAltScreen(slot) ||
      !slot.isDirectTyping ||
      !usePreferencesStore.getState().terminalSuggestEnabled
    ) {
      useTerminalSuggestStore.getState().clear(leafId);
      return;
    }

    const term = slot.term;
    const buf = term.buffer.active;
    const cursorX = buf.cursorX;
    const cursorY = buf.cursorY;
    const baseY = buf.baseY;
    const line = buf.getLine(cursorY + baseY);
    const lineText = line ? line.translateToString(true) : "";

    const query = extractCurrentPromptInput(lineText, cursorX).trim();
    if (!query || query.length < 1) {
      useTerminalSuggestStore.getState().clear(leafId);
      return;
    }

    const sessionInfo = adapter?.getSessionInfo?.(leafId);
    const isUnix =
      sessionInfo?.isUnix ??
      (sessionInfo?.workspaceEnv?.kind === "ssh" ||
        sessionInfo?.workspaceEnv?.kind === "docker" ||
        sessionInfo?.workspaceEnv?.kind === "wsl" ||
        !IS_WINDOWS);

    try {
      const pred = await predictTerminalSuggestions(
        query,
        {
          leafId,
          workspaceEnv: sessionInfo?.workspaceEnv,
          cwd: sessionInfo?.cwd,
          isUnix,
        },
        8,
      );

      if (
        slot.currentLeafId !== leafId ||
        !slot.isDirectTyping ||
        !usePreferencesStore.getState().terminalSuggestEnabled
      ) {
        return;
      }

      const cols = Math.max(1, term.cols);
      const rows = Math.max(1, term.rows);
      const hostW = slot.host.clientWidth || 800;
      const hostH = slot.host.clientHeight || 500;
      const cellWidth = hostW / cols;
      const cellHeight = hostH / rows;

      useTerminalSuggestStore.getState().setSuggest({
        leafId,
        open: pred.items.length > 0,
        query,
        items: pred.items,
        structuredItems: pred.structuredItems,
        selectedIndex: 0,
        navigated: false,
        ghostTail: pred.ghostTail,
        isPathContext: pred.isPathContext,
        hasRealPaths: pred.hasRealPaths,
        cursorX,
        cursorY,
        cellWidth,
        cellHeight,
        lineX: cursorX * cellWidth,
        lineY: (cursorY + 1) * cellHeight,
        containerWidth: hostW,
        containerHeight: hostH,
      });
    } catch {
      useTerminalSuggestStore.getState().clear(leafId);
    }
  }, 40);
}

function createSlot(): Slot {
  let focusTerminal = () => {};
  const term = new Terminal({
    ...termOptions(),
    linkHandler: createTerminalLinkHandler(() => focusTerminal()),
  });
  focusTerminal = () => term.focus();
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const serializeAddon = new SerializeAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(serializeAddon);
  term.loadAddon(
    new WebLinksAddon((_e, uri) => {
      void openExternalUrl(uri, () => term.focus());
    }),
  );
  term.loadAddon(
    new WebLinksAddon(
      (_e, uri) => {
        void handleTerminalGitTrust(uri, () => term.focus());
      },
      {
        urlRegex: SAFE_DIR_LINK_REGEX,
      },
    ),
  );
  term.loadAddon(
    new WebLinksAddon(
      (_e, uri) => {
        void handleTerminalGitTrust(uri, () => term.focus());
      },
      {
        urlRegex: DUBIOUS_OWNERSHIP_LINK_REGEX,
      },
    ),
  );

  const host = document.createElement("div");
  host.style.cssText =
    "width:100%;height:100%;contain:strict;overflow:hidden;background-color:transparent;";
  host.setAttribute("data-voktty-slot", String(slots.length));
  getRecycler().appendChild(host);
  term.open(host);

  const slot: Slot = {
    id: slots.length,
    term,
    fitAddon,
    searchAddon,
    serializeAddon,
    host,
    webglAddon: null,
    webglCanvases: [],
    currentLeafId: null,
    retainedLeafId: null,
    fixedGrid: false,
    parked: false,
    oscDisposers: [],
    observer: null,
    fitTimer: null,
    ptyTimer: null,
    webglReapTimer: null,
    slotReapTimer: null,
    unhideRaf: null,
    resizeRaf: null,
    lastCols: term.cols,
    lastRows: term.rows,
    lastW: 0,
    lastH: 0,
    lastUsedAt: 0,
    imeState: createImeBridgeState(),
    selectionCopyTimer: null,
    isDirectTyping: false,
  };

  // Some WKWebView builds bypass xterm's composition events. The pure bridge
  // repairs that path and stands down when native composition is observed.
  if (IS_MAC) {
    const ta = slot.term.textarea;
    if (ta) {
      const imeState = slot.imeState;
      term.onKey(({ key }) => {
        const leafId = slot.currentLeafId;
        if (leafId !== null) noteXtermKeyData(imeState, leafId, key);
      });
      ta.addEventListener("keyup", () => clearXtermKeyData(imeState));
      ta.addEventListener("input", (ev) => {
        const e = ev as InputEvent;
        if (slot.currentLeafId === null) return;
        const core = (
          slot.term as unknown as {
            _core?: { _keyDownSeen?: boolean; _keyPressHandled?: boolean };
          }
        )._core;
        const out = imeBridgeInput(
          imeState,
          slot.currentLeafId,
          { inputType: e.inputType, data: e.data, composed: e.composed },
          {
            keyDownSeen: core?._keyDownSeen ?? false,
            keyPressHandled: core?._keyPressHandled ?? false,
          },
        );
        if (out) adapter?.resolveLeaf(slot.currentLeafId)?.writeToPty(out);
      });
      // Native composition means xterm owns this slot's IME delivery.
      ta.addEventListener("compositionstart", () =>
        noteNativeComposition(imeState),
      );
      ta.addEventListener("compositionend", () => resetImeBridge(imeState));
      ta.addEventListener("blur", () => resetImeBridge(imeState));
    }
  }

  term.attachCustomKeyEventHandler((event) => {
    // During IME composition the browser is assembling a multi-keystroke
    // character (Chinese pinyin → hanzi, Korean jamo → syllable, etc.).
    // Raw keydown events — including the Enter that commits a candidate —
    // must NOT be forwarded to the PTY; xterm will receive the final
    // composed string through its own compositionend handler instead.
    // keyCode 229 ("Process") is what Chromium reports for every key
    // pressed inside an active IME session when isComposing is not yet set.
    if (event.isComposing || event.keyCode === 229) return false;

    const leafId = slot.currentLeafId;
    if (leafId === null) return false;
    const bridge = adapter?.resolveLeaf(leafId);
    if (!bridge) return true;

    // Track typing intent and record executed command
    if (event.type === "keydown") {
      if (event.key === "Enter") {
        if (!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
          const buf = slot.term.buffer.active;
          const line = buf.getLine(buf.cursorY + buf.baseY);
          const lineText = line ? line.translateToString(true) : "";
          const typedCmd = extractCurrentPromptInput(lineText, buf.cursorX).trim();
          if (typedCmd && typedCmd.length > 0) {
            const sessionInfo = adapter?.getSessionInfo?.(leafId);
            const shellType = sessionInfo?.isUnix ? "unix" : (IS_WINDOWS ? "powershell" : "unix");
            historyRecord(typedCmd, shellType, sessionInfo?.workspaceEnv?.kind);
          }
        }
        slot.isDirectTyping = false;
      } else if (
        event.key === "Escape" ||
        ((event.ctrlKey || event.metaKey) &&
          (event.key === "c" || event.key === "C" || event.key === "d" || event.key === "D"))
      ) {
        slot.isDirectTyping = false;
      } else if (event.key === "Backspace") {
        slot.isDirectTyping = true;
      } else if (
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key.length === 1
      ) {
        slot.isDirectTyping = true;
      }
    }

    // Terminal inline suggestions / ghost interception
    const suggest = useTerminalSuggestStore.getState().getSuggest(leafId);
    if (suggest && suggest.open) {
      const isSearchFilterKey =
        (event.altKey && (event.key === "f" || event.key === "F" || event.code === "KeyF")) ||
        ((IS_MAC ? event.metaKey : event.ctrlKey) &&
          event.shiftKey &&
          (event.key === "f" || event.key === "F" || event.code === "KeyF"));
      if (isSearchFilterKey) {
        event.preventDefault();
        if (event.type === "keydown") {
          useTerminalSuggestStore.getState().toggleSearch(leafId, true);
        }
        return false;
      }

      if (
        event.key === "Enter" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        if (suggest.navigated || suggest.searchMode) {
          event.preventDefault();
          if (event.type === "keydown") {
            const selected =
              suggest.items[suggest.selectedIndex] ?? suggest.items[0];
            if (selected) {
              const query = suggest.query;
              if (selected.startsWith(query)) {
                const remainder = selected.slice(query.length);
                if (remainder) bridge.writeToPty(remainder);
              } else {
                const erase = "\x7f".repeat(query.length);
                bridge.writeToPty(erase + selected);
              }
              if (event.shiftKey) {
                bridge.writeToPty("\r");
              }
            }
            slot.isDirectTyping = false;
            useTerminalSuggestStore.getState().clear(leafId);
          }
          return false;
        } else {
          if (event.type === "keydown") {
            slot.isDirectTyping = false;
            useTerminalSuggestStore.getState().clear(leafId);
          }
        }
      }

      if (
        event.key === "Tab" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        const sessionInfo = adapter?.getSessionInfo?.(leafId);
        const isRemoteWithoutLocalPaths =
          sessionInfo?.isUnix &&
          !suggest.hasRealPaths &&
          sessionInfo?.workspaceEnv?.kind !== "local";

        // In remote/docker/ssh sessions without local filesystem probing,
        // if user hasn't explicitly navigated the history popup, let Tab pass
        // directly to the remote PTY so the remote shell's native path completion works!
        if (isRemoteWithoutLocalPaths && !suggest.navigated && !suggest.searchMode) {
          if (event.type === "keydown") {
            bridge.writeToPty("\t");
            slot.isDirectTyping = false;
            useTerminalSuggestStore.getState().clear(leafId);
          }
          return false;
        }

        event.preventDefault();
        if (event.type === "keydown") {
          const selected =
            suggest.items[suggest.selectedIndex] ?? suggest.items[0];
          if (selected) {
            const query = suggest.query;
            if (selected.startsWith(query)) {
              const remainder = selected.slice(query.length);
              if (remainder) bridge.writeToPty(remainder);
            } else {
              const erase = "\x7f".repeat(query.length);
              bridge.writeToPty(erase + selected);
            }
          }
          slot.isDirectTyping = false;
          useTerminalSuggestStore.getState().clear(leafId);
        }
        return false;
      }

      if (
        (event.key === "ArrowRight" || event.key === "End") &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        suggest.ghostTail
      ) {
        event.preventDefault();
        if (event.type === "keydown") {
          bridge.writeToPty(suggest.ghostTail);
          slot.isDirectTyping = false;
          useTerminalSuggestStore.getState().clear(leafId);
        }
        return false;
      }

      if (
        event.key === "ArrowDown" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        if (suggest.navigated || slot.isDirectTyping || suggest.searchMode) {
          event.preventDefault();
          if (event.type === "keydown") {
            useTerminalSuggestStore.getState().selectNext(leafId);
          }
          return false;
        }
      }

      if (
        event.key === "ArrowUp" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        if (suggest.navigated || slot.isDirectTyping || suggest.searchMode) {
          event.preventDefault();
          if (event.type === "keydown") {
            useTerminalSuggestStore.getState().selectPrev(leafId);
          }
          return false;
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        if (event.type === "keydown") {
          slot.isDirectTyping = false;
          if (suggest.searchMode) {
            useTerminalSuggestStore.getState().toggleSearch(leafId, false);
          } else if (suggest.navigated) {
            useTerminalSuggestStore.getState().setNavigated(leafId, false);
          } else {
            useTerminalSuggestStore.getState().clear(leafId);
          }
        }
        return false;
      }
    } else {
      // Suggestion popup is closed: if user navigates with Up/Down arrows directly, ensure typing flag is reset
      if (
        event.type === "keydown" &&
        (event.key === "ArrowUp" || event.key === "ArrowDown") &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        slot.isDirectTyping = false;
        useTerminalSuggestStore.getState().clear(leafId);
      }
    }

    const userShortcuts = usePreferencesStore.getState().shortcuts;
    const copilotBindings =
      userShortcuts["terminal.copilot"] ||
      SHORTCUTS.find((s) => s.id === "terminal.copilot")?.defaultBindings ||
      [];
    const isCopilotKey = copilotBindings.some((b) =>
      matchBinding(event, b, "terminal.copilot"),
    );
    if (isCopilotKey) {
      event.preventDefault();
      if (event.type === "keydown") {
        useTerminalCopilotStore.getState().toggleCopilot(leafId);
      }
      return false;
    }

    const readlineSequence = terminalReadlineSequence(event, {
      isMac: IS_MAC,
      isAlternateScreen: isAltScreen(slot),
    });
    if (readlineSequence) {
      event.preventDefault();
      if (event.type === "keydown") bridge.writeToPty(readlineSequence);
      return false;
    }
    if (isShiftEnter(event)) {
      event.preventDefault();
      if (event.type === "keydown") bridge.writeToPty("\x1b\r");
      return false;
    }
    if (isTerminalCopy(event)) {
      if (event.type === "keydown" && slot.term.hasSelection()) {
        const sel = slot.term.getSelection();
        if (sel) void writeTerminalClipboard(sel);
      }
      event.preventDefault();
      return false;
    }
    if (isTerminalPaste(event)) {
      if (event.type === "keydown") {
        const targetLeafId = slot.currentLeafId;
        void readTerminalClipboard().then((text) => {
          if (text && slot.currentLeafId === targetLeafId)
            slot.term.paste(text);
        });
      }
      event.preventDefault();
      return false;
    }
    return true;
  });

  term.onData((data) => {
    const leafId = slot.currentLeafId;
    if (leafId === null) return;
    adapter?.resolveLeaf(leafId)?.writeToPty(data);
    if (data === "\r" || data === "\x03" || data === "\x04") {
      slot.isDirectTyping = false;
      useTerminalSuggestStore.getState().clear(leafId);
    } else {
      syncTerminalSuggestions(slot);
    }
  });

  term.onCursorMove(() => syncTerminalSuggestions(slot));
  term.onLineFeed(() => syncTerminalSuggestions(slot));

  term.onSelectionChange(() => {
    if (slot.selectionCopyTimer !== null) {
      clearTimeout(slot.selectionCopyTimer);
      slot.selectionCopyTimer = null;
    }

    const leafId = slot.currentLeafId;
    if (leafId === null || !term.hasSelection()) return;

    // xterm emits selection changes while the pointer is still moving. Delay
    // the copy until the selection settles so the clipboard receives one
    // complete range instead of every intermediate mouse position.
    slot.selectionCopyTimer = setTimeout(async () => {
      slot.selectionCopyTimer = null;
      if (slot.currentLeafId !== leafId || !term.hasSelection()) return;
      const copied = await copyTerminalSelection(term, writeTerminalClipboard);
      if (copied) {
        toast.success(t("common.textCopied"), {
          duration: 1400,
          id: "terminal-clipboard-feedback",
        });
      }
    }, 120);
  });

  host.addEventListener("contextmenu", async (event) => {
    event.preventDefault();

    const leafId = slot.currentLeafId;
    if (leafId === null) return;

    // Right click is intentionally a direct paste. xterm.paste() preserves
    // bracketed-paste mode and does not submit an extra Enter key.
    const pasted = await pasteClipboardIntoTerminal(
      term,
      readTerminalClipboard,
      () => slot.currentLeafId === leafId,
    );
    if (pasted) {
      toast.success(t("common.textPasted"), {
        duration: 1400,
        id: "terminal-clipboard-feedback",
      });
    }
  });

  slots.push(slot);
  return slot;
}

type PickResult = { slot: Slot; previousLeafId: number | null };

function isAltScreen(s: Slot): boolean {
  try {
    return s.term.buffer.active.type === "alternate";
  } catch {
    return false;
  }
}

function evictionScore(s: Slot): number {
  const leafId = s.currentLeafId;
  const visible = leafId !== null && (adapter?.isLeafVisible(leafId) ?? false);
  const busy = leafId !== null && (adapter?.isLeafBusy(leafId) ?? false);
  const blocks = leafId !== null && (adapter?.isLeafBlocks(leafId) ?? false);
  const focused = leafId !== null && (adapter?.isLeafFocused(leafId) ?? false);
  return (
    (visible ? 1000 : 0) +
    (isAltScreen(s) ? 100 : 0) +
    (busy ? 80 : 0) +
    (blocks ? 50 : 0) +
    (focused ? 10 : 0) +
    s.lastUsedAt / 1e12
  );
}

function pickSlotFor(leafId: number): PickResult {
  const retainedOwn = slots.find(
    (s) => s.currentLeafId === null && s.retainedLeafId === leafId,
  );
  if (retainedOwn) return { slot: retainedOwn, previousLeafId: null };

  const clean = slots.find(
    (s) => s.currentLeafId === null && s.retainedLeafId === null,
  );
  if (clean) return { slot: clean, previousLeafId: null };
  if (slots.length < RENDERER_POOL_SIZE)
    return { slot: createSlot(), previousLeafId: null };

  // Retained buffers are cheaper to lose than bound ones: serialize, no evict.
  let retained: Slot | null = null;
  for (const s of slots) {
    if (s.currentLeafId !== null) continue;
    if (!retained || s.lastUsedAt < retained.lastUsedAt) retained = s;
  }
  if (retained) return { slot: retained, previousLeafId: null };

  let best: Slot | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const s of slots) {
    if (s.currentLeafId === leafId) return { slot: s, previousLeafId: null };
    const score = evictionScore(s);
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  const chosen = best!;
  return { slot: chosen, previousLeafId: chosen.currentLeafId };
}

export type AcquireParams = {
  leafId: number;
  container: HTMLDivElement;
  snapshot: string | null;
  // True if the slot was in alt-screen mode (TUI like vim, htop, dofek)
  // at the time it was released. When set, bindSlot skips ring replay
  // and kicks SIGWINCH so the TUI repaints from scratch.
  altScreen: boolean;
  drainRing: (write: (bytes: Uint8Array) => void) => void;
  shellExited: boolean;
  searchQuery: string | null;
  cols: number;
  rows: number;
  fixedGrid: boolean;
  registerOsc: (term: Terminal) => (() => void)[];
  onSearchReady: (addon: SearchAddon) => void;
};

export function acquireSlot(params: AcquireParams): Slot {
  const existing = slots.find((s) => s.currentLeafId === params.leafId);
  if (existing) {
    rewireSlot(existing, params);
    return existing;
  }

  const pick = pickSlotFor(params.leafId);
  if (pick.previousLeafId !== null) {
    adapter?.evictLeaf(pick.previousLeafId);
  }
  if (
    pick.slot.currentLeafId !== null &&
    pick.slot.currentLeafId !== params.leafId
  ) {
    detachSlotFromLeaf(pick.slot, false);
  }
  if (
    pick.slot.retainedLeafId !== null &&
    pick.slot.retainedLeafId !== params.leafId
  ) {
    adapter?.storeSnapshot(pick.slot.retainedLeafId, serializeSlot(pick.slot));
    discardRetention(pick.slot);
  }
  bindSlot(pick.slot, params);
  return pick.slot;
}

function discardRetention(slot: Slot): void {
  slot.retainedLeafId = null;
  for (const d of slot.oscDisposers) {
    try {
      d();
    } catch {}
  }
  slot.oscDisposers = [];
}

function bindSlot(slot: Slot, p: AcquireParams): void {
  const fast = slot.retainedLeafId === p.leafId;
  const stale =
    !slot.webglAddon ||
    slot.parked ||
    performance.now() - slot.lastUsedAt > SLOT_STALE_MS;
  const hadWebgl = !!slot.webglAddon;
  slot.retainedLeafId = null;
  slot.currentLeafId = p.leafId;
  slot.fixedGrid = p.fixedGrid;
  slot.lastUsedAt = performance.now();
  transitionImeBridgeOwner(slot.imeState, p.leafId);

  cancelPendingUnhide(slot);
  cancelWebglReap(slot);
  cancelSlotReap(slot);
  unparkSlotHost(slot);
  if (!fast) {
    slot.host.style.visibility = "hidden";
    if (hadWebgl) disposeSlotWebgl(slot);
  }

  if (slot.host.parentNode !== p.container) {
    p.container.appendChild(slot.host);
  }

  slot.term.options.disableStdin = p.shellExited;

  if (!fast) {
    slot.term.clear();
    slot.term.reset();

    if (
      p.cols > 0 &&
      p.rows > 0 &&
      (slot.term.cols !== p.cols || slot.term.rows !== p.rows)
    ) {
      slot.term.resize(p.cols, p.rows);
    }

    if (p.snapshot) {
      try {
        slot.term.write(p.snapshot);
      } catch (e) {
        console.warn("[voktty] snapshot replay failed:", e);
      }
    }
    if (p.altScreen) {
      // TUI output is incremental cursor-positioned updates that can't be
      // replayed on top of a stale snapshot; the SIGWINCH kick below makes
      // the TUI redraw from scratch instead.
      p.drainRing(() => {});
    } else {
      p.drainRing((bytes) => slot.term.write(bytes));
    }
    try {
      slot.term.write("\x1b[?25h", () => {
        if (slot.currentLeafId !== p.leafId) return;
        scheduleUnhide(slot, stale || hadWebgl, p.leafId);
      });
    } catch {
      scheduleUnhide(slot, stale || hadWebgl, p.leafId);
    }

    for (const d of slot.oscDisposers) {
      try {
        d();
      } catch {}
    }
    slot.oscDisposers = p.registerOsc(slot.term);
  } else {
    p.drainRing((bytes) => slot.term.write(bytes));
  }

  setupResizeObserver(slot, p);
  safeFitSlot(slot, p);
  slot.lastCols = slot.term.cols;
  slot.lastRows = slot.term.rows;
  if (
    !p.fixedGrid &&
    (slot.lastCols !== p.cols || slot.lastRows !== p.rows)
  ) {
    // resizePty updates session.cols/rows + pty backend; no separate scope call.
    adapter?.resolveLeaf(p.leafId)?.resizePty(slot.lastCols, slot.lastRows);
  }

  if (!fast && p.searchQuery) {
    try {
      slot.searchAddon.findNext(p.searchQuery);
    } catch {}
  }

  applyCursorBlinkOnSlot(slot, adapter?.isLeafFocused(p.leafId) ?? false);

  if (!fast && p.altScreen && !p.shellExited) {
    adapter?.resolveLeaf(p.leafId)?.kickPty(slot.term.cols, slot.term.rows);
  }

  if (fast) {
    if (stale) {
      if (!slot.webglAddon) attachWebgl(slot);
      try {
        slot.term.refresh(0, slot.term.rows - 1);
      } catch {}
    }
    if (adapter?.isLeafFocused(p.leafId)) slot.term.focus();
  }

  p.onSearchReady(slot.searchAddon);
}

function scheduleUnhide(
  slot: Slot,
  stale: boolean,
  expectedLeafId: number,
): void {
  cancelPendingUnhide(slot);
  slot.unhideRaf = requestAnimationFrame(() => {
    slot.unhideRaf = null;
    if (slot.currentLeafId !== expectedLeafId) return;
    slot.host.style.visibility = "";
    if (stale) {
      if (!slot.webglAddon) attachWebgl(slot);
      try {
        slot.term.refresh(0, slot.term.rows - 1);
      } catch {}
    }
    const leafId = slot.currentLeafId;
    if (leafId !== null && adapter?.isLeafFocused(leafId)) {
      slot.term.focus();
    }
  });
}

function cancelPendingUnhide(slot: Slot): void {
  if (slot.unhideRaf !== null) {
    cancelAnimationFrame(slot.unhideRaf);
    slot.unhideRaf = null;
  }
}

function rewireSlot(slot: Slot, p: AcquireParams): void {
  slot.lastUsedAt = performance.now();
  slot.fixedGrid = p.fixedGrid;
  unparkSlotHost(slot);
  if (slot.host.parentNode !== p.container) {
    p.container.appendChild(slot.host);
  }
  setupResizeObserver(slot, p);
  safeFitSlot(slot, p);
  if (
    !p.fixedGrid &&
    (slot.term.cols !== p.cols || slot.term.rows !== p.rows)
  ) {
    adapter?.resolveLeaf(p.leafId)?.resizePty(slot.term.cols, slot.term.rows);
  }
  slot.lastCols = slot.term.cols;
  slot.lastRows = slot.term.rows;
  p.onSearchReady(slot.searchAddon);
}

function safeFitSlot(slot: Slot, p: AcquireParams): boolean {
  if (p.fixedGrid || slot.parked || slot.currentLeafId !== p.leafId) {
    return false;
  }
  const container = p.container;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w <= 0 || h <= 0) return false;
  if (w === slot.lastW && h === slot.lastH) return false;
  slot.lastW = w;
  slot.lastH = h;

  const proposed = slot.fitAddon.proposeDimensions();
  if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) return false;

  if (proposed.cols !== slot.term.cols || proposed.rows !== slot.term.rows) {
    slot.term.resize(proposed.cols, proposed.rows);
    return true;
  }
  return false;
}

function setupResizeObserver(slot: Slot, p: AcquireParams): void {
  slot.observer?.disconnect();
  if (slot.fitTimer) clearTimeout(slot.fitTimer);
  if (slot.ptyTimer) clearTimeout(slot.ptyTimer);
  if (slot.resizeRaf !== null) cancelAnimationFrame(slot.resizeRaf);
  slot.fitTimer = null;
  slot.ptyTimer = null;
  slot.resizeRaf = null;

  const flushPty = () => {
    slot.ptyTimer = null;
    if (slot.currentLeafId !== p.leafId) return;
    if (slot.term.cols === slot.lastCols && slot.term.rows === slot.lastRows)
      return;
    slot.lastCols = slot.term.cols;
    slot.lastRows = slot.term.rows;
    if (!p.fixedGrid) {
      adapter?.resolveLeaf(p.leafId)?.resizePty(slot.lastCols, slot.lastRows);
    }
  };

  slot.observer = new ResizeObserver(() => {
    if (slot.parked) return;
    if (slot.resizeRaf !== null) cancelAnimationFrame(slot.resizeRaf);
    slot.resizeRaf = requestAnimationFrame(() => {
      slot.resizeRaf = null;
      if (slot.parked || slot.currentLeafId !== p.leafId) return;
      const changed = safeFitSlot(slot, p);
      if (changed) {
        if (slot.ptyTimer) clearTimeout(slot.ptyTimer);
        slot.ptyTimer = setTimeout(flushPty, PTY_RESIZE_DEBOUNCE_MS);
      }
    });
  });
  slot.observer.observe(p.container);
}

export type SerializeOutput = {
  snapshot: string | null;
  cols: number;
  rows: number;
  altScreen: boolean;
};

export type ReleaseOutput = { cols: number; rows: number };

export function releaseSlot(leafId: number): ReleaseOutput | null {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return null;
  detachSlotFromLeaf(slot, true);
  return { cols: slot.term.cols, rows: slot.term.rows };
}

function serializeSlot(slot: Slot): SerializeOutput {
  let snapshot: string | null = null;
  try {
    const cap = Math.min(
      SNAPSHOT_SCROLLBACK_CAP,
      usePreferencesStore.getState().terminalScrollback,
    );
    snapshot = slot.serializeAddon.serialize({ scrollback: cap });
  } catch (e) {
    console.warn("[voktty] serialize failed:", e);
  }
  return {
    snapshot,
    cols: slot.term.cols,
    rows: slot.term.rows,
    altScreen: isAltScreen(slot),
  };
}

export const COLLAB_SNAPSHOT_MAX_BYTES = 512 * 1024;

function serializeSlotForCollaboration(
  slot: Slot,
  maxBytes: number,
): SerializeOutput & { snapshot: string } {
  const preferredScrollback = Math.min(
    SNAPSHOT_SCROLLBACK_CAP,
    usePreferencesStore.getState().terminalScrollback,
  );
  const encoder = new TextEncoder();
  const serialize = (scrollback: number) =>
    slot.serializeAddon.serialize({ scrollback });
  let snapshot = serialize(preferredScrollback);
  if (encoder.encode(snapshot).byteLength > maxBytes) {
    let low = 0;
    let high = Math.max(0, preferredScrollback - 1);
    let best: string | null = null;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = serialize(middle);
      if (encoder.encode(candidate).byteLength <= maxBytes) {
        best = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (best === null) {
      throw new Error("collab_snapshot_too_large");
    }
    snapshot = best;
  }
  return {
    snapshot,
    cols: slot.term.cols,
    rows: slot.term.rows,
    altScreen: isAltScreen(slot),
  };
}

export function captureLeafCollaborationSnapshot(
  leafId: number,
  maxBytes = COLLAB_SNAPSHOT_MAX_BYTES,
): Promise<SerializeOutput & { snapshot: string }> {
  const slot = getLiveSlotForLeaf(leafId);
  if (!slot) return Promise.reject(new Error("collab_terminal_not_rendered"));
  return new Promise((resolve, reject) => {
    slot.term.write("", () => {
      try {
        resolve(serializeSlotForCollaboration(slot, maxBytes));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function detachSlotFromLeaf(slot: Slot, retain: boolean): void {
  if (retain && slot.currentLeafId !== null) {
    slot.retainedLeafId = slot.currentLeafId;
    parkSlotHost(slot);
  } else {
    discardRetention(slot);
    unparkSlotHost(slot);
    if (slot.host.parentNode !== getRecycler()) {
      getRecycler().appendChild(slot.host);
    }
  }

  slot.observer?.disconnect();
  slot.observer = null;
  if (slot.fitTimer) clearTimeout(slot.fitTimer);
  if (slot.ptyTimer) clearTimeout(slot.ptyTimer);
  if (slot.resizeRaf !== null) cancelAnimationFrame(slot.resizeRaf);
  slot.fitTimer = null;
  slot.ptyTimer = null;
  slot.resizeRaf = null;
  if (slot.selectionCopyTimer !== null) {
    clearTimeout(slot.selectionCopyTimer);
    slot.selectionCopyTimer = null;
  }

  cancelPendingUnhide(slot);
  slot.host.style.visibility = "";

  slot.currentLeafId = null;
  slot.lastUsedAt = performance.now();
  transitionImeBridgeOwner(slot.imeState, null);
  scheduleWebglReap(slot);
  scheduleSlotReap(slot);
}

// display:none makes xterm's IntersectionObserver pause rendering while the
// buffer keeps parsing writes; visibility:hidden would not (geometry remains).
function parkSlotHost(slot: Slot): void {
  if (slot.parked) return;
  slot.parked = true;
  slot.host.style.display = "none";
}

function unparkSlotHost(slot: Slot): void {
  if (!slot.parked) return;
  slot.parked = false;
  slot.host.style.display = "";
}

function scheduleWebglReap(slot: Slot): void {
  cancelWebglReap(slot);
  if (!slot.webglAddon) return;
  slot.webglReapTimer = setTimeout(() => {
    slot.webglReapTimer = null;
    if (slot.currentLeafId === null || slot.parked) disposeSlotWebgl(slot);
  }, WEBGL_REAP_GRACE_MS);
}

function cancelWebglReap(slot: Slot): void {
  if (slot.webglReapTimer !== null) {
    clearTimeout(slot.webglReapTimer);
    slot.webglReapTimer = null;
  }
}

function scheduleSlotReap(slot: Slot): void {
  cancelSlotReap(slot);
  slot.slotReapTimer = setTimeout(() => {
    slot.slotReapTimer = null;
    reapIdleSlot(slot);
  }, SLOT_REAP_GRACE_MS);
}

function cancelSlotReap(slot: Slot): void {
  if (slot.slotReapTimer !== null) {
    clearTimeout(slot.slotReapTimer);
    slot.slotReapTimer = null;
  }
}

function reapIdleSlot(slot: Slot): void {
  if (slot.currentLeafId !== null) return;
  const idle = slots.filter((s) => s.currentLeafId === null);
  if (idle.length <= IDLE_SLOTS_KEEP_WARM) return;
  idle.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const surplus = idle.slice(0, idle.length - IDLE_SLOTS_KEEP_WARM);
  if (!surplus.includes(slot)) return;
  if (slot.retainedLeafId !== null) {
    adapter?.storeSnapshot(slot.retainedLeafId, serializeSlot(slot));
  }
  disposeSlot(slot);
}

function disposeSlot(slot: Slot): void {
  cancelSlotReap(slot);
  cancelWebglReap(slot);
  cancelPendingUnhide(slot);
  if (slot.fitTimer) clearTimeout(slot.fitTimer);
  if (slot.ptyTimer) clearTimeout(slot.ptyTimer);
  if (slot.resizeRaf !== null) cancelAnimationFrame(slot.resizeRaf);
  if (slot.selectionCopyTimer !== null) {
    clearTimeout(slot.selectionCopyTimer);
    slot.selectionCopyTimer = null;
  }
  slot.fitTimer = null;
  slot.ptyTimer = null;
  slot.resizeRaf = null;
  slot.observer?.disconnect();
  slot.observer = null;
  for (const d of slot.oscDisposers) {
    try {
      d();
    } catch {}
  }
  slot.oscDisposers = [];
  disposeSlotWebgl(slot);
  try {
    slot.term.dispose();
  } catch (e) {
    console.warn("[voktty] slot dispose failed:", e);
  }
  slot.host.remove();
  const i = slots.indexOf(slot);
  if (i >= 0) slots.splice(i, 1);
}

const WEBGL_RECOVERY_DELAY_MS = 250;
// Below this a re-shown slot is fresh enough to trust; above it, repaint on
// unhide to defeat silent GPU/context staleness.
const SLOT_STALE_MS = 10_000;
const WEBGL_REAP_GRACE_MS = 30_000;
const SLOT_REAP_GRACE_MS = 45_000;
const IDLE_SLOTS_KEEP_WARM = 1;

function attachWebgl(slot: Slot): void {
  if (slot.webglAddon || !slot.term.element) return;
  if (!usePreferencesStore.getState().terminalWebglEnabled) return;
  const elem = slot.term.element;
  const before = new Set<HTMLCanvasElement>(
    elem.querySelectorAll<HTMLCanvasElement>("canvas"),
  );
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      const cur = slot.webglAddon;
      if (cur === webgl) {
        slot.webglAddon = null;
        slot.webglCanvases = [];
      }
      try {
        webgl.dispose();
      } catch {}
      // Recovery: WebKit may transiently lose contexts on sleep/wake or GPU
      // reset; without re-attach the slot would silently fall back to DOM
      // forever. Defer past WebKit's reset window before retrying.
      setTimeout(() => {
        if (slot.webglAddon || slot.currentLeafId === null || slot.parked)
          return;
        if (!usePreferencesStore.getState().terminalWebglEnabled) return;
        attachWebgl(slot);
        if (slot.webglAddon) {
          try {
            slot.term.refresh(0, slot.term.rows - 1);
          } catch {}
        }
      }, WEBGL_RECOVERY_DELAY_MS);
    });
    slot.term.loadAddon(webgl);
    const after = elem.querySelectorAll<HTMLCanvasElement>("canvas");
    const added: HTMLCanvasElement[] = [];
    for (const c of after) {
      if (!before.has(c)) {
        c.style.contain = "strict";
        added.push(c);
      }
    }
    slot.webglAddon = webgl;
    slot.webglCanvases = added;
  } catch (e) {
    console.warn("[voktty-webgl] unavailable:", e);
  }
}

function disposeSlotWebgl(slot: Slot): void {
  if (!slot.webglAddon) return;
  const addon = slot.webglAddon;
  for (const canvas of slot.webglCanvases) releaseCanvasContext(canvas);
  slot.webglCanvases = [];
  try {
    addon.dispose();
  } catch (e) {
    console.warn("[voktty-webgl] dispose failed:", e);
  }
  try {
    const r = (
      addon as unknown as { _renderer?: Record<string, unknown> | null }
    )._renderer;
    if (r) {
      r._canvas = null;
      r._gl = null;
      r._charAtlas = null;
      r._atlas = null;
    }
    (
      addon as unknown as { _renderer?: unknown; _renderService?: unknown }
    )._renderer = null;
    (
      addon as unknown as { _renderer?: unknown; _renderService?: unknown }
    )._renderService = null;
  } catch {}
  slot.webglAddon = null;
}

function releaseCanvasContext(canvas: HTMLCanvasElement): void {
  let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
  } catch {}
  if (!gl) {
    try {
      gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    } catch {}
  }
  if (gl) {
    try {
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext && !gl.isContextLost()) ext.loseContext();
    } catch {}
  }
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {}
}

export function applyWebglPreference(enabled: boolean): void {
  for (const slot of slots) {
    if (enabled) {
      if (slot.currentLeafId !== null && !slot.parked && !slot.webglAddon) {
        attachWebgl(slot);
        if (slot.webglAddon) {
          try {
            slot.term.refresh(0, slot.term.rows - 1);
          } catch {}
        }
      }
    } else if (slot.webglAddon) {
      cancelWebglReap(slot);
      disposeSlotWebgl(slot);
    }
  }
}

// Parked and retained slots can't be measured (display:none); poison lastW
// so the refit happens on unpark/rebind instead.
function refitSlot(slot: Slot): void {
  if (slot.parked || slot.currentLeafId === null) {
    slot.lastW = -1;
    return;
  }
  if (slot.fixedGrid) {
    try {
      slot.term.refresh(0, slot.term.rows - 1);
    } catch {}
    return;
  }
  slot.fitAddon.fit();
  slot.lastCols = slot.term.cols;
  slot.lastRows = slot.term.rows;
  adapter
    ?.resolveLeaf(slot.currentLeafId)
    ?.resizePty(slot.term.cols, slot.term.rows);
}

export function applyLetterSpacing(spacing: number): void {
  for (const slot of slots) {
    if (slot.term.options.letterSpacing === spacing) continue;
    slot.term.options.letterSpacing = spacing;
    refitSlot(slot);
  }
}

export function applyTerminalFont(font: RendererFont): void {
  const next = {
    fontFamily: resolveFontFamily(font.fontFamily),
    fontWeight: font.fontWeight,
    fontSize: font.fontSize,
  };
  configuredFont = next;
  for (const slot of slots) {
    let refit = false;
    if (slot.term.options.fontFamily !== next.fontFamily) {
      slot.term.options.fontFamily = next.fontFamily;
      refit = true;
    }
    if (slot.term.options.fontSize !== next.fontSize) {
      slot.term.options.fontSize = next.fontSize;
      refit = true;
    }
    if (slot.term.options.fontWeight !== next.fontWeight) {
      slot.term.options.fontWeight = next.fontWeight as FontWeight;
    }
    if (refit) refitSlot(slot);
  }
}

export function applyScrollback(value: number): void {
  for (const slot of slots) {
    if (slot.term.options.scrollback === value) continue;
    slot.term.options.scrollback = value;
  }
}

export function applyTheme(): void {
  const theme = buildTerminalTheme();
  const signature = JSON.stringify(theme);
  if (signature === appliedThemeSignature) return;
  appliedThemeSignature = signature;
  for (const slot of slots) {
    slot.term.options.theme = theme;
  }
}

export function focusSlot(leafId: number): void {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  slot?.term.focus();
}

export function setSlotFocused(leafId: number, focused: boolean): void {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return;
  applyCursorBlinkOnSlot(slot, focused);
}

export function applyCursorBlink(enabled: boolean): void {
  cursorBlinkEnabled = enabled;
  for (const slot of slots) {
    if (slot.currentLeafId === null) continue;
    applyCursorBlinkOnSlot(
      slot,
      adapter?.isLeafFocused(slot.currentLeafId) ?? false,
    );
  }
}

export function applyCursorStyle(style: TerminalCursorStyle): void {
  for (const slot of slots) {
    if (slot.term.options.cursorStyle === style) continue;
    slot.term.options.cursorStyle = style;
  }
}

function applyCursorBlinkOnSlot(slot: Slot, focused: boolean): void {
  const desired = shouldCursorBlink(cursorBlinkEnabled, windowActive, focused);
  if (slot.term.options.cursorBlink === desired) return;
  slot.term.options.cursorBlink = desired;
}

export function getSlotForLeaf(leafId: number): Slot | null {
  return slots.find((s) => s.currentLeafId === leafId) ?? null;
}

export function isLeafAltScreen(leafId: number): boolean {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  return slot ? isAltScreen(slot) : false;
}

export function parkLeafSlot(leafId: number): void {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return;
  parkSlotHost(slot);
  scheduleWebglReap(slot);
}

export function refreshLeafSlot(leafId: number): void {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return;
  cancelWebglReap(slot);
  unparkSlotHost(slot);
  if (usePreferencesStore.getState().terminalWebglEnabled && !slot.webglAddon) {
    attachWebgl(slot);
  }
  // The observer skips parked slots; catch up on container resizes here.
  const container = slot.host.parentElement;
  if (
    !slot.fixedGrid &&
    container &&
    (container.clientWidth !== slot.lastW ||
      container.clientHeight !== slot.lastH)
  ) {
    slot.lastW = container.clientWidth;
    slot.lastH = container.clientHeight;
    slot.fitAddon.fit();
    if (slot.term.cols !== slot.lastCols || slot.term.rows !== slot.lastRows) {
      slot.lastCols = slot.term.cols;
      slot.lastRows = slot.term.rows;
      adapter?.resolveLeaf(leafId)?.resizePty(slot.lastCols, slot.lastRows);
    }
  }
  try {
    slot.term.refresh(0, slot.term.rows - 1);
  } catch {}
}

export function setLeafCanonicalGrid(
  leafId: number,
  cols: number,
  rows: number,
): void {
  if (cols <= 0 || rows <= 0) return;
  const slot = slots.find((candidate) => candidate.currentLeafId === leafId);
  if (!slot) return;
  slot.fixedGrid = true;
  if (slot.term.cols !== cols || slot.term.rows !== rows) {
    slot.term.resize(cols, rows);
  }
  slot.lastCols = cols;
  slot.lastRows = rows;
  try {
    slot.term.refresh(0, rows - 1);
  } catch {}
}

export function disposeLeafSlot(leafId: number): void {
  const slot = slots.find(
    (s) => s.currentLeafId === leafId || s.retainedLeafId === leafId,
  );
  if (slot) disposeSlot(slot);
}

export function discardRetainedSlot(leafId: number): void {
  const slot = slots.find(
    (s) => s.currentLeafId === null && s.retainedLeafId === leafId,
  );
  if (!slot) return;
  discardRetention(slot);
  slot.term.clear();
  slot.term.reset();
}

export function getLiveSlotForLeaf(leafId: number): Slot | null {
  return (
    slots.find(
      (s) => s.currentLeafId === leafId || s.retainedLeafId === leafId,
    ) ?? null
  );
}

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

function isTerminalCopy(e: KeyboardEvent): boolean {
  return (
    !IS_MAC &&
    e.ctrlKey &&
    e.shiftKey &&
    !e.altKey &&
    !e.metaKey &&
    (e.code === "KeyC" || e.key === "c" || e.key === "C")
  );
}

function isTerminalPaste(e: KeyboardEvent): boolean {
  return (
    !IS_MAC &&
    e.ctrlKey &&
    e.shiftKey &&
    !e.altKey &&
    !e.metaKey &&
    (e.code === "KeyV" || e.key === "v" || e.key === "V")
  );
}

function isShiftEnter(e: KeyboardEvent): boolean {
  return (
    e.key === "Enter" && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
  );
}
