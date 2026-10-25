import { expect, it } from "vitest";
import { commandSurfaceRule, declaredCommandSurfaceRule, commandSurfaceUnavailableReason } from "@/modules/shortcuts/lib/commandSurface";
import { resolveActiveSurface } from "@/modules/surfaces/lib/activeSurface";

it.each(["/project", "remote://machine/project"])("resolves commands across Harness and terminal at %s", (cwd) => {
  const harness = resolveActiveSurface({ kind: "harness", ownerId: 1, projectCwd: cwd });
  const terminal = resolveActiveSurface({ kind: "terminal", ownerId: 2, cwd });
  const editor = resolveActiveSurface({ kind: "editor", ownerId: 3, folder: cwd });
  expect(commandSurfaceUnavailableReason("pane.splitRight", harness)).toBe("terminal-required");
  expect(commandSurfaceUnavailableReason("pane.splitRight", terminal)).toBeNull();
  expect(commandSurfaceUnavailableReason("editor.formatDocument", harness)).toBe("editor-required");
  expect(commandSurfaceUnavailableReason("editor.formatDocument", terminal)).toBe("editor-required");
  expect(commandSurfaceUnavailableReason("editor.formatDocument", editor)).toBe(cwd.startsWith("remote://") ? "format-filesystem-unsupported" : null);
  for (const surface of [harness, terminal, editor]) {
    expect(commandSurfaceUnavailableReason("tab.new", surface)).toBeNull();
    expect(commandSurfaceUnavailableReason("commandPalette.open", surface)).toBeNull();
  }
});

it("distinguishes explicit global declarations from unregistered extension compatibility", () => {
  expect(declaredCommandSurfaceRule("terminal.clear")?.appliesTo).toContain("harness");
  expect(declaredCommandSurfaceRule("terminal.copilot")?.appliesTo).toContain("harness");
  expect(declaredCommandSurfaceRule("launch.commandHistory")?.appliesTo).toContain("harness");
  expect(declaredCommandSurfaceRule("spaces.switch.one")?.appliesTo).toContain("harness");
  expect(declaredCommandSurfaceRule("spaces.switch.")).toBeUndefined();
  for (const id of ["extension.custom", "constructor", "__proto__", "toString"]) {
    expect(declaredCommandSurfaceRule(id)).toBeUndefined();
    expect(commandSurfaceRule(id).appliesTo).toEqual(["terminal", "harness", "editor", "other"]);
  }
});
