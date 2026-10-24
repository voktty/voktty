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

export function commandSurfaceRule(id: ShortcutId): CommandSurfaceRule {
  return RULES[id] ?? GLOBAL;
}

export function commandSurfaceUnavailableReason(
  id: ShortcutId,
  surface: Pick<ActiveSurface, "kind">,
): CommandSurfaceRule["unavailableReason"] {
  const rule = commandSurfaceRule(id);
  return rule.appliesTo.includes(surface.kind) ? null : rule.unavailableReason;
}
