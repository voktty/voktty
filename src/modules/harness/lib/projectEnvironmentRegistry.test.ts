import { describe, expect, it, vi } from "vitest";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";
import {
  MAX_PROJECT_ENVIRONMENT_OWNERS,
  ProjectEnvironmentCancelledError,
  ProjectEnvironmentRegistry,
  type ProjectEnvironmentTarget,
} from "./projectEnvironmentRegistry";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function target(
  projectId = "project-a",
  profileId = "profile-a",
  root = "/srv/app",
): ProjectEnvironmentTarget {
  return {
    projectId,
    profileId,
    root,
    connection: { host: "example.test", user: "synthetic-user" },
  };
}

function lease(id = 1): RemoteSessionLease {
  return {
    info: {
      session_id: id,
      architecture: "x86_64",
      workspace_root: "/srv/app",
      helper_version: "1",
      capabilities: ["fs"],
    },
    release: vi.fn(),
  };
}

function harness() {
  const acquire =
    vi.fn<(value: ProjectEnvironmentTarget) => Promise<RemoteSessionLease>>();
  const release = vi.fn(async (value: RemoteSessionLease) => value.release());
  const registry = new ProjectEnvironmentRegistry({ acquire, release });
  return { registry, acquire, release };
}

const flush = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

describe("ProjectEnvironmentRegistry", () => {
  it("does not acquire a remote lease until a remote owner connects", () => {
    const { registry, acquire } = harness();
    expect(registry.snapshot()).toEqual([]);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("admits the exact registered operation before notifying or acquiring", async () => {
    const { registry, acquire } = harness();
    const pending = deferred<RemoteSessionLease>();
    acquire.mockReturnValueOnce(pending.promise);
    const listener = vi.fn();
    registry.subscribe(listener);
    const admitted = vi.fn((operation: Promise<RemoteSessionLease["info"]>) => {
      expect(registry.snapshot()).toEqual([
        expect.objectContaining({
          ownerId: "owner-a",
          projectId: "project-a",
          state: { phase: "connecting", attempt: 1, error: null },
        }),
      ]);
      expect(registry.connect("owner-a", target())).toBe(operation);
      expect(listener).not.toHaveBeenCalled();
      expect(acquire).not.toHaveBeenCalled();
    });
    const operation = registry.connect("owner-a", target(), false, admitted);
    expect(admitted).toHaveBeenCalledExactlyOnceWith(operation);
    expect(listener).toHaveBeenCalledTimes(1);
    const value = lease();
    pending.resolve(value);
    expect(await operation).toBe(value.info);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("connects siblings independently and releases only the selected owner", async () => {
    const { registry, acquire, release } = harness();
    const first = lease(1);
    const second = lease(2);
    acquire.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await registry.connect("owner-a", target());
    await registry.connect(
      "owner-b",
      target("project-b", "profile-b", "/other"),
    );
    await registry.releaseOwner("owner-a");
    expect(release).toHaveBeenCalledExactlyOnceWith(first);
    expect(second.release).not.toHaveBeenCalled();
    expect(registry.snapshot()).toEqual([
      expect.objectContaining({
        ownerId: "owner-b",
        projectId: "project-b",
        profileId: "profile-b",
        requestedRoot: "/other",
        state: { phase: "ready", attempt: 1, error: null },
      }),
    ]);
  });

  it("leaves same-root sharing to the pool while retaining independent real leases", async () => {
    const { registry, acquire, release } = harness();
    const first = lease(7);
    const second = lease(7);
    acquire.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const [firstInfo, secondInfo] = await Promise.all([
      registry.connect("owner-a", target()),
      registry.connect("owner-b", target()),
    ]);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(firstInfo.session_id).toBe(secondInfo.session_id);
    await registry.releaseOwner("owner-a");
    expect(release).toHaveBeenCalledExactlyOnceWith(first);
    expect(second.release).not.toHaveBeenCalled();
    expect(await registry.connect("owner-b", target())).toBe(second.info);
  });

  it("deduplicates a pending connection for the same owner and identity", async () => {
    const { registry, acquire } = harness();
    const pending = deferred<RemoteSessionLease>();
    acquire.mockReturnValue(pending.promise);
    const first = registry.connect("owner-a", target());
    const admitted = vi.fn();
    const second = registry.connect("owner-a", target(), false, admitted);
    expect(second).toBe(first);
    expect(admitted).toHaveBeenCalledExactlyOnceWith(second);
    await flush();
    expect(acquire).toHaveBeenCalledTimes(1);
    const value = lease();
    pending.resolve(value);
    expect(await first).toBe(value.info);
    expect(await second).toBe(value.info);
  });

  it("returns the ready lease without reconnecting or releasing it", async () => {
    const { registry, acquire, release } = harness();
    const value = lease();
    acquire.mockResolvedValue(value);
    await registry.connect("owner-a", target());
    const admitted = vi.fn();
    const operation = registry.connect("owner-a", target(), false, admitted);
    expect(admitted).toHaveBeenCalledExactlyOnceWith(operation);
    expect(registry.snapshot()[0].state.phase).toBe("ready");
    expect(await operation).toBe(value.info);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  it("reconnects the same root without releasing the replacement lease", async () => {
    const { registry, acquire, release } = harness();
    const first = lease(7);
    const replacement = lease(7);
    acquire.mockResolvedValueOnce(first).mockResolvedValueOnce(replacement);
    await registry.connect("owner-a", target());
    expect(await registry.connect("owner-a", target(), true)).toBe(
      replacement.info,
    );
    expect(release).toHaveBeenCalledExactlyOnceWith(first);
    expect(replacement.release).not.toHaveBeenCalled();
    expect(registry.snapshot()[0].state).toEqual({
      phase: "ready",
      attempt: 2,
      error: null,
    });
  });

  it.each([
    target("project-b"),
    target("project-a", "profile-b"),
    target("project-a", "profile-a", "/other"),
  ])(
    "replaces when any identity field changes: %j",
    async (replacementTarget) => {
      const { registry, acquire, release } = harness();
      const first = lease();
      acquire.mockResolvedValueOnce(first).mockResolvedValueOnce(lease(2));
      await registry.connect("owner-a", target());
      await registry.connect("owner-a", replacementTarget);
      expect(release).toHaveBeenCalledExactlyOnceWith(first);
      expect(acquire).toHaveBeenLastCalledWith(replacementTarget);
      expect(registry.snapshot()[0].projectId).toBe(
        replacementTarget.projectId,
      );
    },
  );

  it("waits for old cleanup before acquiring a replacement", async () => {
    const { registry, acquire, release } = harness();
    const cleanup = deferred<void>();
    acquire.mockResolvedValueOnce(lease()).mockResolvedValueOnce(lease(2));
    release.mockReturnValueOnce(cleanup.promise);
    await registry.connect("owner-a", target());
    const replacement = registry.connect("owner-a", target("project-b"));
    await flush();
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(registry.snapshot()[0].state.phase).toBe("reconnecting");
    cleanup.resolve();
    await replacement;
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it("keeps the cleanup barrier through rapid repeated replacements", async () => {
    const { registry, acquire, release } = harness();
    const cleanup = deferred<void>();
    acquire.mockResolvedValueOnce(lease()).mockResolvedValueOnce(lease(3));
    release.mockReturnValueOnce(cleanup.promise);
    await registry.connect("owner-a", target());
    const skipped = registry.connect("owner-a", target("project-b"));
    const cancelled = expect(skipped).rejects.toBeInstanceOf(
      ProjectEnvironmentCancelledError,
    );
    const current = registry.connect("owner-a", target("project-c"));
    await flush();
    expect(acquire).toHaveBeenCalledTimes(1);
    cleanup.resolve();
    await cancelled;
    await current;
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(acquire).toHaveBeenLastCalledWith(target("project-c"));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("invalidates synchronously and deduplicates concurrent owner releases", async () => {
    const { registry, acquire, release } = harness();
    const cleanup = deferred<void>();
    acquire.mockResolvedValue(lease());
    release.mockReturnValueOnce(cleanup.promise);
    await registry.connect("owner-a", target());
    const first = registry.releaseOwner("owner-a");
    expect(registry.snapshot()).toEqual([]);
    const second = registry.releaseOwner("owner-a");
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
    cleanup.resolve();
    await Promise.all([first, second]);
  });

  it("waits for releaseOwner cleanup before a new connect for that owner", async () => {
    const { registry, acquire, release } = harness();
    const cleanup = deferred<void>();
    acquire.mockResolvedValueOnce(lease()).mockResolvedValueOnce(lease(2));
    release.mockReturnValueOnce(cleanup.promise);
    await registry.connect("owner-a", target());
    const closing = registry.releaseOwner("owner-a");
    const replacement = registry.connect("owner-a", target("project-b"));
    await flush();
    expect(acquire).toHaveBeenCalledTimes(1);
    cleanup.resolve();
    await Promise.all([closing, replacement]);
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it("releases a late success after releaseOwner exactly once and rejects cancellation", async () => {
    const { registry, acquire, release } = harness();
    const pending = deferred<RemoteSessionLease>();
    acquire.mockReturnValueOnce(pending.promise);
    const connection = registry.connect("owner-a", target());
    const cancelled = expect(connection).rejects.toBeInstanceOf(
      ProjectEnvironmentCancelledError,
    );
    await flush();
    await registry.releaseOwner("owner-a");
    const late = lease();
    pending.resolve(late);
    await cancelled;
    expect(release).toHaveBeenCalledExactlyOnceWith(late);
    expect(registry.snapshot()).toEqual([]);
  });

  it("releases a late success after replacement without changing the current session", async () => {
    const { registry, acquire, release } = harness();
    const pending = deferred<RemoteSessionLease>();
    const current = lease(2);
    acquire.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(current);
    const stale = registry.connect("owner-a", target());
    const cancelled = expect(stale).rejects.toBeInstanceOf(
      ProjectEnvironmentCancelledError,
    );
    await flush();
    await registry.connect("owner-a", target("project-b"));
    const late = lease(1);
    pending.resolve(late);
    await cancelled;
    expect(release).toHaveBeenCalledExactlyOnceWith(late);
    expect(current.release).not.toHaveBeenCalled();
    expect(registry.snapshot()[0]).toMatchObject({
      projectId: "project-b",
      session: current.info,
    });
  });

  it("does not let a late failure overwrite the replacement state", async () => {
    const { registry, acquire } = harness();
    const pending = deferred<RemoteSessionLease>();
    acquire
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(lease(2));
    const stale = registry.connect("owner-a", target());
    const cancelled = expect(stale).rejects.toBeInstanceOf(
      ProjectEnvironmentCancelledError,
    );
    await flush();
    await registry.connect("owner-a", target("project-b"));
    pending.reject(new Error("old acquire failed"));
    await cancelled;
    expect(registry.snapshot()[0].state).toEqual({
      phase: "ready",
      attempt: 2,
      error: null,
    });
  });

  it("reports an acquisition error and supports retry without releasing a nonexistent lease", async () => {
    const { registry, acquire, release } = harness();
    const failure = new Error("auth failed");
    acquire.mockRejectedValueOnce(failure).mockResolvedValueOnce(lease());
    await expect(registry.connect("owner-a", target())).rejects.toBe(failure);
    expect(registry.snapshot()[0].state).toEqual({
      phase: "failed",
      attempt: 1,
      error: "auth failed",
    });
    await registry.connect("owner-a", target());
    expect(registry.snapshot()[0].state).toEqual({
      phase: "ready",
      attempt: 2,
      error: null,
    });
    expect(release).not.toHaveBeenCalled();
  });

  it("preserves a normal bridge rejection string without wrapping it", async () => {
    const { registry, acquire } = harness();
    acquire.mockRejectedValueOnce("auth failed");
    await expect(registry.connect("owner-a", target())).rejects.toBe(
      "auth failed",
    );
    expect(registry.snapshot()[0].state.error).toBe("auth failed");
  });

  it("surfaces cleanup failure without acquiring the replacement or leaking its error contents", async () => {
    const { registry, acquire, release } = harness();
    acquire.mockResolvedValue(lease());
    await registry.connect("owner-a", target());
    release.mockRejectedValueOnce(new Error("private cleanup contents"));
    await expect(
      registry.connect("owner-a", target("project-b")),
    ).rejects.toThrow("Could not release the previous project environment.");
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(registry.snapshot()[0].state).toEqual({
      phase: "failed",
      attempt: 2,
      error: "Could not release the previous project environment.",
    });
  });

  it("makes cleanup failure after cancellation recognizable and sanitized", async () => {
    const { registry, acquire, release } = harness();
    const pending = deferred<RemoteSessionLease>();
    acquire.mockReturnValueOnce(pending.promise);
    release.mockRejectedValueOnce(new Error("private cleanup contents"));
    const connection = registry.connect("owner-a", target());
    const rejected = expect(connection).rejects.toMatchObject({
      name: "ProjectEnvironmentCancelledError",
      code: "PROJECT_ENVIRONMENT_CANCELLED",
      message:
        "The project environment connection was cancelled, but cleanup failed.",
    });
    await flush();
    await registry.releaseOwner("owner-a");
    pending.resolve(lease());
    await rejected;
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases matching profiles only, including multiple owners of the same profile", async () => {
    const { registry, acquire, release } = harness();
    const values = [lease(1), lease(2), lease(3)];
    for (const value of values) acquire.mockResolvedValueOnce(value);
    await registry.connect("owner-a", target());
    await registry.connect(
      "owner-b",
      target("project-b", "profile-a", "/other"),
    );
    await registry.connect("owner-c", target("project-c", "profile-b"));
    const closing = registry.releaseProfiles(new Set(["profile-a"]));
    expect(registry.snapshot().map((value) => value.ownerId)).toEqual([
      "owner-c",
    ]);
    await closing;
    expect(release).toHaveBeenCalledTimes(2);
    expect(values[2].release).not.toHaveBeenCalled();
  });

  it("attempts every bulk cleanup before reporting a sanitized failure", async () => {
    const { registry, acquire, release } = harness();
    acquire.mockResolvedValueOnce(lease(1)).mockResolvedValueOnce(lease(2));
    await registry.connect("owner-a", target());
    await registry.connect("owner-b", target());
    release.mockRejectedValueOnce(new Error("private cleanup contents"));
    const closing = registry.releaseAll();
    expect(registry.snapshot()).toEqual([]);
    await expect(closing).rejects.toThrow(
      "Could not release the previous project environment.",
    );
    expect(release).toHaveBeenCalledTimes(2);
    await expect(registry.releaseAll()).rejects.toThrow(
      "Could not release the previous project environment.",
    );
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("bounds owner capacity and recovers slots after release", async () => {
    const { registry, acquire } = harness();
    acquire.mockImplementation(async () => lease());
    await Promise.all(
      Array.from({ length: MAX_PROJECT_ENVIRONMENT_OWNERS }, (_, index) =>
        registry.connect(`owner-${index}`, target()),
      ),
    );
    const rejectedAdmission = vi.fn();
    await expect(
      registry.connect("overflow", target(), false, rejectedAdmission),
    ).rejects.toThrow("Too many project environment owners.");
    expect(rejectedAdmission).not.toHaveBeenCalled();
    expect(acquire).toHaveBeenCalledTimes(MAX_PROJECT_ENVIRONMENT_OWNERS);
    await registry.releaseOwner("owner-0");
    await registry.connect("replacement-owner", target());
    expect(registry.snapshot()).toHaveLength(MAX_PROJECT_ENVIRONMENT_OWNERS);
  });

  it("counts owners still cleaning up against the capacity limit", async () => {
    const { registry, acquire, release } = harness();
    const cleanup = deferred<void>();
    acquire.mockImplementation(async () => lease());
    await Promise.all(
      Array.from({ length: MAX_PROJECT_ENVIRONMENT_OWNERS }, (_, index) =>
        registry.connect(`owner-${index}`, target()),
      ),
    );
    release.mockReturnValueOnce(cleanup.promise);
    const closing = registry.releaseOwner("owner-0");
    await expect(registry.connect("overflow", target())).rejects.toThrow(
      "Too many project environment owners.",
    );
    cleanup.resolve();
    await closing;
    await registry.connect("replacement-owner", target());
  });

  it("retains capacity for cancelled acquisitions until their late leases are released", async () => {
    const { registry, acquire, release } = harness();
    const pending = Array.from({ length: MAX_PROJECT_ENVIRONMENT_OWNERS }, () =>
      deferred<RemoteSessionLease>(),
    );
    for (const value of pending) acquire.mockReturnValueOnce(value.promise);
    acquire.mockResolvedValue(lease(999));
    const connections = pending.map((_, index) =>
      registry.connect(`owner-${index}`, target()).catch((reason) => reason),
    );
    await flush();
    expect(acquire).toHaveBeenCalledTimes(MAX_PROJECT_ENVIRONMENT_OWNERS);
    await registry.releaseAll();
    expect(registry.snapshot()).toEqual([]);
    await expect(registry.connect("overflow", target())).rejects.toThrow(
      "Too many project environment owners.",
    );
    pending.forEach((value, index) => {
      value.resolve(lease(index));
    });
    const results = await Promise.all(connections);
    expect(
      results.every(
        (value) => value instanceof ProjectEnvironmentCancelledError,
      ),
    ).toBe(true);
    expect(release).toHaveBeenCalledTimes(MAX_PROJECT_ENVIRONMENT_OWNERS);
    await registry.connect("next-owner", target());
  });

  it("cannot bypass the outstanding-operation limit with repeated force on one owner", async () => {
    const { registry, acquire } = harness();
    const pending = Array.from({ length: MAX_PROJECT_ENVIRONMENT_OWNERS }, () =>
      deferred<RemoteSessionLease>(),
    );
    const connections: Promise<unknown>[] = [];
    let current: Promise<unknown> | undefined;
    for (const value of pending) {
      acquire.mockReturnValueOnce(value.promise);
      current = registry.connect("one-owner", target(), true);
      connections.push(current.catch((reason) => reason));
      await flush();
    }
    expect(acquire).toHaveBeenCalledTimes(MAX_PROJECT_ENVIRONMENT_OWNERS);
    expect(registry.connect("one-owner", target())).toBe(current);
    const rejectedAdmission = vi.fn();
    await expect(
      registry.connect("one-owner", target(), true, rejectedAdmission),
    ).rejects.toThrow("Too many project environment owners.");
    expect(rejectedAdmission).not.toHaveBeenCalled();
    await registry.releaseAll();
    pending.forEach((value, index) => {
      value.resolve(lease(index));
    });
    await Promise.all(connections);
    acquire.mockResolvedValue(lease(999));
    await registry.connect("one-owner", target());
  });

  it("does not forget a failed releaseOwner cleanup and silently reacquire", async () => {
    const { registry, acquire, release } = harness();
    acquire.mockResolvedValue(lease());
    await registry.connect("owner-a", target());
    release.mockRejectedValueOnce(new Error("private cleanup contents"));
    await expect(registry.releaseOwner("owner-a")).rejects.toThrow(
      "Could not release the previous project environment.",
    );
    await expect(registry.connect("owner-a", target())).rejects.toThrow(
      "Could not release the previous project environment.",
    );
    await expect(registry.releaseOwner("owner-a")).rejects.toThrow(
      "Could not release the previous project environment.",
    );
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("blocks reacquisition after late cancelled-lease cleanup fails", async () => {
    const { registry, acquire, release } = harness();
    const pending = deferred<RemoteSessionLease>();
    acquire.mockReturnValueOnce(pending.promise);
    const stale = registry.connect("owner-a", target());
    const cancelled = expect(stale).rejects.toBeInstanceOf(
      ProjectEnvironmentCancelledError,
    );
    await flush();
    await registry.releaseOwner("owner-a");
    release.mockRejectedValueOnce(new Error("private cleanup contents"));
    pending.resolve(lease());
    await cancelled;
    await expect(registry.connect("owner-a", target())).rejects.toThrow(
      "Could not release the previous project environment.",
    );
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("still releases the current lease after a stale lease cleanup has failed", async () => {
    const { registry, acquire, release } = harness();
    const pending = deferred<RemoteSessionLease>();
    const current = lease(2);
    acquire.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(current);
    const stale = registry.connect("owner-a", target());
    const cancelled = expect(stale).rejects.toBeInstanceOf(
      ProjectEnvironmentCancelledError,
    );
    await flush();
    await registry.connect("owner-a", target("project-b"));
    release.mockRejectedValueOnce(new Error("private cleanup contents"));
    pending.resolve(lease(1));
    await cancelled;
    expect(registry.snapshot()[0].state.phase).toBe("ready");
    await expect(registry.releaseOwner("owner-a")).rejects.toThrow(
      "Could not release the previous project environment.",
    );
    expect(current.release).toHaveBeenCalledTimes(1);
    await expect(registry.connect("owner-a", target())).rejects.toThrow(
      "Could not release the previous project environment.",
    );
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it("blocks a queued replacement if a late lease cleanup fails while it waits", async () => {
    const { registry, acquire, release } = harness();
    const pending = deferred<RemoteSessionLease>();
    const cleanup = deferred<void>();
    acquire
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(lease(2))
      .mockResolvedValueOnce(lease(3));
    const stale = registry.connect("owner-a", target());
    const cancelled = expect(stale).rejects.toBeInstanceOf(
      ProjectEnvironmentCancelledError,
    );
    await flush();
    await registry.connect("owner-a", target("project-b"));
    release
      .mockReturnValueOnce(cleanup.promise)
      .mockRejectedValueOnce(new Error("private cleanup contents"));
    const replacement = registry.connect("owner-a", target("project-c"));
    const failed = expect(replacement).rejects.toThrow(
      "Could not release the previous project environment.",
    );
    await flush();
    pending.resolve(lease(1));
    await cancelled;
    cleanup.resolve();
    await failed;
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(registry.snapshot()[0]).toMatchObject({
      projectId: "project-c",
      state: { phase: "failed" },
    });
  });

  it.each([
    ["", target()],
    ["  ", target()],
    ["owner", target("")],
    ["owner", target("project", " ")],
    ["owner", target("project", "profile", "")],
  ])("rejects empty identities before acquire: %j", async (ownerId, value) => {
    const { registry, acquire } = harness();
    const rejectedAdmission = vi.fn();
    await expect(
      registry.connect(ownerId, value, false, rejectedAdmission),
    ).rejects.toThrow("A non-empty project environment identity is required.");
    expect(rejectedAdmission).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
    expect(registry.snapshot()).toEqual([]);
  });

  it("keeps connection details and private leases out of copied snapshots", async () => {
    const { registry, acquire } = harness();
    const value = lease();
    acquire.mockResolvedValue(value);
    await registry.connect("owner-a", target());
    const snapshot = registry.snapshot()[0];
    expect(snapshot).not.toHaveProperty("connection");
    expect(snapshot).not.toHaveProperty("lease");
    expect(snapshot).not.toHaveProperty("target");
    snapshot.state.phase = "failed";
    snapshot.session?.capabilities.push("mutated");
    expect(registry.snapshot()[0].state.phase).toBe("ready");
    expect(registry.snapshot()[0].session?.capabilities).toEqual(["fs"]);
  });

  it("notifies subscribers for changes and supports unsubscribe", async () => {
    const { registry, acquire } = harness();
    acquire.mockResolvedValue(lease());
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    await registry.connect("owner-a", target());
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await registry.releaseOwner("owner-a");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
