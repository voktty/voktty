import type { WorkspaceEnv } from "@/modules/workspace";

export function sameWorkspace(a: WorkspaceEnv, b: WorkspaceEnv): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "local") return true;
  if (a.kind === "wsl" && b.kind === "wsl") return a.distro === b.distro;
  if (a.kind === "ssh" && b.kind === "ssh") {
    return a.connection.id === b.connection.id && a.root === b.root;
  }
  return false;
}

export function reusableWorkspaceEnv(
  requested: WorkspaceEnv,
  current: WorkspaceEnv,
): WorkspaceEnv | null {
  if (!sameWorkspace(requested, current)) return null;
  if (current.kind === "ssh" && current.sessionId === undefined) return null;
  return current;
}
