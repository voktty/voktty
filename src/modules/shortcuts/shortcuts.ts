import { IS_MAC, MOD_PROP } from "@/lib/platform";

/**
 * Single source of truth for keyboard shortcuts.
 */

export type ShortcutId =
  | "commandPalette.open"
  | "commandPalette.content"
  | "file.quickOpen"
  | "tabs.launchpad"
  | "tab.new"
  | "tab.newBlock"
  | "tab.newPrivate"
  | "tab.newPreview"
  | "preview.toggleInspector"
  | "tab.newApiClient"
  | "tab.newEditor"
  | "tab.newHarness"
  | "tab.close"
  | "tab.next"
  | "tab.prev"
  | "tab.selectByIndex"
  | "space.next"
  | "space.prev"
  | "space.overview"
  | "pane.splitRight"
  | "pane.splitDown"
  | "pane.focusNext"
  | "pane.focusPrev"
  | "pane.swapLeft"
  | "pane.swapRight"
  | "pane.swapUp"
  | "pane.swapDown"
  | "pane.source"
  | "terminal.clear"
  | "terminal.copilot"
  | "terminal.toggleInput"
  | "terminal.history"
  | "blocks.prev"
  | "blocks.next"
  | "search.focus"
  | "explorer.search"
  | "explorer.focus"
  | "explorer.toggleHidden"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "view.zenMode"
  | "ai.toggle"
  | "ai.toggleMini"
  | "ai.askSelection"
  | "agentHistory.open"
  | "agent.focusAttention"
  | "settings.open"
  | "sidebar.toggle"
  | "sourceControl.toggle"
  | "editor.undo"
  | "editor.redo"
  | "editor.aiComplete"
  | "editor.codeComplete"
  | "editor.gotoLine"
  | "editor.formatDocument"
  | "editor.quickFix"
  | "editor.signatureHelp"
  | "editor.goToDefinition"
  | "editor.peekDefinition"
  | "editor.goToTypeDefinition"
  | "editor.goToImplementation"
  | "editor.findReferences"
  | "editor.navigateBack"
  | "editor.navigateForward"
  | "editor.outline"
  | "editor.openFile"
  | "editor.openFolder";

export type ShortcutGroup =
  | "General"
  | "Tabs"
  | "Spaces"
  | "Panes"
  | "Terminal"
  | "Search"
  | "AI"
  | "View"
  | "Editor";

export type KeyBinding = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export type Shortcut = {
  id: ShortcutId;
  labelKey: string;
  group: ShortcutGroup;
  defaultBindings: KeyBinding[];
  allowRepeat?: boolean;
};

