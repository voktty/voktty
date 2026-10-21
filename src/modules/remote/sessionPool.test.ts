import { describe, expect, it, vi } from "vitest";
import type { RemoteSessionInfo, RemoteSshConnection } from "./client";
import {
  isSessionLostError,
  RemoteSessionConnectionChangedError,
  RemoteSessionPool,
  type RemoteSessionKey,
} from "./sessionPool";

const connection: RemoteSshConnection = { host: "example.test", port: 22 };
const key: RemoteSessionKey = { profileId: "p1", root: "/srv/app" };

function info(id: number): RemoteSessionInfo {
  return {
    session_id: id,
    architecture: "x86_64",
    workspace_root: "/srv/app",
    helper_version: "1",
    capabilities: [],
  };
}

function harness() {
  let nextId = 1;
  const timers: Array<{ task: () => void; delay: number; cancelled: boolean }> =
    [];
  const open = vi.fn(async (_connection: RemoteSshConnection, _root: string) =>
    info(nextId++),
  );
  const close = vi.fn(async () => undefined);
  const pool = new RemoteSessionPool({
    open,
    close,
    idleMs: 1000,
    schedule: (task, delay) => {
      const timer = { task, delay, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const fireIdle = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.task();
  };
  return { pool, open, close, fireIdle };
}

describe("RemoteSessionPool", () => {
  it("shares one open between concurrent consumers", async () => {
    const { pool, open } = harness();
    const [a, b] = await Promise.all([
      pool.acquire(key, connection),
      pool.acquire(key, connection),
    ]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(a.info.session_id).toBe(b.info.session_id);
    expect(pool.snapshot()[0]?.leases).toBe(2);
  });

  it.each([
    { host: "other.test" },
    { user: "other-user" },
    { port: 2222 },
    { identityFile: "/keys/other" },
    { extraArgs: "-o ProxyJump=other" },
    { initialDirectory: "/srv/other" },
  ])(
    "rejects a changed live native binding without affecting busy sibling leases: %o",
    async (changed) => {
      const { pool, open, close } = harness();
      const original: RemoteSshConnection = {
        ...connection,
        user: "dev",
        identityFile: "/keys/build",
        extraArgs: "-o ProxyJump=bastion",
        initialDirectory: "/srv/app",
      };
      const project = await pool.acquire(key, original);
      const pty = await pool.acquire(key, original);
      project.release();
      const before = pool.snapshot();
      const rejected = pool.acquire(key, { ...original, ...changed });
      await expect(rejected).rejects.toBeInstanceOf(
        RemoteSessionConnectionChangedError,
      );
      await expect(rejected).rejects.toMatchObject({
        code: "REMOTE_SESSION_CONNECTION_CHANGED",
        message: "The remote session connection configuration changed.",
      });
      expect(pool.snapshot()).toEqual(before);
      expect(pool.snapshot()[0]?.leases).toBe(1);
      expect(open).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
      pty.release();
    },
  );

  it("rejects changed configuration while a same-key native open is pending", async () => {
    const { pool, open, close } = harness();
    let resolveOpen!: (value: RemoteSessionInfo) => void;
    open.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOpen = resolve;
      }),
    );
    const pending = pool.acquire(key, connection);
    const before = pool.snapshot();
    await expect(
      pool.acquire(key, { ...connection, user: "other-user" }),
    ).rejects.toBeInstanceOf(RemoteSessionConnectionChangedError);
    expect(pool.snapshot()).toEqual(before);
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    resolveOpen(info(7));
    const lease = await pending;
    expect(lease.info.session_id).toBe(7);
    expect(pool.snapshot()[0]?.leases).toBe(1);
    lease.release();
  });

  it("retains idle collection when a changed binding is rejected after the last release", async () => {
    const { pool, open, close, fireIdle } = harness();
    (await pool.acquire(key, connection)).release();
    await expect(
      pool.acquire(key, { host: "other.test" }),
    ).rejects.toBeInstanceOf(RemoteSessionConnectionChangedError);
    expect(pool.snapshot()[0]?.leases).toBe(0);
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    fireIdle();
    expect(close).toHaveBeenCalledExactlyOnceWith(1);
    expect(pool.snapshot()).toEqual([]);
    const changed = await pool.acquire(key, { host: "other.test" });
    expect(changed.info.session_id).toBe(2);
    expect(open).toHaveBeenCalledTimes(2);
    changed.release();
  });

  it("accepts new configuration after a fully released native session is closed", async () => {
    const { pool, open, close } = harness();
    const first = await pool.acquire(key, connection);
    first.release();
    await pool.closeSession(first.info.session_id);
    const second = await pool.acquire(key, {
      host: "other.test",
      user: "other-user",
    });
    expect(second.info.session_id).toBe(2);
    expect(open).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledExactlyOnceWith(1);
    expect(pool.snapshot()[0]?.leases).toBe(1);
    second.release();
  });

  it("allows changed configuration after a failed open has no native resources", async () => {
    const { pool, open, close } = harness();
    open.mockRejectedValueOnce(new Error("auth failed"));
    await expect(pool.acquire(key, connection)).rejects.toThrow("auth failed");
    const retry = await pool.acquire(key, { host: "other.test" });
    expect(retry.info.session_id).toBe(1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();
    retry.release();
  });

  it("accepts equivalent trimmed values, omitted defaults and PTY-only metadata changes", async () => {
    const { pool, open } = harness();
    const first = await pool.acquire(key, {
      host: " example.test ",
      user: " ",
      identityFile: " ",
      extraArgs: " ",
      initialDirectory: " ",
      multiplexerMode: "auto",
    });
    const second = await pool.acquire(key, {
      ...connection,
      multiplexerMode: "tmux",
      activeMultiplexerSession: "other-terminal",
    });
    expect(first.info.session_id).toBe(second.info.session_id);
    expect(pool.snapshot()[0]?.leases).toBe(2);
    expect(open).toHaveBeenCalledTimes(1);
    first.release();
    second.release();
  });

  it("captures immutable pending native configuration despite caller mutation", async () => {
    const { pool, open, close } = harness();
    const mutable = { ...connection, user: "dev", identityFile: "/keys/build" };
    let resolveOpen!: (value: RemoteSessionInfo) => void;
    open.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOpen = resolve;
      }),
    );
    const pending = pool.acquire(key, mutable);
    mutable.host = "other.test";
    mutable.user = "other-user";
    mutable.identityFile = "/keys/other";
    expect(open.mock.calls[0]?.[0]).toEqual({
      ...connection,
      user: "dev",
      identityFile: "/keys/build",
    });
    expect(open.mock.calls[0]?.[0]).not.toBe(mutable);
    await expect(pool.acquire(key, mutable)).rejects.toBeInstanceOf(
      RemoteSessionConnectionChangedError,
    );
    expect(pool.snapshot()[0]?.leases).toBe(1);
    resolveOpen(info(7));
    const original = await pending;
    await expect(pool.acquire(key, mutable)).rejects.toBeInstanceOf(
      RemoteSessionConnectionChangedError,
    );
    const sibling = await pool.acquire(key, {
      ...connection,
      user: "dev",
      identityFile: "/keys/build",
    });
    expect(pool.snapshot()[0]?.leases).toBe(2);
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(Object.keys(pool.snapshot()[0] ?? {})).toEqual([
      "key",
      "state",
      "sessionId",
      "leases",
    ]);
    original.release();
    sibling.release();
  });

  it("reuses a ready session and keeps it open until the idle delay", async () => {
    const { pool, open, close, fireIdle } = harness();
    const first = await pool.acquire(key, connection);
    first.release();
    first.release();
    const second = await pool.acquire(key, connection);
    expect(open).toHaveBeenCalledTimes(1);
    second.release();
    expect(close).not.toHaveBeenCalled();
    fireIdle();
    expect(close).toHaveBeenCalledWith(1);
    expect(pool.snapshot()).toEqual([]);
  });

  it("does not close a session that gained a consumer before the idle delay", async () => {
    const { pool, close, fireIdle } = harness();
    (await pool.acquire(key, connection)).release();
    const again = await pool.acquire(key, connection);
    fireIdle();
    expect(close).not.toHaveBeenCalled();
    again.release();
  });

  it("keeps separate sessions per root and per profile", async () => {
    const { pool, open } = harness();
    await pool.acquire(key, connection);
    await pool.acquire({ ...key, root: "/srv/other" }, connection);
    await pool.acquire({ ...key, profileId: "p2" }, connection);
    expect(open).toHaveBeenCalledTimes(3);
  });

  it("drops a failed open so the next use retries", async () => {
    const { pool, open } = harness();
    open.mockRejectedValueOnce(new Error("auth failed"));
    await expect(pool.acquire(key, connection)).rejects.toThrow("auth failed");
    expect(pool.snapshot()).toEqual([]);
    const lease = await pool.acquire(key, connection);
    expect(lease.info.session_id).toBe(1);
  });

  it("reopens once when the helper reports a lost session", async () => {
    const { pool, open, close } = harness();
    const task = vi
      .fn<(value: RemoteSessionInfo) => Promise<string>>()
      .mockRejectedValueOnce(new Error("remote session 1 not found"))
      .mockResolvedValueOnce("ok");
    await expect(pool.use(key, connection, task)).resolves.toBe("ok");
    expect(open).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledWith(1);
    expect(task.mock.calls.map(([value]) => value.session_id)).toEqual([1, 2]);
  });

  it("does not retry ordinary task failures or retry twice", async () => {
    const { pool, open } = harness();
    await expect(
      pool.use(key, connection, async () => {
        throw new Error("fs.readDir: permission denied");
      }),
    ).rejects.toThrow("permission denied");
    expect(open).toHaveBeenCalledTimes(1);

    const alwaysLost = vi.fn(async () => {
      throw new Error("remote SSH session closed");
    });
    await expect(pool.use(key, connection, alwaysLost)).rejects.toThrow(
      "remote SSH session closed",
    );
    expect(alwaysLost).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("closes the sessions of a disconnected profile and ignores stale leases", async () => {
    const { pool, close } = harness();
    const lease = await pool.acquire(key, connection);
    await pool.acquire({ ...key, profileId: "p2" }, connection);
    await pool.closeProfile("p1");
    expect(close).toHaveBeenCalledWith(1);
    expect(close).not.toHaveBeenCalledWith(2);
    lease.release();
    expect(pool.snapshot().map((entry) => entry.key.profileId)).toEqual(["p2"]);
  });

  it("closes a session that finishes opening after a disconnect", async () => {
    const { pool, open, close } = harness();
    let resolveOpen: (value: RemoteSessionInfo) => void = () => undefined;
    open.mockReturnValueOnce(
      new Promise<RemoteSessionInfo>((resolve) => {
        resolveOpen = resolve;
      }),
    );
    const pending = pool.acquire(key, connection);
    const rejected = expect(pending).rejects.toThrow(/closed before/);
    await pool.closeProfile("p1");
    resolveOpen(info(7));
    await rejected;
    expect(close).toHaveBeenCalledWith(7);
    expect(pool.snapshot()).toEqual([]);
  });

  it("notifies subscribers and reports connection phases", async () => {
    const { pool } = harness();
    const phases: string[] = [];
    pool.subscribe(() => {
      const state = pool.snapshot()[0]?.state;
      if (state) phases.push(state.phase);
    });
    await pool.acquire(key, connection);
    expect(phases).toContain("connecting");
    expect(phases[phases.length - 1]).toBe("ready");
  });
});

describe("isSessionLostError", () => {
  it.each([
    "remote session 4 not found",
    "remote session not found",
    "remote SSH session closed",
    "remote helper closed the SSH channel",
  ])("recognizes %s", (message) => {
    expect(isSessionLostError(new Error(message))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isSessionLostError(new Error("fs.readDir: not found"))).toBe(false);
  });
});
