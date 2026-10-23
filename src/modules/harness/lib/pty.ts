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
type PtyResource = {
  id: string;
  attempt: object;
  opening: boolean;
  session?: PtySession;
  closeRemote?: () => Promise<void>;
  nativeClosed: boolean;
  closing?: Promise<void>;
};
const resources = new Set<PtyResource>();
const MAX_RESOURCES = 256;
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

function releaseRemoteLeaseOnce(lease: RemoteSessionLease) {
  let closing: Promise<void> | undefined;
  const close = () => {
    if (!closing) {
      closing = Promise.resolve()
        .then(() => {
          if (lease.releaseAndClose) return lease.releaseAndClose();
          lease.release();
          const entry = remoteSessions
            .snapshot()
            .find((candidate) => candidate.sessionId === lease.info.session_id);
          if (entry?.leases === 0) {
            return remoteSessions.closeSession(lease.info.session_id);
          }
        })
        .catch((error: unknown) => {
          closing = undefined;
          throw error;
        });
    }
    return closing;
  };
  return close;
}

function retireResource(resource: PtyResource) {
  if (spawnAttempts.get(resource.id) === resource.attempt) {
    spawnAttempts.delete(resource.id);
    dataHandlers.delete(resource.id);
    exitHandlers.delete(resource.id);
    clearBuffered(resource.id);
  }
  if (resource.session && activeSessions.get(resource.id) === resource.session)
    activeSessions.delete(resource.id);
}

function closeResource(resource: PtyResource): Promise<void> {
  retireResource(resource);
  if (!resource.closing) {
    resource.closing = Promise.resolve()
      .then(async () => {
        if (!resource.nativeClosed) {
          await resource.session?.close();
          resource.nativeClosed = true;
        }
        await resource.closeRemote?.();
        resources.delete(resource);
        resource.session = undefined;
        resource.closeRemote = undefined;
      })
      .catch((error: unknown) => {
        resource.closing = undefined;
        throw error;
      });
  }
  return resource.closing;
}

export async function spawnPty(
  id: string,
  cwd: string,
  cols: number,
  rows: number,
  options?: PtyLaunchOptions,
): Promise<void> {
  return startOwnedPty(id, cwd, cols, rows, options).ready;
}

export function startOwnedPty(
  id: string,
  cwd: string,
  cols: number,
  rows: number,
  options?: PtyLaunchOptions,
) {
  if (resources.size >= MAX_RESOURCES)
    throw new Error("Harness terminal resource limit reached.");
  const attempt = {};
  const resource: PtyResource = {
    id,
    attempt,
    opening: true,
    nativeClosed: false,
  };
  const predecessors = [...resources].filter((entry) => entry.id === id);
  resources.add(resource);
  spawnAttempts.set(id, attempt);
  const owns = () => spawnAttempts.get(id) === attempt;
  const launchOptions = options && { ...options };
  const ready = spawnPtyAttempt(
    resource,
    predecessors,
    cwd,
    cols,
    rows,
    launchOptions,
  ).then(
    async () => {
      if (!owns()) await closeResource(resource);
    },
    async (error: unknown) => {
      await closeResource(resource);
      throw error;
    },
  );
  let retired = false;
  const isCurrent = () => !retired && owns();
  let closing: Promise<void> | undefined;
  return Object.freeze({
    ready,
    isCurrent,
    status: async () => {
      if (!isCurrent()) return undefined;
      const status = await getPtyStatus(id);
      return isCurrent() ? status : undefined;
    },
    write: (data: string) =>
      isCurrent() ? writePty(id, data) : Promise.resolve(),
    resize: (cols: number, rows: number) =>
      isCurrent() ? resizePty(id, cols, rows) : Promise.resolve(),
    close: () => {
      retired = true;
      retireResource(resource);
      if (!closing)
        closing = ready
          .catch(() => undefined)
          .then(() => closeResource(resource))
          .catch((error: unknown) => {
            closing = undefined;
            throw error;
          });
      return closing;
    },
  });
}

async function spawnPtyAttempt(
  resource: PtyResource,
  predecessors: PtyResource[],
  cwd: string,
  cols: number,
  rows: number,
  options?: PtyLaunchOptions,
): Promise<void> {
  const { id, attempt } = resource;
  const isCurrent = () => spawnAttempts.get(id) === attempt;
  // Normalize "~" or empty string to undefined so openPty uses default home/workspace root
  const effectiveCwd =
    !cwd || cwd === "~" || cwd.trim() === "" ? undefined : cwd;
  let exited = false;

  try {
    for (const predecessor of predecessors) {
      retireResource(predecessor);
      if (!predecessor.opening) await closeResource(predecessor);
    }
    if (!isCurrent()) return;
    const remoteTarget = effectiveCwd
      ? await openProjectTerminalTarget(
          effectiveCwd,
          options?.multiplexerPicker,
        )
      : undefined;
    resource.closeRemote = remoteTarget
      ? releaseRemoteLeaseOnce(remoteTarget.lease)
      : undefined;
    if (!isCurrent()) return;
    resource.session = await openPty(
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
          try {
            if (isCurrent()) exitHandlers.get(id)?.(code ?? null);
          } finally {
            if (isCurrent()) spawnAttempts.delete(id);
            if (!resource.opening)
              void closeResource(resource).catch(() => undefined);
          }
        },
      },
      remoteTarget?.cwd ?? effectiveCwd,
      false,
      undefined,
      undefined,
      remoteTarget?.workspace,
    );

    if (isCurrent() && !exited) {
      activeSessions.set(id, resource.session);
    }
  } finally {
    resource.opening = false;
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
  const captured = [...resources].filter((resource) => resource.id === id);
  for (const resource of captured) retireResource(resource);
  dataHandlers.delete(id);
  exitHandlers.delete(id);
  clearBuffered(id);
  await Promise.all(
    captured.filter((resource) => !resource.opening).map(closeResource),
  );
}

export async function killAllPtys(): Promise<void> {
  const captured = [...resources];
  for (const resource of captured) retireResource(resource);
  dataHandlers.clear();
  exitHandlers.clear();
  dataBuffer.clear();
  dataBufferBytes.clear();
  await Promise.allSettled(
    captured.filter((resource) => !resource.opening).map(closeResource),
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
