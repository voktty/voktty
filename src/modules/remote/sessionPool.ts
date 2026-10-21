import {
  beginConnectionAttempt,
  disconnectConnection,
  IDLE_CONNECTION_STATE,
  type ResourceConnectionState,
  settleConnectionAttempt,
} from "@/modules/connections/lifecycle";
import type { RemoteSessionInfo, RemoteSshConnection } from "./client";
import {
  normalizedRemoteSessionConnection,
  sameRemoteSessionConnection,
} from "./sessionConnectionIdentity";

export type RemoteSessionKey = { profileId: string; root: string };

export class RemoteSessionConnectionChangedError extends Error {
  readonly code = "REMOTE_SESSION_CONNECTION_CHANGED";

  constructor() {
    super("The remote session connection configuration changed.");
    this.name = "RemoteSessionConnectionChangedError";
  }
}

export type RemoteSessionLease = {
  readonly info: RemoteSessionInfo;
  /** Idempotent. A lease from a closed or replaced session releases nothing. */
  release: () => void;
};

export type RemoteSessionSnapshot = {
  key: RemoteSessionKey;
  state: ResourceConnectionState;
  sessionId?: number;
  leases: number;
};

export type RemoteSessionPoolDeps = {
  open: (
    connection: RemoteSshConnection,
    root: string,
  ) => Promise<RemoteSessionInfo>;
  close: (sessionId: number) => Promise<void>;
  schedule: (task: () => void, delayMs: number) => () => void;
  idleMs: number;
};

type Entry = {
  key: RemoteSessionKey;
  binding: Readonly<RemoteSshConnection>;
  state: ResourceConnectionState;
  info?: RemoteSessionInfo;
  opening?: Promise<RemoteSessionInfo>;
  leases: number;
  generation: number;
  cancelIdle?: () => void;
};

const SESSION_LOST =
  /remote session \d* ?not found|remote ssh session closed|remote helper closed the ssh channel|remote helper (stdin|stdout) is unavailable/i;

export function isSessionLostError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason);
  return SESSION_LOST.test(message);
}

export function remoteSessionKeyId(key: RemoteSessionKey): string {
  return `${key.profileId}\u0000${key.root}`;
}

/**
 * One helper session per (profile, root), shared by every consumer. Opens are
 * deduplicated, an unused session closes after an idle delay, and a session
 * the helper reports as lost is dropped so the next use reopens it.
 */
