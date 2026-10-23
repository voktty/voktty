import type { WorkspaceEnv } from "@/modules/workspace";
import { sameRemoteSessionConnection } from "@/modules/remote/sessionConnectionIdentity";

export function sameWorkspace(a: WorkspaceEnv, b: WorkspaceEnv): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "local") return true;
  if (a.kind === "wsl" && b.kind === "wsl") return a.distro === b.distro;
  if (a.kind === "ssh" && b.kind === "ssh") {
    return (
      a.connection.id === b.connection.id &&
      sameRemoteSessionConnection(a.connection, b.connection) &&
      a.root === b.root &&
      a.connection.activeMultiplexerSession ===
        b.connection.activeMultiplexerSession &&
      a.connection.multiplexerAction === b.connection.multiplexerAction &&
      a.connection.multiplexerMode === b.connection.multiplexerMode
    );
  }
  return false;
}

export function reusableRemoteSessionId(
  requested: WorkspaceEnv,
  current: WorkspaceEnv,
): number | undefined {
  if (
    requested.kind !== "ssh" ||
    current.kind !== "ssh" ||
    requested.sessionId !== undefined ||
    requested.connection.id !== current.connection.id ||
    requested.root !== current.root ||
    !sameRemoteSessionConnection(requested.connection, current.connection)
  )
    return undefined;
  return current.sessionId;
}

/** Failure cleanup can release only the session opened by that activation. */
export function releasableSessionId(
  prepared: WorkspaceEnv,
  openedSessionId: number | undefined,
): number | undefined {
  if (openedSessionId === undefined) return undefined;
  if (prepared.kind !== "ssh") return undefined;
  return prepared.sessionId === openedSessionId ? openedSessionId : undefined;
}

export function reusableWorkspaceEnv(
  requested: WorkspaceEnv,
  current: WorkspaceEnv,
): WorkspaceEnv | null {
  if (!sameWorkspace(requested, current)) return null;
  if (
    requested.kind === "ssh" &&
    current.kind === "ssh" &&
    requested.sessionId !== undefined &&
    requested.sessionId !== current.sessionId
  )
    return null;
  if (current.kind === "ssh" && current.sessionId === undefined) return null;
  return current;
}
