import { firstCwd } from "@/modules/surfaces/lib/cwd";
import type { ActiveSurface, ActiveSurfaceInput } from "@/modules/surfaces/lib/activeSurface";
import type { WorkspaceEnv } from "@/modules/workspace";

export type DesktopSurfaceSelection = {
  ownerId?: number;
  tabKind?: string;
  projectCwd?: unknown;
  focusFolder?: unknown;
  cwd?: unknown;
  editorFolder?: unknown;
  workspaceEnv?: WorkspaceEnv;
};

export function desktopSurfaceInput(selection: DesktopSurfaceSelection): ActiveSurfaceInput | null {
  if (selection.ownerId === undefined || selection.tabKind === undefined) return null;
  const { ownerId, workspaceEnv, tabKind } = selection;
  if (tabKind === "harness") return {
    kind: "harness", ownerId, workspaceEnv,
    projectCwd: selection.projectCwd, focusFolder: selection.focusFolder,
  };
  if (tabKind === "terminal") return { kind: "terminal", ownerId, workspaceEnv, cwd: selection.cwd };
  if (tabKind === "editor" || tabKind === "markdown") return {
    kind: "editor", ownerId, workspaceEnv, folder: selection.editorFolder,
  };
  return { kind: "other", ownerId, workspaceEnv, folder: selection.cwd };
}

export function desktopSurfaceCwd(tabKind: string | undefined, terminalCwd: unknown,
  harnessFolder: unknown, fallbacks: readonly unknown[]): string | null {
  return firstCwd(terminalCwd, tabKind === "harness" ? harnessFolder : firstCwd(...fallbacks));
}

export function surfaceDirectoryTarget(surface: ActiveSurface, path: unknown): {
  kind: "project" | "terminal"; ownerId: number; path: string;
} | null {
  const folder = firstCwd(path);
  if (!folder || surface.ownerId === null) return null;
  if (surface.kind === "harness") return { kind: "project", ownerId: surface.ownerId, path: folder };
  if (surface.kind === "terminal") return { kind: "terminal", ownerId: surface.ownerId, path: folder };
  return null;
}