export class RemoteSessionPool {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: RemoteSessionPoolDeps) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): RemoteSessionSnapshot[] {
    return [...this.entries.values()].map((entry) => ({
      key: entry.key,
      state: entry.state,
      sessionId: entry.info?.session_id,
      leases: entry.leases,
    }));
  }

  async acquire(
    key: RemoteSessionKey,
    connection: RemoteSshConnection,
  ): Promise<RemoteSessionLease> {
    const id = remoteSessionKeyId(key);
    const nativeConnection = { ...connection };
    const binding = normalizedRemoteSessionConnection(nativeConnection);
    let entry = this.entries.get(id);
    if (
      entry &&
      (entry.info || entry.opening || entry.leases > 0) &&
      !sameRemoteSessionConnection(entry.binding, binding)
    ) {
      throw new RemoteSessionConnectionChangedError();
    }
    if (!entry) {
      entry = {
        key,
        binding,
        state: IDLE_CONNECTION_STATE,
        leases: 0,
        generation: 0,
      };
      this.entries.set(id, entry);
    } else if (!entry.info && !entry.opening && entry.leases === 0) {
      entry.binding = binding;
    }
    entry.cancelIdle?.();
    entry.cancelIdle = undefined;
    const generation = entry.generation;
    entry.leases += 1;

    try {
      const info =
        entry.info ?? (await this.ensureOpen(entry, nativeConnection));
      if (entry.generation !== generation) {
        throw new Error("The remote session was closed before it was ready.");
      }
      return this.leaseFor(entry, info, generation);
    } catch (reason) {
      if (entry.generation === generation) {
        entry.leases = Math.max(0, entry.leases - 1);
        this.collect(id, entry);
      }
      throw reason;
    }
  }

  /** Runs `task` on a leased session and retries once on a lost session. */
  async use<T>(
    key: RemoteSessionKey,
    connection: RemoteSshConnection,
    task: (info: RemoteSessionInfo) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const lease = await this.acquire(key, connection);
      try {
        return await task(lease.info);
      } catch (reason) {
        if (attempt === 0 && isSessionLostError(reason)) {
          this.invalidate(key, lease.info.session_id);
          continue;
        }
        throw reason;
      } finally {
        lease.release();
      }
    }
  }

  /** Drops a session the transport reported as lost, without reopening it. */
  invalidate(key: RemoteSessionKey, sessionId: number): void {
    const id = remoteSessionKeyId(key);
    const entry = this.entries.get(id);
    if (!entry || entry.info?.session_id !== sessionId) return;
    this.discard(id, entry, "The remote session was lost.");
  }

  /** Closes one session now, whatever still leases it. */
  async closeSession(sessionId: number): Promise<void> {
    for (const [id, entry] of [...this.entries]) {
      if (entry.info?.session_id === sessionId) {
        await this.discard(id, entry, null);
        return;
      }
    }
  }

  /** Closes every session of a profile, such as on an explicit disconnect. */
  async closeProfile(profileId: string): Promise<void> {
    const closing: Promise<void>[] = [];
    for (const [id, entry] of [...this.entries]) {
      if (entry.key.profileId !== profileId) continue;
      closing.push(this.discard(id, entry, null));
    }
    await Promise.all(closing);
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.entries].map(([id, entry]) => this.discard(id, entry, null)),
    );
  }

  private ensureOpen(
    entry: Entry,
    connection: RemoteSshConnection,
  ): Promise<RemoteSessionInfo> {
    if (entry.opening) return entry.opening;
    const wasLost = entry.state.phase === "disconnected";
    entry.state = beginConnectionAttempt(
      entry.state,
      wasLost ? "reconnecting" : "connecting",
    );
    const attempt = entry.state.attempt;
    const generation = entry.generation;
    this.notify();
    const opening = this.deps
      .open(connection, entry.key.root)
      .then(
        (info) => {
          if (entry.generation !== generation) {
            void this.deps.close(info.session_id).catch(() => undefined);
            throw new Error(
              "The remote session was closed before it was ready.",
            );
          }
          entry.info = info;
          entry.state = settleConnectionAttempt(entry.state, attempt, "ready");
          return info;
        },
        (reason: unknown) => {
          if (entry.generation === generation) {
            entry.state = settleConnectionAttempt(
              entry.state,
              attempt,
              "failed",
              reason instanceof Error ? reason.message : String(reason),
            );
          }
          throw reason;
        },
      )
      .finally(() => {
        if (entry.opening === opening) entry.opening = undefined;
        this.notify();
      });
    entry.opening = opening;
    return opening;
  }

  private leaseFor(
    entry: Entry,
    info: RemoteSessionInfo,
    generation: number,
  ): RemoteSessionLease {
    let released = false;
    return {
      info,
      release: () => {
        if (released) return;
        released = true;
        if (entry.generation !== generation) return;
        entry.leases = Math.max(0, entry.leases - 1);
        if (entry.leases === 0) this.scheduleIdleClose(entry);
      },
    };
  }

  private scheduleIdleClose(entry: Entry): void {
    entry.cancelIdle?.();
    const generation = entry.generation;
    entry.cancelIdle = this.deps.schedule(() => {
      entry.cancelIdle = undefined;
      if (entry.generation !== generation || entry.leases > 0) return;
      void this.discard(remoteSessionKeyId(entry.key), entry, null);
    }, this.deps.idleMs);
  }

  private collect(id: string, entry: Entry): void {
    if (entry.leases > 0 || entry.info || entry.opening) return;
    if (entry.state.phase === "failed" || entry.state.phase === "idle") {
      this.entries.delete(id);
      this.notify();
    }
  }

  private discard(
    id: string,
    entry: Entry,
    reason: string | null,
  ): Promise<void> {
    entry.cancelIdle?.();
    entry.cancelIdle = undefined;
    const sessionId = entry.info?.session_id;
    entry.info = undefined;
    entry.generation += 1;
    entry.leases = 0;
    entry.state = disconnectConnection(entry.state, reason);
    if (this.entries.get(id) === entry) this.entries.delete(id);
    this.notify();
    return sessionId === undefined
      ? Promise.resolve()
      : this.deps.close(sessionId).catch(() => undefined);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
