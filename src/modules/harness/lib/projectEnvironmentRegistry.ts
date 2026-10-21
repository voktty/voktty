import {
  beginConnectionAttempt,
  disconnectConnection,
  IDLE_CONNECTION_STATE,
  type ResourceConnectionState,
  settleConnectionAttempt,
} from "@/modules/connections/lifecycle";
import type {
  RemoteSessionInfo,
  RemoteSshConnection,
} from "@/modules/remote/client";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";
import { sameRemoteSessionConnection } from "@/modules/remote/sessionConnectionIdentity";

export const MAX_PROJECT_ENVIRONMENT_OWNERS = 256;

export type ProjectEnvironmentTarget = {
  projectId: string;
  profileId: string;
  root: string;
  connection: RemoteSshConnection;
};

export type ProjectEnvironmentSnapshot = {
  ownerId: string;
  projectId: string;
  profileId: string;
  requestedRoot: string;
  state: ResourceConnectionState;
  session?: RemoteSessionInfo;
};

type RegistryDeps = {
  acquire: (target: ProjectEnvironmentTarget) => Promise<RemoteSessionLease>;
  release: (lease: RemoteSessionLease) => Promise<void>;
};

type Entry = {
  ownerId: string;
  target: ProjectEnvironmentTarget;
  state: ResourceConnectionState;
  cleanup: Promise<void>;
  lease?: RemoteSessionLease;
  operation?: Promise<RemoteSessionInfo>;
  disposal?: Promise<void>;
};

export class ProjectEnvironmentCapacityError extends Error {
  readonly code = "PROJECT_ENVIRONMENT_CAPACITY";

  constructor() {
    super("Too many project environment owners.");
    this.name = "ProjectEnvironmentCapacityError";
  }
}

export class ProjectEnvironmentCancelledError extends Error {
  readonly code = "PROJECT_ENVIRONMENT_CANCELLED";

  constructor(cleanupFailed = false) {
    super(
      cleanupFailed
        ? "The project environment connection was cancelled, but cleanup failed."
        : "The project environment connection was cancelled.",
    );
    this.name = "ProjectEnvironmentCancelledError";
  }
}

