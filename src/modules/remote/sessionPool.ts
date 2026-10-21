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

const ADMISSION_MESSAGES = {
  cleanup:
    "Remote session cleanup failed; retry closing it before reconnecting.",
  capacity: "Remote session limit reached; close an unused session first.",
  retired: "The remote session was closed before it was ready.",
};

export class RemoteSessionAdmissionBlockedError extends Error {
  readonly code = "REMOTE_SESSION_ADMISSION_BLOCKED";

  constructor(readonly reason: "cleanup" | "capacity" | "retired") {
    super(ADMISSION_MESSAGES[reason]);
    this.name = "RemoteSessionAdmissionBlockedError";
  }
}

export function isRemoteSessionAdmissionError(reason: unknown): boolean {
  return (
    reason instanceof RemoteSessionConnectionChangedError ||
    reason instanceof RemoteSessionAdmissionBlockedError
  );
}

export type RemoteSessionLease = {
  readonly info: RemoteSessionInfo;
  /** Idempotent. A lease from a closed or replaced session releases nothing. */
  release: () => void;
  /** Releases once; last-owner cleanup retains its exact retry handle on failure. */
  releaseAndClose?: () => Promise<void>;
};

export type RemoteSessionSnapshot = {
  key: RemoteSessionKey;
  state: ResourceConnectionState;
  sessionId?: number;
  leases: number;
  closing?: boolean;
};

