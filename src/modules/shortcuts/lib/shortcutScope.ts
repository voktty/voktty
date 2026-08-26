import { IS_MAC } from "@/lib/platform";
import type { ShortcutId } from "@/modules/shortcuts/shortcuts";

export function isTerminalFocused(
  target: EventTarget | null = typeof document !== "undefined"
    ? document.activeElement
    : null,
): boolean {
  if (!target) return false;
  const el = target as { closest?: (selector: string) => unknown };
  if (typeof el.closest !== "function") return false;
  return !!el.closest(
    ".xterm, .xterm-helper-textarea, .xterm-screen, .xterm-viewport, [data-voktty-slot], [data-terminal-container]",
  );
}

function isPaneSwapShortcut(id: ShortcutId): boolean {
  return (
    id === "pane.swapLeft" ||
    id === "pane.swapRight" ||
    id === "pane.swapUp" ||
    id === "pane.swapDown"
  );
}

export function shouldDisablePaneSwapShortcut(
  id: ShortcutId,
  terminalPaneCount: number | null,
): boolean {
  return (
    isPaneSwapShortcut(id) &&
    (terminalPaneCount === null || terminalPaneCount < 2)
  );
}

export type ShortcutContextOptions = {
  id: ShortcutId;
  event: KeyboardEvent;
  activeTabKind?: string | null;
  terminalPaneCount?: number | null;
  blocksMode?: boolean;
  hasSelection?: boolean;
  isMac?: boolean;
};

export function shouldDisableShortcut(
  options: ShortcutContextOptions,
): boolean {
  const {
    id,
    event,
    activeTabKind,
    terminalPaneCount = null,
    blocksMode = false,
    hasSelection = false,
    isMac = IS_MAC,
  } = options;

  const target =
    (event.target as HTMLElement | null) ??
    (typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null);
  const inTerminal = isTerminalFocused(target);

  // 1. Pane swap shortcuts need >= 2 panes in terminal tab
  if (shouldDisablePaneSwapShortcut(id, terminalPaneCount)) {
    return true;
  }

  // 2. Editor-specific text manipulation shortcuts (undo, redo, AI complete, code complete):
  // Disabled outside editor tabs or when terminal is focused.
  if (
    id === "editor.undo" ||
    id === "editor.redo" ||
    id === "editor.aiComplete" ||
    id === "editor.codeComplete" ||
    id === "editor.gotoLine" ||
    id === "editor.formatDocument" ||
    id === "editor.quickFix" ||
    id === "editor.signatureHelp" ||
    id === "editor.goToDefinition" ||
    id === "editor.peekDefinition" ||
    id === "editor.goToTypeDefinition" ||
    id === "editor.goToImplementation" ||
    id === "editor.findReferences" ||
    id === "editor.navigateBack" ||
    id === "editor.navigateForward" ||
    id === "editor.outline"
  ) {
    return activeTabKind !== "editor" || inTerminal;
  }

  // 3. Editor file opening shortcuts (openFile -> Ctrl/Cmd+O, openFolder -> Ctrl/Cmd+Shift+O):
  // In terminal (local or remote SSH, nano, mc, bash, etc.), Ctrl+O is a critical
  // terminal command (e.g. WriteOut/Save in nano, toggle subshell in mc).
  // When inside a terminal, yield to the console. When clicked outside the console,
  // let Voktty handle pickAndOpenFile / pickAndOpenFolder.
  if (id === "editor.openFile" || id === "editor.openFolder") {
    return inTerminal;
  }

  // 4. Terminal copilot: only enabled when active tab is a terminal
  if (id === "terminal.copilot") {
    return activeTabKind !== "terminal";
  }

  // 5. Terminal clear (⌘K on Mac): only when focused inside a terminal
  if (id === "terminal.clear") {
    return !inTerminal;
  }

  // 6. Ask AI selection: only when there is active selection if in terminal
  if (id === "ai.askSelection") {
    if (!inTerminal) return false;
    return !hasSelection;
  }

  // 7. Block navigation / input toggle: requires active terminal in blocks mode
  if (
    id === "terminal.toggleInput" ||
    id === "blocks.prev" ||
    id === "blocks.next"
  ) {
    return !(activeTabKind === "terminal" && blocksMode);
  }

  // 8. Terminal priority for single-key control shortcuts when focused in console:
  if (inTerminal) {
    // Plain Ctrl/Cmd+B: background in Claude Code / terminal \x02.
    // Ctrl/Cmd+Shift+B always toggles the sidebar from anywhere.
    if (id === "sidebar.toggle" && !event.shiftKey) {
      return true;
    }

    // On non-Mac platforms (Windows/Linux) where Mod is Ctrl, single-key Mod shortcuts
    // directly clash with core interactive terminal sequences:
    if (!isMac) {
      // Ctrl+R: Reverse History Search in Bash/Zsh/Fish/Readline/FZF/Nano.
      if (id === "tab.newPrivate" && !event.shiftKey && !event.altKey) {
        return true;
      }

      // Ctrl+E: End-of-line navigation in Readline/Nano/Emacs (\x05).
      if (id === "tab.newEditor" && !event.shiftKey && !event.altKey) {
        return true;
      }

      // Ctrl+G: Cancel / Get Help in Nano / Readline / Bash (\x07).
      if (id === "pane.source" && !event.shiftKey && !event.altKey) {
        return true;
      }
    }
  }

  return false;
}
