import { expect, it } from "vitest";
import { desktopSurfaceCwd, desktopSurfaceInput, surfaceDirectoryTarget } from "@/modules/surfaces/lib/desktopSurface";
import { resolveActiveSurface } from "@/modules/surfaces/lib/activeSurface";

it.each(["/project", "C:/project", "//server/share/project", "remote://machine/project"])("preserves Harness project and focus ownership at %s", (project) => {
  const folder = `${project}/src`;
  const surface = resolveActiveSurface(desktopSurfaceInput({ ownerId: 7, tabKind: "harness", projectCwd: project, focusFolder: folder, cwd: "/unrelated" }));
  expect(surface.project).toBe(project);
  expect(surface.folder).toBe(folder);
  expect(surfaceDirectoryTarget(surface, folder)).toEqual({ kind: "project", ownerId: 7, path: folder });
  expect(desktopSurfaceCwd("harness", null, folder, ["/unrelated"])).toBe(folder);
});

it("keeps terminal shell navigation distinct from project selection and rejects non-target surfaces", () => {
  const terminal = resolveActiveSurface(desktopSurfaceInput({ ownerId: 2, tabKind: "terminal", cwd: "/shell", projectCwd: "/foreign" }));
  expect(terminal.project).toBeNull();
  expect(surfaceDirectoryTarget(terminal, "/next")).toEqual({ kind: "terminal", ownerId: 2, path: "/next" });
  for (const tabKind of ["editor", "markdown", "preview", undefined]) {
    const surface = resolveActiveSurface(desktopSurfaceInput({ ownerId: 2, tabKind, editorFolder: "/editor", cwd: "/other" }));
    expect(surfaceDirectoryTarget(surface, "/next")).toBeNull();
  }
  expect(surfaceDirectoryTarget(terminal, { path: "/poison" })).toBeNull();
  expect(surfaceDirectoryTarget(terminal, "  ")).toBeNull();
});

it("coerces chrome cwd candidates without calling deferred values or importing native ownership", () => {
  const deferred = () => { throw new Error("Do not invoke fallback metadata"); };
  expect(desktopSurfaceCwd("terminal", "/leaf", "/harness", ["/fallback"])).toBe("/leaf");
  expect(desktopSurfaceCwd("editor", null, "/harness", [9, deferred, "/fallback"])).toBe("/fallback");
  expect(desktopSurfaceCwd("harness", null, {}, ["/local-fallback"])).toBeNull();
  expect(desktopSurfaceInput({ tabKind: "harness" })).toBeNull();
});
