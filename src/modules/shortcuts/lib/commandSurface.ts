import type { ActiveSurface, SurfaceKind } from "@/modules/surfaces/lib/activeSurface";
import type { ShortcutId } from "@/modules/shortcuts/shortcuts";

export type CommandSurfaceRule = {
  appliesTo: readonly SurfaceKind[];
  unavailableReason: "editor-required" | "terminal-required" | null;
};

const EDITOR: CommandSurfaceRule = {
  appliesTo: ["editor"], unavailableReason: "editor-required",
};
const TERMINAL: CommandSurfaceRule = {
  appliesTo: ["terminal"], unavailableReason: "terminal-required",
};
const GLOBAL: CommandSurfaceRule = {
  appliesTo: ["terminal", "harness", "editor", "other"], unavailableReason: null,
};

const RULES: Partial<Record<ShortcutId, CommandSurfaceRule>> = {
  "editor.undo": EDITOR,
  "editor.redo": EDITOR,
  "editor.aiComplete": EDITOR,
  "editor.codeComplete": EDITOR,
  "editor.gotoLine": EDITOR,
  "editor.formatDocument": EDITOR,
  "editor.quickFix": EDITOR,
  "editor.signatureHelp": EDITOR,
  "editor.goToDefinition": EDITOR,
  "editor.peekDefinition": EDITOR,
  "editor.goToTypeDefinition": EDITOR,
  "editor.goToImplementation": EDITOR,
  "editor.findReferences": EDITOR,
  "editor.navigateBack": EDITOR,
  "editor.navigateForward": EDITOR,
  "editor.outline": EDITOR,
  "pane.splitRight": TERMINAL,
  "pane.splitDown": TERMINAL,
  "pane.focusNext": TERMINAL,
  "pane.focusPrev": TERMINAL,
  "pane.swapLeft": TERMINAL,
  "pane.swapRight": TERMINAL,
  "pane.swapUp": TERMINAL,
  "pane.swapDown": TERMINAL,
  "terminal.toggleInput": TERMINAL,
  "blocks.prev": TERMINAL,
  "blocks.next": TERMINAL,
};

const COMMAND_RULES: Readonly<Record<string, CommandSurfaceRule>> = {
  ...RULES,
  "editor.find": EDITOR,
  "editor.revealInExplorer": EDITOR,
  "editor.inlineAi": EDITOR,
  "editor.acceptAiCompletion": EDITOR,
  "editor.acceptAiLine": EDITOR,
  "editor.acceptAiToken": EDITOR,
  "editor.dismissAiCompletion": EDITOR,
  "editor.addCursorAbove": EDITOR,
  "editor.addCursorBelow": EDITOR,
  "editor.clearMultipleCursors": EDITOR,
  "editor.moveLineUp": EDITOR,
  "editor.moveLineDown": EDITOR,
  "editor.copyLineUp": EDITOR,
  "editor.copyLineDown": EDITOR,
  "editor.expandSelection": EDITOR,
  "editor.splitGroupRight": EDITOR,
  "editor.splitGroupDown": EDITOR,
  "editor.focusNextGroup": EDITOR,
  "editor.closeGroup": EDITOR,
  "launch.outline": EDITOR,
};

export function commandSurfaceRule(id: string): CommandSurfaceRule {
  return Object.prototype.hasOwnProperty.call(COMMAND_RULES, id) ? COMMAND_RULES[id] : GLOBAL;
}

export function commandSurfaceUnavailableReason(
  id: string,
  surface: Pick<ActiveSurface, "kind">,
): CommandSurfaceRule["unavailableReason"] {
  const rule = commandSurfaceRule(id);
  return rule.appliesTo.includes(surface.kind) ? null : rule.unavailableReason;
}
