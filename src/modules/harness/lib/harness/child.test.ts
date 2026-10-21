import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnlistenFn } from "@tauri-apps/api/event";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: never }) => void>(),
  invoke: vi.fn(),
  listen: vi.fn(),
  openRemote: vi.fn(),
  closeRemote: vi.fn(),
  request: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/modules/remote/client", () => ({
  openRemoteWorkspace: mocks.openRemote,
  closeRemoteWorkspace: mocks.closeRemote,
  requestRemoteResult: mocks.request,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

const storage = new Map<string, string>();
if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
    configurable: true,
    writable: true,
  });
}
if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  } as unknown as Window & typeof globalThis;
}
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function installResolvedListeners() {
  mocks.listen.mockImplementation(
    async (name: string, handler: (event: { payload: never }) => void) => {
      mocks.handlers.set(name, handler);
      return vi.fn();
    },
  );
}

async function loadChild() {
  vi.resetModules();
  return import("./child");
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  mocks.handlers.clear();
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
  vi.useRealTimers();
});

describe("isCurrentChildExit", () => {
  it("matches only the live child's pid", async () => {
    installResolvedListeners();
    const { isCurrentChildExit } = await loadChild();
    expect(isCurrentChildExit(undefined, 41)).toBe(false);
    expect(isCurrentChildExit(42, 41)).toBe(false);
    expect(isCurrentChildExit(42, 42)).toBe(true);
  });
});