export const SHORTCUTS: Shortcut[] = [
  {
    id: "commandPalette.open",
    labelKey: "shortcuts.labels.commandPaletteOpen",
    group: "General",
    defaultBindings: [{ key: "F1" }],
  },
  {
    id: "commandPalette.content",
    labelKey: "shortcuts.labels.commandPaletteContent",
    group: "General",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "f" }],
  },
  {
    id: "file.quickOpen",
    labelKey: "shortcuts.labels.fileQuickOpen",
    group: "General",
    defaultBindings: [{ [MOD_PROP]: true, key: "p" }],
  },
  {
    id: "tabs.launchpad",
    labelKey: "shortcuts.labels.tabsLaunchpad",
    group: "Tabs",
    defaultBindings: [],
  },
  {
    id: "settings.open",
    labelKey: "shortcuts.labels.settingsOpen",
    group: "General",
    defaultBindings: [{ [MOD_PROP]: true, key: "," }],
  },
  {
    id: "tab.new",
    labelKey: "shortcuts.labels.tabNew",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, key: "t" }],
  },
  {
    id: "tab.newBlock",
    labelKey: "shortcuts.labels.tabNewBlock",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "t" }],
  },
  {
    id: "tab.newPrivate",
    labelKey: "shortcuts.labels.tabNewPrivate",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, key: "r" }],
  },
  {
    id: "tab.newPreview",
    labelKey: "shortcuts.labels.tabNewPreview",
    group: "Tabs",
    // Cmd/Ctrl+P belongs to Quick Open, so web preview uses this binding.
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "o" }],
  },
  {
    id: "preview.toggleInspector",
    labelKey: "shortcuts.labels.previewToggleInspector",
    group: "Tabs",
    defaultBindings: [
      { [MOD_PROP]: true, key: "g" },
      { [MOD_PROP]: true, shift: true, key: "c" },
    ],
  },
  {
    id: "tab.newApiClient",
    labelKey: "shortcuts.labels.tabNewApiClient",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "a" }],
  },
  {
    id: "tab.newEditor",
    labelKey: "shortcuts.labels.tabNewEditor",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, key: "e" }],
  },
  {
    id: "tab.newHarness",
    labelKey: "shortcuts.labels.tabNewHarness",
    group: "AI",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "d" }],
  },
  {
    id: "tab.close",
    labelKey: "shortcuts.labels.tabClose",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, key: "w" }],
  },
  {
    id: "pane.splitRight",
    labelKey: "shortcuts.labels.paneSplitRight",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, key: "d" }],
  },
  {
    id: "pane.splitDown",
    labelKey: "shortcuts.labels.paneSplitDown",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "d" }],
  },
  {
    id: "pane.focusNext",
    labelKey: "shortcuts.labels.paneFocusNext",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, key: "]" }],
  },
  {
    id: "pane.focusPrev",
    labelKey: "shortcuts.labels.paneFocusPrevious",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, key: "[" }],
  },
  {
    id: "pane.swapLeft",
    labelKey: "shortcuts.labels.paneSwapLeft",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, alt: true, key: "ArrowLeft" }],
  },
  {
    id: "pane.swapRight",
    labelKey: "shortcuts.labels.paneSwapRight",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, alt: true, key: "ArrowRight" }],
  },
  {
    id: "pane.swapUp",
    labelKey: "shortcuts.labels.paneSwapUp",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, alt: true, key: "ArrowUp" }],
  },
  {
    id: "pane.swapDown",
    labelKey: "shortcuts.labels.paneSwapDown",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, alt: true, key: "ArrowDown" }],
  },
  {
    id: "pane.source",
    labelKey: "shortcuts.labels.paneSource",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "g" }],
  },
  {
    id: "terminal.clear",
    labelKey: "shortcuts.labels.terminalClear",
    group: "Terminal",
    defaultBindings: IS_MAC ? [{ meta: true, shift: true, key: "k" }] : [],
  },
  {
    id: "terminal.copilot",
    labelKey: "shortcuts.labels.terminalCopilot",
    group: "Terminal",
    defaultBindings: [{ [MOD_PROP]: true, key: "k" }],
  },
  {
    id: "terminal.toggleInput",
    labelKey: "shortcuts.labels.terminalToggleInput",
    group: "Terminal",
    defaultBindings: [{ [MOD_PROP]: true, key: "u" }],
  },
  {
    id: "terminal.history",
    labelKey: "shortcuts.labels.terminalHistory",
    group: "Terminal",
    defaultBindings: [{ [MOD_PROP]: true, key: "h" }],
  },
  {
    id: "blocks.prev",
    labelKey: "shortcuts.labels.blocksPrevious",
    group: "Terminal",
    defaultBindings: [{ [MOD_PROP]: true, key: "ArrowUp" }],
    allowRepeat: true,
  },
  {
    id: "blocks.next",
    labelKey: "shortcuts.labels.blocksNext",
    group: "Terminal",
    defaultBindings: [{ [MOD_PROP]: true, key: "ArrowDown" }],
    allowRepeat: true,
  },
  {
    id: "tab.next",
    labelKey: "shortcuts.labels.tabNext",
    group: "Tabs",
    defaultBindings: [{ ctrl: true, key: "Tab" }],
    allowRepeat: true,
  },
  {
    id: "tab.prev",
    labelKey: "shortcuts.labels.tabPrevious",
    group: "Tabs",
    defaultBindings: [{ ctrl: true, shift: true, key: "Tab" }],
    allowRepeat: true,
  },
  {
    id: "tab.selectByIndex",
    labelKey: "shortcuts.labels.tabSelectByIndex",
    group: "Tabs",
    defaultBindings: [{ [MOD_PROP]: true, key: "1" }],
  },
  {
    id: "space.next",
    labelKey: "shortcuts.labels.spaceNext",
    group: "Spaces",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "]" }],
  },
  {
    id: "space.prev",
    labelKey: "shortcuts.labels.spacePrevious",
    group: "Spaces",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "[" }],
  },
  {
    id: "space.overview",
    labelKey: "shortcuts.labels.spaceOverview",
    group: "Spaces",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "s" }],
  },
  {
    id: "explorer.search",
    labelKey: "shortcuts.labels.explorerSearch",
    group: "Search",
    defaultBindings: [],
  },
  {
    id: "search.focus",
    labelKey: "shortcuts.labels.searchFocus",
    group: "Search",
    defaultBindings: [
      { [MOD_PROP]: true, key: "f" },
      { key: "F3" },
      { shift: true, key: "F3" },
    ],
  },
  {
    id: "ai.toggle",
    labelKey: "shortcuts.labels.aiToggle",
    group: "AI",
    defaultBindings: [{ [MOD_PROP]: true, key: "i" }],
  },
  {
    id: "ai.toggleMini",
    labelKey: "shortcuts.labels.aiToggleMini",
    group: "AI",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "i" }],
  },
  {
    id: "ai.askSelection",
    labelKey: "shortcuts.labels.aiAskSelection",
    group: "AI",
    // Keep Mod+L available to the shell for clear-screen, including when
    // terminal text is selected and this shortcut is otherwise eligible.
    defaultBindings: [{ [MOD_PROP]: true, key: "j" }],
  },
  {
    id: "agentHistory.open",
    labelKey: "shortcuts.labels.agentHistoryOpen",
    group: "AI",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "y" }],
  },
  {
    id: "agent.focusAttention",
    labelKey: "shortcuts.labels.agentFocusAttention",
    group: "AI",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "a" }],
  },
  {
    id: "sidebar.toggle",
    labelKey: "shortcuts.labels.sidebarToggle",
    group: "View",
    // Plain Mod+B toggles the sidebar everywhere EXCEPT a focused terminal,
    // where it's handed to the shell / Claude Code (its "run in background"
    // key). Mod+Shift+B always toggles, including from inside a terminal.
    defaultBindings: [
      { [MOD_PROP]: true, key: "b" },
      { [MOD_PROP]: true, shift: true, key: "b" },
    ],
  },
  {
    id: "sourceControl.toggle",
    labelKey: "shortcuts.labels.sourceControlToggle",
    group: "View",
    defaultBindings: [
      { [MOD_PROP]: true, shift: true, key: "g" },
      { [MOD_PROP]: true, shift: true, key: "h" },
    ],
  },
  {
    id: "explorer.focus",
    labelKey: "shortcuts.labels.explorerFocus",
    group: "View",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "e" }],
  },
  {
    id: "explorer.toggleHidden",
    labelKey: "shortcuts.labels.explorerToggleHidden",
    group: "View",
    // Finder's toggle. The binding is on the physical Period key, so it holds
    // on layouts where Shift+. types something else.
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "." }],
  },
  {
    id: "view.zoomIn",
    labelKey: "shortcuts.labels.viewZoomIn",
    group: "View",
    defaultBindings: [
      { [MOD_PROP]: true, key: "=" },
      { [MOD_PROP]: true, shift: true, key: "+" },
    ],
    allowRepeat: true,
  },
  {
    id: "view.zoomOut",
    labelKey: "shortcuts.labels.viewZoomOut",
    group: "View",
    defaultBindings: [
      { [MOD_PROP]: true, key: "-" },
      { [MOD_PROP]: true, shift: true, key: "_" },
    ],
    allowRepeat: true,
  },
  {
    id: "view.zoomReset",
    labelKey: "shortcuts.labels.viewZoomReset",
    group: "View",
    defaultBindings: [{ [MOD_PROP]: true, key: "0" }],
  },
  {
    id: "view.zenMode",
    labelKey: "shortcuts.labels.viewZenMode",
    group: "View",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "'" }],
  },
  // Editor entries are display-only: CodeMirror's historyKeymap binds these
  // keys natively. We register them here so the shortcuts dialog can surface
  // them — they don't have App-level handlers, so `useGlobalShortcuts` falls
  // through without `preventDefault`, leaving CodeMirror to handle the event.
  // Also excluded from the customization UI in ShortcutsSection.
  {
    id: "editor.undo",
    labelKey: "shortcuts.labels.editorUndo",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, key: "z" }],
  },
  {
    id: "editor.redo",
    labelKey: "shortcuts.labels.editorRedo",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, key: "y" }],
  },
  {
    id: "editor.aiComplete",
    labelKey: "shortcuts.labels.editorAiComplete",
    group: "Editor",
    defaultBindings: [{ alt: true, key: "\\" }],
  },
  {
    id: "editor.codeComplete",
    labelKey: "shortcuts.labels.editorCodeComplete",
    group: "Editor",
    defaultBindings: [{ ctrl: true, key: " " }],
  },
  {
    id: "editor.gotoLine",
    labelKey: "shortcuts.labels.editorGotoLine",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, key: "g" }],
  },
  {
    id: "editor.navigateBack",
    labelKey: "shortcuts.labels.editorNavigateBack",
    group: "Editor",
    defaultBindings: IS_MAC
      ? [{ ctrl: true, key: "-" }]
      : [{ alt: true, key: "ArrowLeft" }],
  },
  {
    id: "editor.navigateForward",
    labelKey: "shortcuts.labels.editorNavigateForward",
    group: "Editor",
    defaultBindings: IS_MAC
      ? [{ ctrl: true, shift: true, key: "-" }]
      : [{ alt: true, key: "ArrowRight" }],
  },
  {
    id: "editor.outline",
    labelKey: "shortcuts.labels.editorOutline",
    group: "Editor",
    defaultBindings: [],
  },
  {
    id: "editor.formatDocument",
    labelKey: "shortcuts.labels.editorFormatDocument",
    group: "Editor",
    defaultBindings: [{ alt: true, shift: true, key: "f" }],
  },
  {
    id: "editor.quickFix",
    labelKey: "shortcuts.labels.editorQuickFix",
    group: "Editor",
    defaultBindings: [{ alt: true, key: "Enter" }],
  },
  {
    id: "editor.signatureHelp",
    labelKey: "shortcuts.labels.editorSignatureHelp",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: " " }],
  },
  {
    id: "editor.goToDefinition",
    labelKey: "shortcuts.labels.editorGoToDefinition",
    group: "Editor",
    defaultBindings: [{ key: "F12" }],
  },
  {
    id: "editor.peekDefinition",
    labelKey: "shortcuts.labels.editorPeekDefinition",
    group: "Editor",
    defaultBindings: [{ alt: true, key: "F12" }],
  },
  {
    id: "editor.goToTypeDefinition",
    labelKey: "shortcuts.labels.editorGoToTypeDefinition",
    group: "Editor",
    defaultBindings: [],
  },
  {
    id: "editor.goToImplementation",
    labelKey: "shortcuts.labels.editorGoToImplementation",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, key: "F12" }],
  },
  {
    id: "editor.findReferences",
    labelKey: "shortcuts.labels.editorFindReferences",
    group: "Editor",
    defaultBindings: [{ shift: true, key: "F12" }],
  },
  {
    id: "editor.openFile",
    labelKey: "shortcuts.labels.editorOpenFile",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, key: "o" }],
  },
  {
    id: "editor.openFolder",
    labelKey: "shortcuts.labels.editorOpenFolder",
    group: "Editor",
    defaultBindings: [{ [MOD_PROP]: true, shift: true, key: "o" }],
  },
];

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  "General",
  "Tabs",
  "Panes",
  "Terminal",
  "View",
  "Search",
  "AI",
  "Editor",
];