class ProjectEnvironmentReleaseError extends Error {
  constructor() {
    super("Could not release the previous project environment.");
  }
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sameTarget(a: ProjectEnvironmentTarget, b: ProjectEnvironmentTarget) {
  return (
    a.projectId === b.projectId &&
    a.profileId === b.profileId &&
    a.root === b.root &&
    sameRemoteSessionConnection(a.connection, b.connection)
  );
}

export class ProjectEnvironmentRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly cleanups = new Map<string, Promise<void>>();
  private readonly operations = new Set<Entry>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: RegistryDeps) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ProjectEnvironmentSnapshot[] {
    return [...this.entries.values()].map((entry) => ({
      ownerId: entry.ownerId,
      projectId: entry.target.projectId,
      profileId: entry.target.profileId,
      requestedRoot: entry.target.root,
      state: { ...entry.state },
      ...(entry.lease
        ? {
            session: {
              ...entry.lease.info,
              capabilities: [...entry.lease.info.capabilities],
            },
          }
        : {}),
    }));
  }

  connect(
    ownerId: string,
    target: ProjectEnvironmentTarget,
    force = false,
    onAdmitted?: (operation: Promise<RemoteSessionInfo>) => void,
  ): Promise<RemoteSessionInfo> {
    if (
      !validIdentity(ownerId) ||
      !target ||
      !validIdentity(target.projectId) ||
      !validIdentity(target.profileId) ||
      !validIdentity(target.root)
    ) {
      return Promise.reject(
        new Error("A non-empty project environment identity is required."),
      );
    }
    const previous = this.entries.get(ownerId);
    if (previous && !force && sameTarget(previous.target, target)) {
      if (previous.lease) {
        const operation = Promise.resolve(previous.lease.info);
        onAdmitted?.(operation);
        return operation;
      }
      if (previous.operation && previous.state.phase !== "failed") {
        const operation = previous.operation;
        onAdmitted?.(operation);
        return operation;
      }
    }
    const owners = new Set([
      ...this.entries.keys(),
      ...this.cleanups.keys(),
      ...[...this.operations].map((entry) => entry.ownerId),
    ]);
    if (
      this.operations.size >= MAX_PROJECT_ENVIRONMENT_OWNERS ||
      (!owners.has(ownerId) && owners.size >= MAX_PROJECT_ENVIRONMENT_OWNERS)
    ) {
      return Promise.reject(new ProjectEnvironmentCapacityError());
    }
    const entry: Entry = {
      ownerId,
      target: { ...target, connection: { ...target.connection } },
      state: beginConnectionAttempt(
        previous?.state ?? IDLE_CONNECTION_STATE,
        force || previous?.state.phase === "ready"
          ? "reconnecting"
          : "connecting",
      ),
      cleanup: previous
        ? this.dispose(previous)
        : (this.cleanups.get(ownerId) ?? Promise.resolve()),
    };
    this.entries.set(ownerId, entry);
    this.operations.add(entry);
    const operation = this.open(entry);
    entry.operation = operation;
    const settled = () => this.operations.delete(entry);
    void operation.then(settled, settled);
    onAdmitted?.(operation);
    this.notify();
    return operation;
  }

  async releaseOwner(ownerId: string): Promise<void> {
    const entry = this.entries.get(ownerId);
    if (!entry) {
      await this.cleanups.get(ownerId);
      return;
    }
    this.entries.delete(ownerId);
    const cleanup = this.dispose(entry);
    this.notify();
    await cleanup;
  }

  async releaseOwners(ownerIds: ReadonlySet<string>): Promise<void> {
    await this.releaseEntries(
      [...this.entries.values()].filter((entry) => ownerIds.has(entry.ownerId)),
      [...ownerIds].flatMap((id) => {
        const cleanup = this.cleanups.get(id);
        return cleanup ? [cleanup] : [];
      }),
    );
  }

  async releaseProfiles(profileIds: ReadonlySet<string>): Promise<void> {
    await this.releaseEntries(
      [...this.entries.values()].filter((entry) =>
        profileIds.has(entry.target.profileId),
      ),
    );
  }

  async releaseAll(): Promise<void> {
    const pending = [...this.cleanups.values()];
    await this.releaseEntries([...this.entries.values()], pending);
  }

  private async open(entry: Entry): Promise<RemoteSessionInfo> {
    try {
      await entry.cleanup;
      if (!this.isCurrent(entry)) throw new ProjectEnvironmentCancelledError();
      const barrier = this.cleanups.get(entry.ownerId);
      if (barrier) await barrier;
      if (!this.isCurrent(entry)) throw new ProjectEnvironmentCancelledError();
      const lease = await this.deps.acquire(entry.target);
      if (!this.isCurrent(entry)) {
        try {
          await this.deps.release(lease);
        } catch {
          this.blockOwner(entry.ownerId);
          throw new ProjectEnvironmentCancelledError(true);
        }
        throw new ProjectEnvironmentCancelledError();
      }
      entry.lease = lease;
      entry.state = settleConnectionAttempt(
        entry.state,
        entry.state.attempt,
        "ready",
      );
      this.notify();
      return lease.info;
    } catch (reason) {
      if (!this.isCurrent(entry)) {
        throw reason instanceof ProjectEnvironmentCancelledError
          ? reason
          : new ProjectEnvironmentCancelledError();
      }
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Could not connect the project environment.";
      entry.state = settleConnectionAttempt(
        entry.state,
        entry.state.attempt,
        "failed",
        message,
      );
      this.notify();
      throw reason;
    }
  }

  private dispose(entry: Entry): Promise<void> {
    if (entry.disposal) return entry.disposal;
    entry.state = disconnectConnection(entry.state);
    const lease = entry.lease;
    entry.lease = undefined;
    const releasing = entry.cleanup.then(() =>
      lease ? this.deps.release(lease) : undefined,
    );
    const previous = this.cleanups.get(entry.ownerId);
    const cleanup = Promise.allSettled([
      releasing,
      ...(previous ? [previous] : []),
    ]).then((results) => {
      if (results.some((result) => result.status === "rejected")) {
        throw new ProjectEnvironmentReleaseError();
      }
    });
    entry.disposal = cleanup;
    this.cleanups.set(entry.ownerId, cleanup);
    const forget = () => {
      if (this.cleanups.get(entry.ownerId) === cleanup) {
        this.cleanups.delete(entry.ownerId);
      }
    };
    // Failed release keeps the owner blocked until the caller reconciles it.
    void cleanup.then(forget, () => undefined);
    return cleanup;
  }

  private blockOwner(ownerId: string): void {
    const previous = this.cleanups.get(ownerId) ?? Promise.resolve();
    const reject = () => {
      throw new ProjectEnvironmentReleaseError();
    };
    const failure = previous.then(reject, reject);
    this.cleanups.set(ownerId, failure);
    void failure.catch(() => undefined);
  }

  private async releaseEntries(
    entries: Entry[],
    pending: Promise<void>[] = [],
  ): Promise<void> {
    for (const entry of entries) this.entries.delete(entry.ownerId);
    const cleanups = entries.map((entry) => this.dispose(entry));
    if (entries.length > 0) this.notify();
    const results = await Promise.allSettled([...pending, ...cleanups]);
    if (results.some((result) => result.status === "rejected")) {
      throw new ProjectEnvironmentReleaseError();
    }
  }

  private isCurrent(entry: Entry): boolean {
    return this.entries.get(entry.ownerId) === entry;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