describe("child bridge", () => {
  it("keeps logical control identity separate from the native process identity", async () => {
    installResolvedListeners();
    mocks.invoke.mockResolvedValue(42);
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    await child.spawnChild(
      "native-owner",
      "agent",
      [],
      "/repo",
      undefined,
      undefined,
      "logical-session",
    );
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "harness_spawn",
      expect.objectContaining({
        sessionId: "native-owner",
        logicalSessionId: "logical-session",
      }),
    );
    release();
  });

  it("ignores retired bridge callbacks for stdout, stderr and process exit", async () => {
    vi.useFakeTimers();
    installResolvedListeners();
    mocks.invoke.mockResolvedValue(42);
    const child = await loadChild();
    const firstRelease = await child.acquireHarnessBridge();
    const oldLine = mocks.handlers.get("harness-stdout");
    const oldError = mocks.handlers.get("harness-stderr");
    const oldExit = mocks.handlers.get("harness-exit");
    firstRelease();
    await vi.runAllTimersAsync();
    const release = await child.acquireHarnessBridge();
    const line = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();
    child.watchChild("current", line, exit, error);
    await child.spawnChild("current", "agent", [], "/repo");
    oldLine?.({ payload: { sessionId: "current", line: "retired" } as never });
    oldError?.({ payload: { sessionId: "current", line: "retired" } as never });
    oldExit?.({ payload: { sessionId: "current", pid: 42, code: 1 } as never });
    expect(line).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    mocks.handlers.get("harness-stdout")?.({
      payload: { sessionId: "current", line: "live" } as never,
    });
    mocks.handlers.get("harness-stderr")?.({
      payload: { sessionId: "current", line: "live error" } as never,
    });
    mocks.handlers.get("harness-exit")?.({
      payload: { sessionId: "current", pid: 42, code: 0 } as never,
    });
    expect(line).toHaveBeenCalledExactlyOnceWith("live");
    expect(error).toHaveBeenCalledExactlyOnceWith("live error");
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    release();
    await vi.runAllTimersAsync();
  });

  it("uses a headless backend without installing Tauri listeners", async () => {
    vi.useFakeTimers();
    const child = await loadChild();
    const invoke = vi.fn(async () => ({ path: "/fixture/opencode" }));
    const listen = vi.fn(async () => vi.fn());
    child.configureChildBackend({ invoke: invoke as never, listen });
    const release = await child.acquireHarnessBridge();
    expect(await child.resolveOpenCodeBinary()).toEqual({
      path: "/fixture/opencode",
    });
    expect(invoke).toHaveBeenCalledWith("harness_resolve_opencode", undefined);
    expect(listen).toHaveBeenCalledTimes(5);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(() =>
      child.configureChildBackend({ invoke: invoke as never, listen }),
    ).toThrow("once before");
    release();
    await vi.runAllTimersAsync();
  });

  it("rejects backend replacement after the desktop bridge starts", async () => {
    vi.useFakeTimers();
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    expect(() =>
      child.configureChildBackend({ invoke: vi.fn(), listen: vi.fn() }),
    ).toThrow("once before");
    release();
    await vi.runAllTimersAsync();
  });

  it("waits until every listener is installed", async () => {
    const pending = deferred<UnlistenFn>();
    mocks.listen.mockImplementation(
      (name: string, handler: (event: { payload: never }) => void) => {
        mocks.handlers.set(name, handler);
        return name === "harness-stdout"
          ? pending.promise
          : Promise.resolve(vi.fn());
      },
    );
    const child = await loadChild();
    let acquired = false;
    const lease = child.acquireHarnessBridge().then((release) => {
      acquired = true;
      return release;
    });

    await flush();
    expect(acquired).toBe(false);

    pending.resolve(vi.fn());
    const release = await lease;
    expect(acquired).toBe(true);
    release();
  });

  it("cleans a failed installation and allows retry", async () => {
    vi.useFakeTimers();
    const late = deferred<UnlistenFn>();
    const firstUnlisten = vi.fn();
    const lateUnlisten = vi.fn();
    mocks.listen
      .mockResolvedValueOnce(firstUnlisten)
      .mockRejectedValueOnce(new Error("listen failed"))
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(vi.fn())
      .mockResolvedValueOnce(vi.fn());
    const child = await loadChild();
    const releaseApp = child.startHarnessBridge();

    await expect(child.acquireHarnessBridge()).rejects.toThrow("listen failed");
    expect(firstUnlisten).toHaveBeenCalledOnce();

    late.resolve(lateUnlisten);
    await flush();
    expect(lateUnlisten).toHaveBeenCalledOnce();

    installResolvedListeners();
    const releaseProbe = await child.acquireHarnessBridge();
    releaseProbe();
    releaseApp();
    await vi.runAllTimersAsync();
  });

  it("reconciles an exit that arrives before spawn returns its pid", async () => {
    installResolvedListeners();
    const spawned = deferred<number>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "harness_spawn") return spawned.promise;
      return Promise.resolve();
    });
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const onExit = vi.fn();
    child.watchChild("probe", vi.fn(), onExit);

    const spawning = child.spawnChild(
      "probe",
      "pi",
      ["--mode", "rpc"],
      "/repo",
    );
    mocks.handlers.get("harness-exit")?.({
      payload: { sessionId: "probe", code: 1, pid: 42 } as never,
    });
    expect(onExit).not.toHaveBeenCalled();

    spawned.resolve(42);
    await spawning;
    expect(onExit).toHaveBeenCalledWith(1);
    release();
  });

  it("does not hold output for children another window owns", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const emit = (name: string, payload: unknown) =>
      mocks.handlers.get(name)?.({ payload: payload as never });

    // Events are broadcast to every window; this one never spawned "other".
    for (let i = 0; i < 5; i += 1) {
      emit("harness-stdout", { sessionId: "other", line: `line ${i}` });
      emit("harness-sse", { sessionId: "other", data: `event ${i}` });
    }

    const lines: string[] = [];
    const events: string[] = [];
    child.watchChild("other", (line) => lines.push(line), vi.fn());
    child.watchSse("other", (data) => events.push(data));
    expect(lines).toEqual([]);
    expect(events).toEqual([]);
    release();
  });

  it("still replays output a spawned child printed before it was watched", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const emit = (name: string, payload: unknown) =>
      mocks.handlers.get(name)?.({ payload: payload as never });
    mocks.invoke.mockResolvedValue(42);

    await child.spawnChild("mine", "agent", [], "/tmp");
    emit("harness-stdout", { sessionId: "mine", line: "early" });
    await child.openHarnessSse("mine", "http://127.0.0.1:1/event");
    const nativeSseId = mocks.invoke.mock.calls.find(
      (call) => call[0] === "harness_sse_open",
    )?.[1].sessionId;
    emit("harness-sse", { sessionId: nativeSseId, data: "early-event" });

    const lines: string[] = [];
    const events: string[] = [];
    child.watchChild("mine", (line) => lines.push(line), vi.fn());
    child.watchSse("mine", (data) => events.push(data));
    expect(lines).toEqual(["early"]);
    expect(events).toEqual(["early-event"]);
    release();
  });

  it("drops output a killed child prints after it was stopped", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const emit = (name: string, payload: unknown) =>
      mocks.handlers.get(name)?.({ payload: payload as never });
    mocks.invoke.mockResolvedValue(42);

    child.watchChild("probe", vi.fn(), vi.fn());
    await child.spawnChild("probe", "agent", [], "/tmp");
    await child.killChild("probe");
    emit("harness-stdout", { sessionId: "probe", line: "late" });

    const lines: string[] = [];
    child.watchChild("probe", (line) => lines.push(line), vi.fn());
    expect(lines).toEqual([]);
    release();
  });
});