/**
 * Matching logic: checks if a KeyboardEvent matches a KeyBinding.
 */
const CODE_TO_KEY: Record<string, string> = {
  Backslash: "\\",
  Slash: "/",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Space: " ",
};

// Option and Shift combinations rewrite e.key (macOS Option gives "«", "…",
// dead keys; Shift turns "." into ">"); the physical key survives in e.code.
function keyFromCode(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  return CODE_TO_KEY[code] ?? null;
}

export function matchBinding(
  e: KeyboardEvent,
  binding: KeyBinding,
  id?: ShortcutId,
): boolean {
  const eventKey = e.key.toLowerCase();
  const bindingKey = binding.key.toLowerCase();

  // Special case for Jump to Tab 1-9
  if (id === "tab.selectByIndex") {
    if (!/^[1-9]$/.test(e.key)) return false;
  } else if (eventKey !== bindingKey) {
    if (!binding.alt && !binding.shift) return false;
    if (keyFromCode(e.code) !== bindingKey) return false;
  }

  return (
    !!e.ctrlKey === !!binding.ctrl &&
    !!e.shiftKey === !!binding.shift &&
    !!e.altKey === !!binding.alt &&
    !!e.metaKey === !!binding.meta
  );
}

/**
 * Display helpers
 */
export function getBindingTokens(binding?: KeyBinding): string[] {
  if (!binding) return [];
  const tokens: string[] = [];
  if (IS_MAC) {
    if (binding.ctrl) tokens.push("⌃");
    if (binding.alt) tokens.push("⌥");
    if (binding.shift) tokens.push("⇧");
    if (binding.meta) tokens.push("⌘");
  } else {
    if (binding.ctrl) tokens.push("Ctrl");
    if (binding.alt) tokens.push("Alt");
    if (binding.shift) tokens.push("Shift");
    if (binding.meta) tokens.push("Win");
  }

  let keyLabel = binding.key;
  if (keyLabel === " ") keyLabel = "Space";
  else if (keyLabel === "ArrowUp") keyLabel = "↑";
  else if (keyLabel === "ArrowDown") keyLabel = "↓";
  else if (keyLabel === "ArrowLeft") keyLabel = "←";
  else if (keyLabel === "ArrowRight") keyLabel = "→";
  else if (keyLabel.length === 1) keyLabel = keyLabel.toUpperCase();

  tokens.push(keyLabel);
  return tokens;
}

/** Whether the Settings recorder may accept a binding. Function keys can be
 * used without modifiers; character keys still require a primary modifier. */
export function canRecordShortcut(binding: KeyBinding): boolean {
  if (binding.ctrl || binding.alt || binding.meta) return true;
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(binding.key)) return true;
  return Boolean(binding.shift && binding.key.length > 1);
}
