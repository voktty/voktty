import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnlistenFn } from "@tauri-apps/api/event";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: never }) => void>(),
  invoke: vi.fn(),
  listen: vi.fn(),
  openRemote: vi.fn(),
  closeRemote: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/modules/remote/client", () => ({
  openRemoteWorkspace: mocks.openRemote,
  closeRemoteWorkspace: mocks.closeRemote,
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
  it("uses a headless backend without installing Tauri listeners", async () => {
    vi.useFakeTimers();
    const child = await loadChild();
    const invoke = vi.fn(async () => ({ path: "/fixture/opencode" }));
    const listen = vi.fn(async () => vi.fn());
    child.configureChildBackend({ invoke: invoke as never, listen });
    const release = await child.acquireHarnessBridge();
    expect(await child.resolveOpenCodeBinary()).toEqual({ path: "/fixture/opencode" });
    expect(invoke).toHaveBeenCalledWith("harness_resolve_opencode", undefined);
    expect(listen).toHaveBeenCalledTimes(5);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(() => child.configureChildBackend({ invoke: invoke as never, listen })).toThrow("once before");
    release();
    await vi.runAllTimersAsync();
  });

  it("rejects backend replacement after the desktop bridge starts", async () => {
    vi.useFakeTimers();
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    expect(() => child.configureChildBackend({ invoke: vi.fn(), listen: vi.fn() })).toThrow("once before");
    release();
    await vi.runAllTimersAsync();
  });

  it("waits until every listener is installed", async () => {
    const pending = deferred<UnlistenFn>();
    mocks.listen.mockImplementation(
      (name: string, handler: (event: { payload: never }) => void) => {
        mocks.handlers.set(name, handler);
        return name === "harness-stdout" ? pending.promise : Promise.resolve(vi.fn());
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

    const spawning = child.spawnChild("probe", "pi", ["--mode", "rpc"], "/repo");
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
    emit("harness-sse", { sessionId: "mine", data: "early-event" });

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

describe("remote spawnChild", () => {
  it("cleans command executable name for remote target", async () => {
    const { cleanRemoteCommand } = await loadChild();
    expect(cleanRemoteCommand("C:\\Users\\user\\AppData\\npm\\codex.cmd")).toBe("codex");
    expect(cleanRemoteCommand("/usr/bin/claude")).toBe("claude");
    expect(cleanRemoteCommand("agent.exe")).toBe("agent");
    expect(cleanRemoteCommand("my-agent.sh")).toBe("my-agent");
  });

  it("resolves remote SSH connection and passes it to harness_spawn", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const { usePreferencesStore } = await import("@/modules/settings/preferences");
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
    });

    release();
  });

  it("keeps the project helper session open for a remote agent and releases it when stopped", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const { usePreferencesStore } = await import("@/modules/settings/preferences");
    usePreferencesStore.setState({
      sshConnections: [
        { id: "p1", name: "Test Server", host: "192.168.1.4", user: "root", port: 22 },
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
      capabilities: ["proc.spawn"],
    });
    mocks.closeRemote.mockReset().mockResolvedValue(undefined);
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
    expect(mocks.invoke).toHaveBeenCalledWith(
      "harness_spawn",
      expect.objectContaining({
        remoteSessionId: 9,
        remoteRoot: "/workspace/project",
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
    const { usePreferencesStore } = await import("@/modules/settings/preferences");
    usePreferencesStore.setState({
      sshConnections: [
        { id: "p2", name: "Other", host: "192.168.1.5", user: "root", port: 22 },
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
      child.spawnChild("session-3", "codex", [], remotePath(environmentId, "/srv/p")),
    ).rejects.toThrow("codex is not installed");
    await Promise.resolve();
    expect(mocks.closeRemote).toHaveBeenCalledWith(11);
    release();
  });
});