describe("SSE transport incarnations", () => {
  it("ignores a retired bridge's cached SSE callbacks after reacquisition", async () => {
    vi.useFakeTimers();
    installResolvedListeners();
    mocks.invoke.mockResolvedValue(undefined);
    const child = await loadChild();
    const firstRelease = await child.acquireHarnessBridge();
    const oldData = mocks.handlers.get("harness-sse");
    const oldEnd = mocks.handlers.get("harness-sse-end");
    firstRelease();
    await vi.runAllTimersAsync();
    const release = await child.acquireHarnessBridge();
    const data = vi.fn();
    const end = vi.fn();
    child.watchSse("same", data, end);
    await child.openHarnessSse("same", "http://127.0.0.1:1/event");
    const nativeId = mocks.invoke.mock.calls.find(
      (call) => call[0] === "harness_sse_open",
    )?.[1].sessionId;
    oldData?.({ payload: { sessionId: nativeId, data: "retired" } as never });
    oldEnd?.({ payload: { sessionId: nativeId, error: "retired" } as never });
    expect(data).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    mocks.handlers.get("harness-sse")?.({
      payload: { sessionId: nativeId, data: "current" } as never,
    });
    expect(data).toHaveBeenCalledExactlyOnceWith("current");
    release();
    await vi.runAllTimersAsync();
  });

  it("counts retiring native streams against capacity until cleanup settles", async () => {
    installResolvedListeners();
    mocks.invoke.mockResolvedValue(undefined);
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    for (let index = 0; index < 256; index++)
      await child.openHarnessSse(`stream-${index}`, "http://127.0.0.1:1/event");
    const closing = deferred<void>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "harness_sse_close" ? closing.promise : Promise.resolve(),
    );
    const stopped = child.closeHarnessSse("stream-0");
    await expect(
      child.openHarnessSse("extra", "http://127.0.0.1:1/event"),
    ).rejects.toThrow("HARNESS_SSE_CAPACITY");
    closing.resolve();
    await stopped;
    await child.openHarnessSse("extra", "http://127.0.0.1:1/event");
    release();
  });

  it("bounds watcher registrations without replacing an admitted handler", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    for (let index = 0; index < 256; index++)
      child.watchSse(`stream-${index}`, vi.fn());
    expect(() => child.watchSse("extra", vi.fn())).toThrow(
      "HARNESS_SSE_CAPACITY",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    child.unwatchSse("stream-0");
    expect(() => child.watchSse("extra", vi.fn())).not.toThrow();
    release();
  });

  const emit = (name: string, payload: unknown) =>
    mocks.handlers.get(name)?.({ payload: payload as never });
  const nativeIds = () =>
    mocks.invoke.mock.calls
      .filter((call) => call[0] === "harness_sse_open")
      .map((call) => call[1].sessionId);

  it("routes only the current native transport after the same logical session reopens", async () => {
    installResolvedListeners();
    mocks.invoke.mockResolvedValue(undefined);
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const oldData = vi.fn();
    const oldEnd = vi.fn();
    const data = vi.fn();
    const end = vi.fn();
    child.watchSse("same", oldData, oldEnd);
    await child.openHarnessSse("same", "http://127.0.0.1:1/event");
    const oldId = nativeIds()[0];
    child.watchSse("same", data, end);
    await child.openHarnessSse("same", "http://127.0.0.1:1/event");
    const id = nativeIds()[1];
    expect(id).not.toBe(oldId);
    emit("harness-sse", { sessionId: oldId, data: "stale" });
    emit("harness-sse-end", { sessionId: oldId, error: "stale end" });
    expect(data).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(oldData).not.toHaveBeenCalled();
    expect(oldEnd).not.toHaveBeenCalled();
    emit("harness-sse", { sessionId: id, data: "current" });
    emit("harness-sse-end", { sessionId: id, error: "current end" });
    expect(data).toHaveBeenCalledExactlyOnceWith("current");
    expect(end).toHaveBeenCalledExactlyOnceWith("current end");
    release();
  });

  it("closes the captured native transport rather than a later logical replacement", async () => {
    installResolvedListeners();
    mocks.invoke.mockResolvedValue(undefined);
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const oldData = vi.fn();
    child.watchSse("same", oldData);
    await child.openHarnessSse("same", "http://127.0.0.1:1/event");
    const data = vi.fn();
    child.watchSse("same", data);
    await child.openHarnessSse("same", "http://127.0.0.1:1/event");
    const id = nativeIds()[1];
    mocks.invoke.mockClear();
    await child.closeHarnessSse("same", oldData);
    expect(mocks.invoke).not.toHaveBeenCalled();
    emit("harness-sse", { sessionId: id, data: "survives" });
    expect(data).toHaveBeenCalledWith("survives");
    await child.closeHarnessSse("same", data);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("harness_sse_close", {
      sessionId: id,
    });
    release();
  });

  it("does not replay a retired transport's buffered events into a new watcher", async () => {
    installResolvedListeners();
    mocks.invoke.mockResolvedValue(undefined);
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    await child.openHarnessSse("same", "http://127.0.0.1:1/event");
    emit("harness-sse", { sessionId: nativeIds()[0], data: "early" });
    const first = vi.fn();
    child.watchSse("same", first);
    expect(first).toHaveBeenCalledWith("early");
    const second = vi.fn();
    child.watchSse("same", second);
    emit("harness-sse", { sessionId: nativeIds()[0], data: "late" });
    expect(second).not.toHaveBeenCalled();
    release();
  });

  it("contains a superseded pending open failure without removing the current stream", async () => {
    installResolvedListeners();
    const pending = deferred<void>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "harness_sse_open" && nativeIds().length === 1
        ? pending.promise
        : Promise.resolve(),
    );
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    child.watchSse("same", vi.fn());
    const old = child.openHarnessSse("same", "http://127.0.0.1:1/event");
    const failed = expect(old).rejects.toThrow("old failure");
    const current = vi.fn();
    child.watchSse("same", current);
    await child.openHarnessSse("same", "http://127.0.0.1:1/event");
    const id = nativeIds()[1];
    pending.reject(new Error("old failure"));
    await failed;
    emit("harness-sse", { sessionId: id, data: "current" });
    expect(current).toHaveBeenCalledWith("current");
    expect(
      mocks.invoke.mock.calls
        .filter((call) => call[0] === "harness_sse_close")
        .some((call) => call[1].sessionId === id),
    ).toBe(false);
    release();
  });
});

