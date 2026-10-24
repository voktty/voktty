import { expect, it, vi } from "vitest";
import { captureSurfaceCommand, surfaceCommandReason } from "@/modules/command-palette/lib/surfaceCommand";
import { resolveActiveSurface } from "@/modules/surfaces/lib/activeSurface";

it.each(["/project", "remote://machine/project"])("shares applicability by command identity at %s", (cwd) => {
  const harness = resolveActiveSurface({ kind: "harness", ownerId: 1, projectCwd: cwd });
  const editor = resolveActiveSurface({ kind: "editor", ownerId: 2, folder: cwd });
  const command = { id: "editor.find", run: vi.fn() };
  expect(surfaceCommandReason(command, harness)).toBe("commandPalette.disabled.noEditorTab");
  expect(surfaceCommandReason(command, editor)).toBeUndefined();
  expect(surfaceCommandReason({ ...command, id: "search.focus" }, harness)).toBeUndefined();
  expect(surfaceCommandReason({ ...command, id: "launch.outline" }, harness)).toBe("commandPalette.disabled.noEditorTab");
  expect(surfaceCommandReason({ ...command, id: "tab.new" }, harness)).toBeUndefined();
});

it("retires a captured callback after a surface publication, including returning to the same owner", () => {
  let surface = resolveActiveSurface({ kind: "editor", ownerId: 1, folder: "/project" });
  const run = vi.fn();
  const captured = captureSurfaceCommand({ id: "editor.find", run }, () => surface);
  surface = resolveActiveSurface({ kind: "harness", ownerId: 2, projectCwd: "/project" });
  surface = resolveActiveSurface({ kind: "editor", ownerId: 1, folder: "/project" });
  captured?.();
  expect(run).not.toHaveBeenCalled();
  captureSurfaceCommand({ id: "editor.find", run }, () => surface)?.();
  expect(run).toHaveBeenCalledOnce();
  expect(captureSurfaceCommand({ id: "editor.find", run, disabledReason: "Locked" }, () => surface)).toBeNull();
});

it.each(["constructor", "__proto__", "toString"])("treats unregistered extension command %s as global", (id) => {
  const surface = resolveActiveSurface({ kind: "harness", ownerId: 1, projectCwd: "/project" });
  expect(surfaceCommandReason({ id, run: () => {} }, surface)).toBeUndefined();
});
