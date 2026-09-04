import type { WorkspaceEnv } from "@/modules/workspace";

export function sameWorkspace(a: WorkspaceEnv, b: WorkspaceEnv): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "local") return true;
  if (a.kind === "wsl" && b.kind === "wsl") return a.distro === b.distro;
  if (a.kind === "ssh" && b.kind === "ssh") {
    return (
      a.connection.id === b.connection.id &&
      a.root === b.root &&
      a.connection.activeMultiplexerSession ===
        b.connection.activeMultiplexerSession &&
      a.connection.multiplexerAction === b.connection.multiplexerAction &&
      a.connection.multiplexerMode === b.connection.multiplexerMode
    );
  }
  return false;
}

export function sameRemoteHost(
  a: Extract<WorkspaceEnv, { kind: "ssh" }>["connection"],
  b: Extract<WorkspaceEnv, { kind: "ssh" }>["connection"],
): boolean {
  return (
    a.id === b.id ||
    (a.host === b.host &&
      (a.port ?? 22) === (b.port ?? 22) &&
      (a.user ?? "") === (b.user ?? "") &&
      (a.identityFile ?? "") === (b.identityFile ?? ""))
  );
}

export function reusableWorkspaceEnv(
  requested: WorkspaceEnv,
  current: WorkspaceEnv,
): WorkspaceEnv | null {
  if (!sameWorkspace(requested, current)) return null;
  if (current.kind === "ssh" && current.sessionId === undefined) return null;
  return current;
}