describe("remote spawnChild", () => {
  async function admissionFixture() {
    installResolvedListeners();
    const child = await loadChild();
    const { usePreferencesStore } = await import(
      "@/modules/settings/preferences"
    );
    const profile = {
      id: "admission",
      name: "Admission",
      host: "original.test",
      user: "dev",
      port: 22,
    };
    usePreferencesStore.setState({ sshConnections: [profile] });
    const { rememberRemoteProject, remotePath } = await import(
      "@/modules/connections/model/remoteProjects"
    );
    const { remoteSshEnvironmentId } = await import(
      "@/modules/connections/model/remoteSshProfiles"
    );
    const environment = remoteSshEnvironmentId(profile.id);
    const root = "/workspace/admission";
    rememberRemoteProject(environment, {
      id: "admission-project",
      cwd: root,
      name: "Admission",
    });
    let nextId = 100;
    mocks.openRemote.mockReset().mockImplementation(async () => ({
      session_id: nextId++,
      architecture: "x86_64",
      workspace_root: root,
      helper_version: "1",
      capabilities: [],
    }));
    mocks.closeRemote.mockReset().mockResolvedValue(undefined);
    mocks.request.mockReset();
    mocks.invoke.mockReset().mockResolvedValue(42);
    const { remoteSessions } = await import("@/modules/remote/sessionManager");
    const release = await child.acquireHarnessBridge();
    return {
      child,
      remoteSessions,
      release,
      profile,
      usePreferencesStore,
      key: { profileId: profile.id, root },
      connection: {
        host: profile.host,
        user: profile.user,
        port: profile.port,
      },
      cwd: remotePath(environment, root),
    };
  }

  it("does not bypass a live connection-binding rejection through native fallback", async () => {
    const f = await admissionFixture();
    const lease = await f.remoteSessions.acquire(f.key, f.connection);
    const before = f.remoteSessions.snapshot();
    f.usePreferencesStore.setState({
      sshConnections: [{ ...f.profile, host: "replacement.test" }],
    });
    try {
      await expect(
        f.child.spawnChild("blocked", "codex", [], f.cwd),
      ).rejects.toMatchObject({ code: "REMOTE_SESSION_CONNECTION_CHANGED" });
      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(mocks.openRemote).toHaveBeenCalledOnce();
      expect(f.remoteSessions.snapshot()).toEqual(before);
    } finally {
      await lease.releaseAndClose?.();
      f.release();
    }
  });

  it.each(["ready", "failed"])(
    "does not fallback after pending helper retirement: %s",
    async (outcome) => {
      const f = await admissionFixture();
      const info = {
        session_id: 100,
        architecture: "x86_64",
        workspace_root: f.key.root,
        helper_version: "1",
        capabilities: [] as string[],
      };
      const opening = deferred<typeof info>();
      const entered = deferred<void>();
      const cleanup = deferred<void>();
      mocks.openRemote.mockImplementationOnce(() => {
        entered.resolve(undefined);
        return opening.promise;
      });
      if (outcome === "ready")
        mocks.closeRemote.mockReturnValueOnce(cleanup.promise);
      const spawning = f.child.spawnChild("retired", "codex", [], f.cwd);
      const rejected = expect(spawning).rejects.toMatchObject({
        code: "REMOTE_SESSION_ADMISSION_BLOCKED",
        reason: "retired",
      });
      await entered.promise;
      const closing = f.remoteSessions.closeProfile(f.profile.id);
      if (outcome === "ready") opening.resolve(info);
      else
        opening.reject(
          new Error("ordinary authentication failure after retirement"),
        );
      try {
        await rejected;
        expect(mocks.invoke).not.toHaveBeenCalled();
        expect(mocks.openRemote).toHaveBeenCalledOnce();
        if (outcome === "ready") {
          expect(f.remoteSessions.snapshot()[0]).toMatchObject({
            sessionId: info.session_id,
            closing: true,
          });
          expect(mocks.closeRemote).toHaveBeenCalledExactlyOnceWith(
            info.session_id,
          );
        } else {
          expect(mocks.closeRemote).not.toHaveBeenCalled();
        }
      } finally {
        cleanup.resolve(undefined);
        await closing;
        expect(f.remoteSessions.snapshot()).toEqual([]);
        f.release();
      }
    },
  );

  it("does not bypass retained failed cleanup through native fallback", async () => {
    const f = await admissionFixture();
    const lease = await f.remoteSessions.acquire(f.key, f.connection);
    mocks.closeRemote.mockRejectedValueOnce(new Error("close uncertain"));
    await expect(
      f.remoteSessions.closeSession(lease.info.session_id),
    ).rejects.toThrow("close uncertain");
    try {
      await expect(
        f.child.spawnChild("blocked", "codex", [], f.cwd),
      ).rejects.toMatchObject({
        code: "REMOTE_SESSION_ADMISSION_BLOCKED",
        reason: "cleanup",
      });
      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(mocks.openRemote).toHaveBeenCalledOnce();
      expect(f.remoteSessions.snapshot()[0]).toMatchObject({
        closing: true,
        sessionId: lease.info.session_id,
      });
    } finally {
      await f.remoteSessions.closeAll();
      f.release();
    }
  });

  it("propagates cleanup failure after waiting for the captured close attempt", async () => {
    const f = await admissionFixture();
    const lease = await f.remoteSessions.acquire(f.key, f.connection);
    const gate = deferred<void>();
    mocks.closeRemote.mockReturnValueOnce(gate.promise);
    const closing = f.remoteSessions.closeSession(lease.info.session_id);
    const closeRejected = expect(closing).rejects.toThrow(
      "delayed close failure",
    );
    const spawning = f.child.spawnChild("blocked", "codex", [], f.cwd);
    const spawnRejected = expect(spawning).rejects.toMatchObject({
      code: "REMOTE_SESSION_ADMISSION_BLOCKED",
      reason: "cleanup",
    });
    await flush();
    expect(mocks.invoke).not.toHaveBeenCalled();
    gate.reject(new Error("delayed close failure"));
    try {
      await closeRejected;
      await spawnRejected;
      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(mocks.openRemote).toHaveBeenCalledOnce();
    } finally {
      await f.remoteSessions.closeAll();
      f.release();
    }
  });

  it("does not bypass the shared helper reservation budget through native fallback", async () => {
    const f = await admissionFixture();
    for (let i = 0; i < 256; i += 1)
      await f.remoteSessions.acquire(
        { profileId: `occupied-${i}`, root: f.key.root },
        f.connection,
      );
    try {
      await expect(
        f.child.spawnChild("blocked", "codex", [], f.cwd),
      ).rejects.toMatchObject({
        code: "REMOTE_SESSION_ADMISSION_BLOCKED",
        reason: "capacity",
      });
      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(mocks.openRemote).toHaveBeenCalledTimes(256);
      expect(f.remoteSessions.snapshot()).toHaveLength(256);
    } finally {
      await f.remoteSessions.closeAll();
      f.release();
    }
  });

  it.each([
    "ordinary bootstrap unavailable",
    "Remote session cleanup failed; retry closing it before reconnecting.",
  ])(
    "preserves ordinary unavailable-helper fallback without classifying message text: %s",
    async (message) => {
      const f = await admissionFixture();
      mocks.openRemote.mockRejectedValueOnce(new Error(message));
      try {
        await f.child.spawnChild("fallback", "codex", [], f.cwd);
        expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
          "harness_spawn",
          expect.objectContaining({ remoteSessionId: null, remoteRoot: null }),
        );
      } finally {
        f.release();
      }
    },
  );

  it("waits for successful cleanup and uses the newly admitted helper without fallback", async () => {
    const f = await admissionFixture();
    const lease = await f.remoteSessions.acquire(f.key, f.connection);
    const gate = deferred<void>();
    mocks.closeRemote.mockReturnValueOnce(gate.promise);
    const closing = f.remoteSessions.closeSession(lease.info.session_id);
    const spawning = f.child.spawnChild("new-owner", "codex", [], f.cwd);
    await flush();
    expect(mocks.invoke).not.toHaveBeenCalled();
    gate.resolve(undefined);
    try {
      await closing;
      await spawning;
      expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
        "harness_spawn",
        expect.objectContaining({
          remoteSessionId: 101,
          remoteRoot: f.key.root,
        }),
      );
    } finally {
      await f.child.killChild("new-owner");
      await f.remoteSessions.closeAll();
      f.release();
    }
  });

  it("cleans command executable name for remote target", async () => {
    const { cleanRemoteCommand } = await loadChild();
    expect(cleanRemoteCommand("C:\\Users\\user\\AppData\\npm\\codex.cmd")).toBe(
      "codex",
    );
    expect(cleanRemoteCommand("/usr/bin/claude")).toBe("claude");
    expect(cleanRemoteCommand("agent.exe")).toBe("agent");
    expect(cleanRemoteCommand("my-agent.sh")).toBe("my-agent");
  });

  it("resolves remote SSH connection and passes it to harness_spawn", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const { usePreferencesStore } = await import(
      "@/modules/settings/preferences"
    );
    usePreferencesStore.setState({
      sshConnections: [
        {
          id: "ssh-config-test-1",
          name: "Test Server",
          host: "192.168.1.4",
          user: "root",
          port: 22,
        },
      ],
    });

    const { rememberRemoteProject } = await import(
      "@/modules/connections/model/remoteProjects"
    );
    rememberRemoteProject("voktty-ssh-ssh-config-test-1", {
      id: "project",
      cwd: "/workspace/project",
      name: "project",
    });
    mocks.openRemote.mockReset().mockResolvedValue(undefined);

    const release = await child.acquireHarnessBridge();
    mocks.invoke.mockResolvedValue(42);

    await child.spawnChild(
      "session-1",
      "C:\\tools\\codex.cmd",
      ["app-server"],
      "remote://voktty-ssh-ssh-config-test-1/workspace/project",
    );

    expect(mocks.invoke).toHaveBeenCalledWith("harness_spawn", {
      sessionId: "session-1",
      command: "codex",
      args: ["app-server"],
      cwd: "remote://voktty-ssh-ssh-config-test-1/workspace/project",
      networkAllowlist: null,
      account: undefined,
      remoteConnection: {
        host: "192.168.1.4",
        user: "root",
        port: 22,
      },
      remoteCwd: "/workspace/project",
      remoteSessionId: null,
      remoteRoot: null,
      remoteRelativeCwd: ".",
    });

    release();
  });

  it("keeps the project helper session open for a remote agent and releases it when stopped", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const { usePreferencesStore } = await import(
      "@/modules/settings/preferences"
    );
    usePreferencesStore.setState({
      sshConnections: [
        {
          id: "p1",
          name: "Test Server",
          host: "192.168.1.4",
          user: "root",
          port: 22,
        },
      ],
    });
    const { rememberRemoteProject, remotePath } = await import(
      "@/modules/connections/model/remoteProjects"
    );
    const { remoteSshEnvironmentId } = await import(
      "@/modules/connections/model/remoteSshProfiles"
    );
    const environmentId = remoteSshEnvironmentId("p1");
    rememberRemoteProject(environmentId, {
      id: "project",
      cwd: "/workspace/project",
      name: "project",
    });
    mocks.openRemote.mockReset().mockResolvedValue({
      session_id: 9,
      architecture: "x86_64",
      workspace_root: "/workspace/project",
      helper_version: "1",
      capabilities: ["proc.spawn", "agent.probe"],
    });
    mocks.closeRemote.mockReset().mockResolvedValue(undefined);
    mocks.request.mockReset().mockResolvedValue({
      found: true,
      path: "/usr/bin/codex",
      version: "0.46.0",
    });
    mocks.invoke.mockResolvedValue(42);

    const release = await child.acquireHarnessBridge();
    await child.spawnChild(
      "session-2",
      "codex",
      ["app-server"],
      remotePath(environmentId, "/workspace/project/src"),
    );

    expect(mocks.openRemote).toHaveBeenCalledOnce();
    expect(mocks.openRemote.mock.calls[0]?.[1]).toBe("/workspace/project");
    expect(mocks.request).toHaveBeenCalledWith(9, "agent.probe", {
      command: "codex",
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "harness_spawn",
      expect.objectContaining({
        remoteSessionId: 9,
        remoteRoot: "/workspace/project",
        remoteRelativeCwd: "src",
      }),
    );
    expect(mocks.closeRemote).not.toHaveBeenCalled();

    await child.killChild("session-2");
    await Promise.resolve();
    expect(mocks.closeRemote).toHaveBeenCalledWith(9);

    release();
  });

  it("releases the held helper session when the native spawn fails", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const { usePreferencesStore } = await import(
      "@/modules/settings/preferences"
    );
    usePreferencesStore.setState({
      sshConnections: [
        {
          id: "p2",
          name: "Other",
          host: "192.168.1.5",
          user: "root",
          port: 22,
        },
      ],
    });
    const { rememberRemoteProject, remotePath } = await import(
      "@/modules/connections/model/remoteProjects"
    );
    const { remoteSshEnvironmentId } = await import(
      "@/modules/connections/model/remoteSshProfiles"
    );
    const environmentId = remoteSshEnvironmentId("p2");
    rememberRemoteProject(environmentId, { id: "p", cwd: "/srv/p", name: "p" });
    mocks.openRemote.mockReset().mockResolvedValue({
      session_id: 11,
      architecture: "x86_64",
      workspace_root: "/srv/p",
      helper_version: "1",
      capabilities: [],
    });
    mocks.closeRemote.mockReset().mockResolvedValue(undefined);
    mocks.invoke.mockRejectedValue(new Error("codex is not installed"));

    const release = await child.acquireHarnessBridge();
    await expect(
      child.spawnChild(
        "session-3",
        "codex",
        [],
        remotePath(environmentId, "/srv/p"),
      ),
    ).rejects.toThrow("codex is not installed");
    await Promise.resolve();
    expect(mocks.closeRemote).toHaveBeenCalledWith(11);
    release();
  });

  it("refuses a remote agent that the host does not have, before starting anything", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const { usePreferencesStore } = await import(
      "@/modules/settings/preferences"
    );
    usePreferencesStore.setState({
      sshConnections: [
        { id: "p3", name: "Bare", host: "192.168.1.6", user: "root", port: 22 },
      ],
    });
    const { rememberRemoteProject, remotePath } = await import(
      "@/modules/connections/model/remoteProjects"
    );
    const { remoteSshEnvironmentId } = await import(
      "@/modules/connections/model/remoteSshProfiles"
    );
    const environmentId = remoteSshEnvironmentId("p3");
    rememberRemoteProject(environmentId, { id: "p", cwd: "/srv/q", name: "q" });
    mocks.openRemote.mockReset().mockResolvedValue({
      session_id: 12,
      architecture: "x86_64",
      workspace_root: "/srv/q",
      helper_version: "1",
      capabilities: ["agent.probe"],
    });
    mocks.closeRemote.mockReset().mockResolvedValue(undefined);
    mocks.request.mockReset().mockResolvedValue({ found: false });
    mocks.invoke.mockReset();

    const release = await child.acquireHarnessBridge();
    await expect(
      child.spawnChild(
        "session-4",
        "codex",
        [],
        remotePath(environmentId, "/srv/q"),
      ),
    ).rejects.toThrow(/codex is not installed on the remote host/);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(mocks.closeRemote).toHaveBeenCalledWith(12);
    release();
  });

  it("only starts agents inside a saved remote project", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const { usePreferencesStore } = await import(
      "@/modules/settings/preferences"
    );
    usePreferencesStore.setState({
      sshConnections: [
        {
          id: "p4",
          name: "Loose",
          host: "192.168.1.7",
          user: "root",
          port: 22,
        },
      ],
    });
    const { remotePath } = await import(
      "@/modules/connections/model/remoteProjects"
    );
    const { remoteSshEnvironmentId } = await import(
      "@/modules/connections/model/remoteSshProfiles"
    );
    mocks.invoke.mockReset();
    const release = await child.acquireHarnessBridge();
    await expect(
      child.spawnChild(
        "session-5",
        "codex",
        [],
        remotePath(remoteSshEnvironmentId("p4"), "/etc"),
      ),
    ).rejects.toThrow("outside a saved remote project");
    expect(mocks.invoke).not.toHaveBeenCalled();
    release();
  });
});
