import { expect, it } from "vitest";
import {
  commandSurfaceUnavailableReason,
  declaredCommandSurfaceRule,
  fixedCommandSurfaceIds,
} from "@/modules/shortcuts/lib/commandSurface";
import { resolveActiveSurface } from "@/modules/surfaces/lib/activeSurface";

const globalEditorCommands = new Set([
  "editor.openFile",
  "editor.openFolder",
  "editor.quickOpen",
  "editor.reopenClosed",
  "editor.problems",
]);
const terminalCommands = new Set([
  "pane.focusNext",
  "pane.focusPrev",
  "pane.swapLeft",
  "pane.swapRight",
  "pane.swapUp",
  "pane.swapDown",
  "terminal.toggleInput",
  "blocks.prev",
  "blocks.next",
]);

it.each(["/project", "remote://machine/project"])(
  "resolves every fixed registry command across all surfaces at %s",
  (cwd) => {
    const ids = fixedCommandSurfaceIds();
    expect(ids).toEqual(
      expect.arrayContaining([
        "tab.revealInFileManager",
        "tab.revealInExplorer",
        "tab.splitPreview",
      ]),
    );
    for (const kind of ["harness", "terminal", "editor", "other"] as const) {
      const surface = resolveActiveSurface({
        kind,
        ownerId: 1,
        cwd,
        projectCwd: cwd,
        folder: cwd,
      });
      for (const id of ids) {
        const editorOnly =
          (id.startsWith("editor.") && !globalEditorCommands.has(id)) ||
          id === "launch.outline";
        const split = id === "pane.splitRight" || id === "pane.splitDown";
        const allowed = editorOnly
          ? kind === "editor"
          : terminalCommands.has(id)
            ? kind === "terminal"
            : split
              ? kind === "editor" || kind === "terminal"
              : true;
        const reason = editorOnly ? "editor-required" : "terminal-required";
        expect(declaredCommandSurfaceRule(id), id).toBeDefined();
        expect(
          commandSurfaceUnavailableReason(id, surface),
          `${id} on ${kind} at ${cwd}`,
        ).toBe(id === "editor.formatDocument" && kind === "editor" && cwd.startsWith("remote://") ? "format-filesystem-unsupported" : allowed ? null : reason);
      }
    }
  },
);
