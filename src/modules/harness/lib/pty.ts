import { openPty, type PtySession } from "@/modules/terminal/lib/pty-bridge";
import {
  closeRemoteWorkspace,
  openRemoteWorkspace,
  type RemoteSshConnection,
} from "@/modules/remote/client";
import {
  parseRemotePath,
  remoteProjectForPath,
} from "@/modules/connections/model/remoteProjects";
import {
  remoteSshConnectionForProfile,
  remoteSshConnectionIdForEnvironment,
} from "@/modules/connections/model/remoteSshProfiles";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { invoke } from "@tauri-apps/api/core";

type DataHandler = (data: Uint8Array) => void;
type ExitHandler = (code: number | null) => void;

const activeSessions = new Map<string, PtySession>();
const remoteWorkspaceClosers = new Map<string, () => Promise<void>>();
const dataHandlers = new Map<string, DataHandler>();
const exitHandlers = new Map<string, ExitHandler>();
const dataBuffer = new Map<string, Uint8Array[]>();
const dataBufferBytes = new Map<string, number>();

/**
 * Replay budget for a PTY whose view is not mounted. Chunks arrive at up to
 * 32KB each, so a count-based cap let one unsubscribed terminal retain
 * megabytes; bound the bytes instead. Whole chunks are dropped oldest-first.
 */
const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_BUFFERED = 200;

/**
 * Leading chunks to drop to bring a replay buffer back within budget, and the
 * byte total that remains. Never drops the newest chunk, even when that chunk
 * alone exceeds the budget — replaying something beats replaying nothing.
 */
export function trimReplay(
  sizes: number[],
  bytes: number,
): { drop: number; bytes: number } {
  let drop = 0;
  let left = bytes;
  while (
    drop < sizes.length - 1 &&
    (left > MAX_BUFFERED_BYTES || sizes.length - drop > MAX_BUFFERED)
  ) {
    left -= sizes[drop];
    drop += 1;
  }
  return { drop, bytes: left };
}

function pushBuffered(id: string, chunk: Uint8Array) {
  const queued = dataBuffer.get(id) ?? [];
  queued.push(chunk);
  const trimmed = trimReplay(
    queued.map((entry) => entry.byteLength),
    (dataBufferBytes.get(id) ?? 0) + chunk.byteLength,
  );
  if (trimmed.drop > 0) queued.splice(0, trimmed.drop);
  dataBuffer.set(id, queued);
  dataBufferBytes.set(id, trimmed.bytes);
}

function clearBuffered(id: string) {
  dataBuffer.delete(id);
  dataBufferBytes.delete(id);
}

function closeRemoteWorkspaceOnce(id: string, sessionId: number) {
  let closing: Promise<void> | undefined;
  const close = () => {
    if (!closing) {
      closing = closeRemoteWorkspace(sessionId)
        .catch(() => undefined)
        .then(() => {
          if (remoteWorkspaceClosers.get(id) === close) {
            remoteWorkspaceClosers.delete(id);
          }
        });
    }
    return closing;
  };
  return close;
}

async function openRemoteTerminalTarget(id: string, cwd: string) {
  const remotePath = parseRemotePath(cwd);
  if (!remotePath) {
    if (cwd.startsWith("remote://")) {
      throw new Error("Remote terminal path is invalid.");
    }
    return undefined;
  }

  const project = remoteProjectForPath(cwd);
  if (!project || project.environmentId !== remotePath.environmentId) {
    throw new Error("Remote terminal path is outside a saved project.");
  }

  const connectionId = remoteSshConnectionIdForEnvironment(
    remotePath.environmentId,
  );
  if (!connectionId) {
    throw new Error("Remote terminal requires a saved Voktty SSH profile.");
  }

  const profile = usePreferencesStore
    .getState()
    .sshConnections.find((connection) => connection.id === connectionId);
  if (!profile) {
    throw new Error("The saved SSH connection for this project is missing.");
  }

  const nativeConnection: RemoteSshConnection = {
    ...remoteSshConnectionForProfile(profile),
    ...(profile.multiplexerMode
      ? { multiplexerMode: profile.multiplexerMode }
      : {}),
    ...(profile.tmuxSessionName
      ? { tmuxSessionName: profile.tmuxSessionName }
      : {}),
    ...(profile.activeMultiplexerSession
      ? { activeMultiplexerSession: profile.activeMultiplexerSession }
      : {}),
    ...(profile.multiplexerAction
      ? { multiplexerAction: profile.multiplexerAction }
      : {}),
  };
  const remoteSession = await openRemoteWorkspace(
    nativeConnection,
    remotePath.hostPath,
  );

  return {
    cwd: remotePath.hostPath,
    workspace: {
      kind: "ssh" as const,
      connection: profile,
      root: remoteSession.workspace_root,
      sessionId: remoteSession.session_id,
    },
    close: closeRemoteWorkspaceOnce(id, remoteSession.session_id),
  };
}

