import { openPty, type PtySession } from "@/modules/terminal/lib/pty-bridge";
import { remoteSessions } from "@/modules/remote/sessionManager";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";
import { invoke } from "@tauri-apps/api/core";
import {
  openProjectTerminalTarget,
  type SshMultiplexerPicker,
} from "@/modules/harness/lib/projectTerminalTarget";

export type { SshMultiplexerPicker } from "@/modules/harness/lib/projectTerminalTarget";

type DataHandler = (data: Uint8Array) => void;
type ExitHandler = (code: number | null) => void;
export type PtyLaunchOptions = { multiplexerPicker?: SshMultiplexerPicker };

const activeSessions = new Map<string, PtySession>();
const spawnAttempts = new Map<string, object>();
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

function releaseRemoteLeaseOnce(id: string, lease: RemoteSessionLease) {
  let closing: Promise<void> | undefined;
  const close = () => {
    if (!closing) {
      closing = Promise.resolve()
        .then(() => {
          lease.release();
          const entry = remoteSessions
            .snapshot()
            .find((candidate) => candidate.sessionId === lease.info.session_id);
          if (entry?.leases === 0) {
            return remoteSessions.closeSession(lease.info.session_id);
          }
        })
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

export async function spawnPty(
  id: string,
  cwd: string,
  cols: number,
  rows: number,
  options?: PtyLaunchOptions,
): Promise<void> {
  const attempt = {};
  spawnAttempts.set(id, attempt);
  const isCurrent = () => spawnAttempts.get(id) === attempt;
  const existing = activeSessions.get(id);
  const closeExistingRemote = remoteWorkspaceClosers.get(id);
  activeSessions.delete(id);
  remoteWorkspaceClosers.delete(id);
  if (existing) await existing.close().catch(() => undefined);
  await closeExistingRemote?.();
  if (!isCurrent()) return;

  // Normalize "~" or empty string to undefined so openPty uses default home/workspace root
  const effectiveCwd =
    !cwd || cwd === "~" || cwd.trim() === "" ? undefined : cwd;
  let session: PtySession | undefined;
  let exited = false;
  let closeRemote: (() => Promise<void>) | undefined;

  try {
    const remoteTarget = effectiveCwd
      ? await openProjectTerminalTarget(
          effectiveCwd,
          options?.multiplexerPicker,
        )
      : undefined;
    closeRemote = remoteTarget
      ? releaseRemoteLeaseOnce(id, remoteTarget.lease)
      : undefined;
    if (!isCurrent()) {
      await closeRemote?.();
      return;
    }
    session = await openPty(
      cols,
      rows,
      {
        onData: (bytes: Uint8Array) => {
          if (!isCurrent() || exited) return;
          const handler = dataHandlers.get(id);
          if (handler) {
            handler(bytes);
          } else {
            pushBuffered(id, bytes);
          }
        },
        onExit: (code?: number) => {
          if (exited) return;
          exited = true;
          if (session) {
            if (activeSessions.get(id) === session) activeSessions.delete(id);
            void closeRemote?.();
          }
          if (isCurrent()) {
            exitHandlers.get(id)?.(code ?? null);
            if (isCurrent()) spawnAttempts.delete(id);
          }
        },
      },
      remoteTarget?.cwd ?? effectiveCwd,
      false,
      undefined,
      undefined,
      remoteTarget?.workspace,
    );

    if (!isCurrent() || exited) {
      await session.close().catch(() => undefined);
      await closeRemote?.();
      return;
    }
    activeSessions.set(id, session);
    if (closeRemote) remoteWorkspaceClosers.set(id, closeRemote);
  } catch (error) {
    await closeRemote?.();
    if (isCurrent()) spawnAttempts.delete(id);
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
  spawnAttempts.delete(id);
  const session = activeSessions.get(id);
  const closeRemote = remoteWorkspaceClosers.get(id);
  activeSessions.delete(id);
  remoteWorkspaceClosers.delete(id);
  dataHandlers.delete(id);
  exitHandlers.delete(id);
  clearBuffered(id);
  if (session) {
    await session.close().catch(() => undefined);
  }
  await closeRemote?.();
}

export async function killAllPtys(): Promise<void> {
  spawnAttempts.clear();
  const sessions = Array.from(activeSessions.values());
  const closers = Array.from(remoteWorkspaceClosers.values());
  activeSessions.clear();
  remoteWorkspaceClosers.clear();
  dataHandlers.clear();
  exitHandlers.clear();
  dataBuffer.clear();
  dataBufferBytes.clear();
  await Promise.allSettled(
    sessions.map((s) => s.close().catch(() => undefined)),
  );
  await Promise.allSettled(closers.map((close) => close()));
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