export type RemoteSessionPoolDeps = {
  open: (
    connection: RemoteSshConnection,
    root: string,
  ) => Promise<RemoteSessionInfo>;
  close: (sessionId: number) => Promise<void>;
  schedule: (task: () => void, delayMs: number) => () => void;
  idleMs: number;
  maxSessions?: number;
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
  closing?: boolean;
  closeAttempt?: Promise<void>;
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

/** One helper per (profile, root), including reservations awaiting cleanup ACK. */
export class RemoteSessionPool {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private readonly maxSessions: number;

  constructor(private readonly deps: RemoteSessionPoolDeps) {
    this.maxSessions = deps.maxSessions ?? 256;
    if (!Number.isSafeInteger(this.maxSessions) || this.maxSessions <= 0)
      throw new Error("Remote session limit must be a positive safe integer.");
  }

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
      ...(entry.closing ? { closing: true } : {}),
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
    if (entry?.closing) {
      if (!entry.closeAttempt)
        throw new RemoteSessionAdmissionBlockedError("cleanup");
      try {
        await entry.closeAttempt;
      } catch {
        throw new RemoteSessionAdmissionBlockedError("cleanup");
      }
      return this.acquire(key, connection);
    }
    if (
      entry &&
      (entry.info || entry.opening || entry.leases > 0) &&
      !sameRemoteSessionConnection(entry.binding, binding)
    ) {
      throw new RemoteSessionConnectionChangedError();
    }
    if (!entry) {
      if (this.entries.size >= this.maxSessions)
        throw new RemoteSessionAdmissionBlockedError("capacity");
      entry = {
        key: Object.freeze({ ...key }),
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
      if (entry.generation !== generation)
        throw new Error("The remote session was closed before it was ready.");
      return this.leaseFor(entry, info, generation);
    } catch (reason) {
      if (entry.generation !== generation)
        throw new RemoteSessionAdmissionBlockedError("retired");
      entry.leases = Math.max(0, entry.leases - 1);
      this.collect(id, entry);
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

  /** Retires an exact lost session; failed native cleanup remains addressable. */
  invalidate(key: RemoteSessionKey, sessionId: number): void {
    const id = remoteSessionKeyId(key);
    const entry = this.entries.get(id);
    if (!entry || entry.info?.session_id !== sessionId) return;
    void this.discard(id, entry, "The remote session was lost.").catch(
      () => undefined,
    );
  }

  /** Closes or retries one exact session now, whatever still leases it. */
  closeSession(sessionId: number): Promise<void> {
    for (const [id, entry] of this.entries) {
      if (entry.info?.session_id === sessionId)
        return this.discard(id, entry, null);
    }
    return Promise.resolve();
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
    let resolveOpen!: (info: RemoteSessionInfo) => void;
    let rejectOpen!: (reason: unknown) => void;
    const opening = new Promise<RemoteSessionInfo>((resolve, reject) => {
      resolveOpen = resolve;
      rejectOpen = reject;
    });
    entry.opening = opening;
    this.notify();
    const settle = async () => {
      try {
        if (entry.closing)
          throw new Error("The remote session was closed before it was ready.");
        const info = await this.deps.open(connection, entry.key.root);
        entry.info = info;
        if (entry.generation !== generation)
          throw new Error("The remote session was closed before it was ready.");
        entry.state = settleConnectionAttempt(entry.state, attempt, "ready");
        resolveOpen(info);
      } catch (reason) {
        if (entry.generation === generation)
          entry.state = settleConnectionAttempt(
            entry.state,
            attempt,
            "failed",
            reason instanceof Error ? reason.message : String(reason),
          );
        rejectOpen(reason);
      } finally {
        if (entry.opening === opening) entry.opening = undefined;
        this.notify();
      }
    };
    void settle();
    return opening;
  }

  private leaseFor(
    entry: Entry,
    info: RemoteSessionInfo,
    generation: number,
  ): RemoteSessionLease {
    let released = false;
    let closing: Promise<void> | undefined;
    const release = () => {
      if (released) return;
      released = true;
      if (entry.generation !== generation) return;
      entry.leases = Math.max(0, entry.leases - 1);
      if (entry.leases === 0) this.scheduleIdleClose(entry);
    };
    return {
      info,
      release,
      releaseAndClose: () => {
        if (closing) return closing;
        release();
        if (
          entry.leases > 0 ||
          this.entries.get(remoteSessionKeyId(entry.key)) !== entry
        ) {
          closing = Promise.resolve();
          return closing;
        }
        const pending = this.discard(
          remoteSessionKeyId(entry.key),
          entry,
          null,
        );
        closing = pending;
        void pending.catch(() => {
          if (closing === pending) closing = undefined;
        });
        return pending;
      },
    };
  }

  private scheduleIdleClose(entry: Entry): void {
    entry.cancelIdle?.();
    const generation = entry.generation;
    entry.cancelIdle = this.deps.schedule(() => {
      entry.cancelIdle = undefined;
      if (entry.generation !== generation || entry.leases > 0) return;
      void this.discard(remoteSessionKeyId(entry.key), entry, null).catch(
        () => undefined,
      );
    }, this.deps.idleMs);
  }

  private collect(id: string, entry: Entry): void {
    if (entry.closing || entry.leases > 0 || entry.info || entry.opening)
      return;
    if (entry.state.phase === "failed" || entry.state.phase === "idle") {
      if (this.entries.get(id) === entry) this.entries.delete(id);
      this.notify();
    }
  }

  private discard(
    id: string,
    entry: Entry,
    reason: string | null,
  ): Promise<void> {
    if (this.entries.get(id) !== entry) return Promise.resolve();
    if (entry.closeAttempt) return entry.closeAttempt;
    if (!entry.closing) {
      entry.cancelIdle?.();
      entry.cancelIdle = undefined;
      entry.generation += 1;
      entry.leases = 0;
      entry.closing = true;
    }
    entry.state = disconnectConnection(entry.state, reason);
    let resolveClose!: () => void;
    let rejectClose!: (reason: unknown) => void;
    const closing = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    entry.closeAttempt = closing;
    this.notify();
    const close = async () => {
      try {
        if (entry.opening) await entry.opening.catch(() => undefined);
        if (entry.info) await this.deps.close(entry.info.session_id);
        if (this.entries.get(id) === entry) this.entries.delete(id);
        resolveClose();
      } catch (failure) {
        if (entry.closeAttempt === closing) {
          entry.closeAttempt = undefined;
          entry.state = disconnectConnection(
            entry.state,
            "Remote session cleanup failed.",
          );
        }
        rejectClose(failure);
      } finally {
        this.notify();
      }
    };
    void close();
    return closing;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