async function closeRemoteTerminalTarget(id: string) {
  const close = remoteWorkspaceClosers.get(id);
  if (close) await close();
}

export async function spawnPty(
  id: string,
  cwd: string,
  cols: number,
  rows: number,
): Promise<void> {
  const existing = activeSessions.get(id);
  if (existing) {
    await existing.close().catch(() => undefined);
    activeSessions.delete(id);
  }
  await closeRemoteTerminalTarget(id);

  // Normalize "~" or empty string to undefined so openPty uses default home/workspace root
  const effectiveCwd =
    !cwd || cwd === "~" || cwd.trim() === "" ? undefined : cwd;

  const remoteTarget = effectiveCwd
    ? await openRemoteTerminalTarget(id, effectiveCwd)
    : undefined;
  let session: PtySession | undefined;
  let exitedBeforeOpen = false;
  const closeRemote = remoteTarget?.close;

  try {
    session = await openPty(
      cols,
      rows,
      {
        onData: (bytes: Uint8Array) => {
          const handler = dataHandlers.get(id);
          if (handler) {
            handler(bytes);
          } else {
            pushBuffered(id, bytes);
          }
        },
        onExit: (code?: number) => {
          if (session) {
            if (activeSessions.get(id) === session) activeSessions.delete(id);
            void closeRemote?.();
          } else {
            exitedBeforeOpen = true;
          }
          const handler = exitHandlers.get(id);
          handler?.(code ?? null);
        },
      },
      remoteTarget?.cwd ?? effectiveCwd,
      false,
      undefined,
      undefined,
      remoteTarget?.workspace,
    );

    activeSessions.set(id, session);
    if (closeRemote && !exitedBeforeOpen) {
      remoteWorkspaceClosers.set(id, closeRemote);
    }
    if (exitedBeforeOpen) {
      if (activeSessions.get(id) === session) activeSessions.delete(id);
      await session.close().catch(() => undefined);
      await closeRemote?.();
    }
  } catch (error) {
    await closeRemote?.();
    throw error;
  }
}

export async function writePty(id: string, data: string): Promise<void> {
  const session = activeSessions.get(id);
  if (session) {
    await session.write(data);
  }
}

export async function resizePty(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  const session = activeSessions.get(id);
  if (session) {
    await session.resize(cols, rows);
  }
}

export async function getPtyStatus(
  id: string,
): Promise<{ foreground: string | null }> {
  const session = activeSessions.get(id);
  if (!session) return { foreground: null };
  try {
    const hasFg = await invoke<boolean>("pty_has_foreground_process", {
      id: session.id,
    });
    return { foreground: hasFg ? "active" : null };
  } catch {
    return { foreground: null };
  }
}

export async function killPty(id: string): Promise<void> {
  const session = activeSessions.get(id);
  activeSessions.delete(id);
  dataHandlers.delete(id);
  exitHandlers.delete(id);
  clearBuffered(id);
  if (session) {
    await session.close().catch(() => undefined);
  }
  await closeRemoteTerminalTarget(id);
}

export async function killAllPtys(): Promise<void> {
  const sessions = Array.from(activeSessions.values());
  activeSessions.clear();
  dataHandlers.clear();
  exitHandlers.clear();
  dataBuffer.clear();
  dataBufferBytes.clear();
  await Promise.allSettled(
    sessions.map((s) => s.close().catch(() => undefined)),
  );
  await Promise.allSettled(
    Array.from(remoteWorkspaceClosers.values(), (close) => close()),
  );
}

export function subscribePty(
  id: string,
  onData: DataHandler,
  onExit: ExitHandler,
): () => void {
  dataHandlers.set(id, onData);
  exitHandlers.set(id, onExit);
  const queued = dataBuffer.get(id);
  if (queued) {
    clearBuffered(id);
    for (const chunk of queued) onData(chunk);
  }
  return () => {
    if (dataHandlers.get(id) === onData) dataHandlers.delete(id);
    if (exitHandlers.get(id) === onExit) exitHandlers.delete(id);
  };
}
