import type { RemoteMachine } from "@/modules/connections/model/protocol";
import {
  remoteSshConnectionFor,
  remoteSshConnectionForProfile,
  remoteSshEnvironmentId,
} from "@/modules/connections/model/remoteSshProfiles";
import {
  remotePath,
  type RemoteProject,
} from "@/modules/connections/model/remoteProjects";
import type { HarnessRemoteEnv } from "@/modules/harness/lib/harnessEnvStore";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import type { SshConnection } from "@/modules/ssh/types";
import { RemoteSessionPool } from "@/modules/remote/sessionPool";
import { describe, expect, it, vi } from "vitest";
import { createRemoteOpenCodeServiceManager } from "./remoteOpenCodeService";

function machine(): RemoteMachine {
  return {
    id: "machine-1",
    name: "Build host",
    endpoint: "ssh://dev@build-host",
    environmentId: "env-1",
    ssh: { target: "dev@build-host", port: 2222, remotePort: 3774 },
  };
}

function dependencies() {
  const serviceAction = vi.fn(
    async (_id: number, action: string): Promise<string> => {
      switch (action) {
        case "version":
          return "opencode 2.1.0";
        case "status":
          return "";
        case "start":
          return "http://127.0.0.1:4096";
        case "password":
          return "secret";
        default:
          return "";
      }
    },
  );
  const openWorkspace = vi.fn(async () => ({
    session_id: 7,
    architecture: "x86_64",
    workspace_root: "/srv/app",
    helper_version: "1.0.0",
    capabilities: ["opencode.service"],
  }));
  let tunnelId = 12;
  const openTunnel = vi.fn(async () => ({
    tunnelId: tunnelId++,
    localPort: 43123,
    remotePort: 4096,
  }));
  const closeWorkspace = vi.fn(async (_sessionId: number) => undefined);
  const sessions = new RemoteSessionPool({
    open: openWorkspace,
    close: closeWorkspace,
    schedule: () => () => {},
    idleMs: 30_000,
  });
  return {
    sessions,
    projectFor: vi.fn((_path: string): RemoteProject | undefined => undefined),
    projectEnv: vi.fn((_id: string): HarnessRemoteEnv => ({ kind: "local" })),
    closeTunnel: vi.fn(async (): Promise<void> => undefined),
    machineFor: vi.fn(
      async (_environmentId: string): Promise<RemoteMachine | undefined> =>
        machine(),
    ),
    sshConnections: vi.fn(() => [] as SshConnection[]),
    openWorkspace,
    openTunnel,
    serviceAction,
    closeWorkspace,
  };
}

const profile: SshConnection = {
  id: "profile-1",
  name: "Build host",
  host: "build-host",
  user: "dev",
};
const profileCwd = remotePath(remoteSshEnvironmentId(profile.id), "/srv/app");

describe("native remote OpenCode service", () => {
  it("owns a lease independently of project, PTY and file holders", async () => {
    const deps = dependencies();
    deps.sshConnections.mockReturnValue([profile]);
    const key = { profileId: profile.id, root: "/srv/app" };
    const project = await deps.sessions.acquire(
      key,
      remoteSshConnectionForProfile(profile),
    );
    const pty = await deps.sessions.acquire(
      key,
      remoteSshConnectionForProfile(profile),
    );
    const file = await deps.sessions.acquire(
      key,
      remoteSshConnectionForProfile(profile),
    );
    const manager = createRemoteOpenCodeServiceManager(deps);
    await manager.acquire("a", profileCwd);
    await manager.acquire("b", profileCwd);
    expect(deps.openWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.sessions.snapshot()[0].leases).toBe(4);
    await manager.release("a");
    expect(deps.closeTunnel).not.toHaveBeenCalled();
    await manager.release("b");
    await manager.release("b");
    expect(deps.closeTunnel).toHaveBeenCalledTimes(1);
    expect(deps.sessions.snapshot()[0].leases).toBe(3);
    expect(deps.closeWorkspace).not.toHaveBeenCalled();
    project.release();
    pty.release();
    file.release();
    await deps.sessions.closeAll();
  });

  it("closes only its tunnel on invalidation with a live sibling", async () => {
    const deps = dependencies();
    deps.sshConnections.mockReturnValue([profile]);
    const manager = createRemoteOpenCodeServiceManager(deps);
    await manager.acquire("a", profileCwd);
    await manager.acquire("b", profileCwd);
    await manager.invalidate("a");
    await manager.acquire("a", profileCwd);
    expect(deps.openWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.openTunnel).toHaveBeenCalledTimes(2);
    await manager.release("a");
    expect(deps.closeWorkspace).not.toHaveBeenCalled();
    expect(deps.closeTunnel).toHaveBeenCalledExactlyOnceWith(7, 13);
    await manager.release("b");
    expect(deps.closeWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.closeTunnel.mock.calls).toEqual([
      [7, 13],
      [7, 12],
    ]);
  });

  it("revalidates cached helper membership after native loss", async () => {
    const deps = dependencies();
    deps.sshConnections.mockReturnValue([profile]);
    let id = 7;
    deps.openWorkspace.mockImplementation(async () => ({
      session_id: id++,
      architecture: "x86_64",
      workspace_root: "/srv/app",
      helper_version: "1",
      capabilities: [],
    }));
    const manager = createRemoteOpenCodeServiceManager(deps);
    await manager.acquire("a", profileCwd);
    deps.sessions.invalidate({ profileId: profile.id, root: "/srv/app" }, 7);
    await expect(manager.acquire("a", profileCwd)).resolves.toMatchObject({
      sessionId: 8,
    });
    await manager.release("a");
    expect(deps.closeWorkspace.mock.calls.map(([sid]) => sid)).toEqual([7, 8]);
  });

  it("rejects changed native binding even for a cached service", async () => {
    const deps = dependencies();
    deps.sshConnections.mockReturnValue([profile]);
    const manager = createRemoteOpenCodeServiceManager(deps);
    await manager.acquire("a", profileCwd);
    deps.sshConnections.mockReturnValue([{ ...profile, host: "other-host" }]);
    await expect(manager.acquire("b", profileCwd)).rejects.toMatchObject({
      code: "REMOTE_SESSION_CONNECTION_CHANGED",
    });
    expect(deps.openWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.closeWorkspace).not.toHaveBeenCalled();
    await manager.release("a");
  });

  it("lets the pool reject a changed project binding before admitting a service lease", async () => {
    const deps = dependencies();
    const held = await deps.sessions.acquire(
      { profileId: profile.id, root: "/srv/app" },
      remoteSshConnectionForProfile(profile),
    );
    deps.sshConnections.mockReturnValue([{ ...profile, host: "changed-host" }]);
    const manager = createRemoteOpenCodeServiceManager(deps);
    await expect(manager.acquire("a", profileCwd)).rejects.toMatchObject({
      code: "REMOTE_SESSION_CONNECTION_CHANGED",
    });
    expect(deps.openWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.sessions.snapshot()[0].leases).toBe(1);
    expect(deps.closeWorkspace).not.toHaveBeenCalled();
    expect(deps.serviceAction).not.toHaveBeenCalled();
    held.release();
    await deps.sessions.closeAll();
  });

  it("never releases a newer pooled generation when retiring a stale cached service", async () => {
    const deps = dependencies();
    deps.sshConnections.mockReturnValue([profile]);
    let id = 7;
    deps.openWorkspace.mockImplementation(async () => ({
      session_id: id++,
      architecture: "x86_64",
      workspace_root: "/srv/app",
      helper_version: "1",
      capabilities: [],
    }));
    const manager = createRemoteOpenCodeServiceManager(deps);
    await manager.acquire("a", profileCwd);
    const key = { profileId: profile.id, root: "/srv/app" };
    deps.sessions.invalidate(key, 7);
    const updated = { ...profile, host: "changed-host" };
    deps.sshConnections.mockReturnValue([updated]);
    const newer = await deps.sessions.acquire(
      key,
      remoteSshConnectionForProfile(updated),
    );
    await expect(manager.acquire("a", profileCwd)).resolves.toMatchObject({
      sessionId: 8,
    });
    expect(deps.sessions.snapshot()[0].leases).toBe(2);
    await manager.release("a");
    expect(deps.sessions.snapshot()[0].leases).toBe(1);
    expect(deps.closeWorkspace.mock.calls.map(([sid]) => sid)).toEqual([7]);
    newer.release();
    await deps.sessions.closeAll();
  });

  it("holds its lease until the owned tunnel finishes closing", async () => {
    const deps = dependencies();
    deps.sshConnections.mockReturnValue([profile]);
    let finish!: () => void;
    let started!: () => void;
    const closingTunnel = new Promise<void>((resolve) => {
      started = resolve;
    });
    deps.closeTunnel.mockImplementationOnce(() => {
      started();
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const manager = createRemoteOpenCodeServiceManager(deps);
    await manager.acquire("a", profileCwd);
    const closing = manager.release("a");
    await closingTunnel;
    expect(deps.sessions.snapshot()[0].leases).toBe(1);
    expect(deps.closeWorkspace).not.toHaveBeenCalled();
    finish();
    await closing;
    expect(deps.closeWorkspace).toHaveBeenCalledTimes(1);
  });

  it("cleans a late cancelled acquisition without returning a closed service", async () => {
    const deps = dependencies();
    deps.sshConnections.mockReturnValue([profile]);
    let resolve!: (
      info: Awaited<ReturnType<typeof deps.openWorkspace>>,
    ) => void;
    deps.openWorkspace.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const manager = createRemoteOpenCodeServiceManager(deps);
    const acquiring = manager.acquire("a", profileCwd);
    const rejected = expect(acquiring).rejects.toThrow("closed");
    await Promise.resolve();
    const closing = manager.release("a");
    resolve({
      session_id: 7,
      architecture: "x86_64",
      workspace_root: "/srv/app",
      helper_version: "1",
      capabilities: [],
    });
    await rejected;
    await closing;
    expect(deps.serviceAction).not.toHaveBeenCalled();
    expect(deps.closeWorkspace).toHaveBeenCalledTimes(1);
  });
  it("leases the registered project root while the service uses its focus folder", async () => {
    const deps = dependencies();
    deps.sshConnections.mockReturnValue([profile]);
    deps.projectFor.mockReturnValue({
      key: profileCwd,
      environmentId: remoteSshEnvironmentId(profile.id),
      projectId: "project",
      cwd: "/srv/app",
    });
    const held = await deps.sessions.acquire(
      { profileId: profile.id, root: "/srv/app" },
      remoteSshConnectionForProfile(profile),
    );
    const manager = createRemoteOpenCodeServiceManager(deps);
    const service = await manager.acquire("a", `${profileCwd}/src`);
    expect(service?.directory).toBe("/srv/app/src");
    expect(deps.openWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.serviceAction).toHaveBeenCalledWith(
      7,
      "version",
      "/srv/app/src",
    );
    await manager.release("a");
    expect(deps.closeWorkspace).not.toHaveBeenCalled();
    held.release();
    await deps.sessions.closeAll();
  });

  it("accepts only the exact project-owned config when preferences are missing", async () => {
    const deps = dependencies();
    deps.machineFor.mockResolvedValue(undefined);
    deps.projectEnv.mockReturnValue({
      kind: "ssh",
      connection: Object.freeze({ ...profile }),
      root: "/srv/app",
      sessionId: 99,
    });
    const manager = createRemoteOpenCodeServiceManager(deps);
    await manager.acquire("a", profileCwd);
    expect(deps.projectEnv).toHaveBeenCalledWith(profileCwd);
    expect(deps.openWorkspace).toHaveBeenCalledWith(
      remoteSshConnectionForProfile(profile),
      "/srv/app",
    );
    expect(deps.sessions.snapshot()[0].sessionId).toBe(7);
    await manager.release("a");
    deps.projectEnv.mockReturnValue({
      kind: "ssh",
      connection: profile,
      root: "/srv/other",
      sessionId: 99,
    });
    await expect(manager.acquire("a", profileCwd)).rejects.toThrow(
      "saved SSH connection",
    );
    deps.projectEnv.mockReturnValue({
      kind: "ssh",
      connection: { ...profile, id: "other" },
      root: "/srv/app",
      sessionId: 99,
    });
    await expect(manager.acquire("a", profileCwd)).rejects.toThrow(
      "saved SSH connection",
    );
  });

  it("never resolves missing profiles from the ambient workspace", async () => {
    const deps = dependencies();
    const previous = useWorkspaceEnvStore.getState().env;
    useWorkspaceEnvStore.setState({
      env: {
        kind: "ssh",
        connection: profile,
        root: "/srv/app",
        sessionId: 55,
      },
    });
    try {
      const manager = createRemoteOpenCodeServiceManager(deps);
      await expect(manager.acquire("a", profileCwd)).rejects.toThrow(
        "saved SSH connection",
      );
      expect(deps.openWorkspace).not.toHaveBeenCalled();
    } finally {
      useWorkspaceEnvStore.setState({ env: previous });
    }
  });

  it("does not infer a native SSH transport from a legacy namespace", async () => {
    const deps = dependencies();
    deps.machineFor.mockResolvedValue({ ...machine(), ssh: undefined });
    const manager = createRemoteOpenCodeServiceManager(deps);
    await expect(
      manager.acquire("a", "remote://env-1/srv/app"),
    ).rejects.toThrow("no native SSH connection");
    expect(deps.openWorkspace).not.toHaveBeenCalled();
    await expect(manager.acquire("local", "/srv/app")).resolves.toBeUndefined();
  });

  it("releases a failed service lease exactly once without closing a project holder", async () => {
    const deps = dependencies();
    deps.sshConnections.mockReturnValue([profile]);
    const held = await deps.sessions.acquire(
      { profileId: profile.id, root: "/srv/app" },
      remoteSshConnectionForProfile(profile),
    );
    deps.openTunnel.mockRejectedValueOnce(new Error("tunnel failed"));
    const acquireLease = deps.sessions.acquire.bind(deps.sessions);
    const releases: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(deps.sessions, "acquire").mockImplementation(
      async (key, connection) => {
        const lease = await acquireLease(key, connection);
        const release = vi.fn(lease.release);
        releases.push(release);
        return { info: lease.info, release };
      },
    );
    const manager = createRemoteOpenCodeServiceManager(deps);
    await expect(manager.acquire("a", profileCwd)).rejects.toThrow(
      "tunnel failed",
    );
    await manager.release("a");
    expect(deps.sessions.snapshot()[0].leases).toBe(1);
    expect(deps.closeWorkspace).not.toHaveBeenCalled();
    await manager.acquire("a", profileCwd);
    await manager.release("a");
    expect(deps.sessions.snapshot()[0].leases).toBe(1);
    expect(releases).toHaveLength(2);
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
    held.release();
    await deps.sessions.closeAll();
  });

  it("does not swallow native helper loss during service status", async () => {
    const deps = dependencies();
    deps.sshConnections.mockReturnValue([profile]);
    deps.serviceAction.mockImplementation(async (_id, action) => {
      if (action === "version") return "opencode 2.1.0";
      throw new Error("remote session 7 not found");
    });
    const manager = createRemoteOpenCodeServiceManager(deps);
    await expect(manager.acquire("a", profileCwd)).rejects.toThrow(
      "remote session 7 not found",
    );
    expect(deps.sessions.snapshot()).toEqual([]);
    expect(deps.closeWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.serviceAction.mock.calls.map(([, action]) => action)).toEqual([
      "version",
      "status",
    ]);
  });

  it("cleans a late tunnel after cancellation without touching a replacement lease", async () => {
    const deps = dependencies();
    deps.sshConnections.mockReturnValue([profile]);
    let sessionId = 7;
    deps.openWorkspace.mockImplementation(async () => ({
      session_id: sessionId++,
      architecture: "x86_64",
      workspace_root: "/srv/app",
      helper_version: "1",
      capabilities: [],
    }));
    let finish!: (tunnel: Awaited<ReturnType<typeof deps.openTunnel>>) => void;
    let started!: () => void;
    const opening = new Promise<void>((resolve) => {
      started = resolve;
    });
    deps.openTunnel.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const manager = createRemoteOpenCodeServiceManager(deps);
    const acquiring = manager.acquire("a", profileCwd);
    const rejected = expect(acquiring).rejects.toThrow("closed");
    await opening;
    const closing = manager.release("a");
    const replacement = manager.acquire(
      "a",
      "remote://voktty-ssh-profile-1/srv/other",
    );
    finish({ tunnelId: 12, localPort: 43123, remotePort: 4096 });
    await rejected;
    await closing;
    await replacement;
    expect(deps.sessions.snapshot()[0].key.root).toBe("/srv/other");
    expect(deps.sessions.snapshot()[0].leases).toBe(1);
    await manager.release("a");
  });

  it("keeps a replacement owner attached after the old opening fails late", async () => {
    const deps = dependencies();
    deps.sshConnections.mockReturnValue([profile]);
    let sessionId = 7;
    deps.openWorkspace.mockImplementation(async () => ({
      session_id: sessionId++,
      architecture: "x86_64",
      workspace_root: "/srv/app",
      helper_version: "1",
      capabilities: [],
    }));
    const held = await deps.sessions.acquire(
      { profileId: profile.id, root: "/srv/app" },
      remoteSshConnectionForProfile(profile),
    );
    let fail!: (error: Error) => void;
    let started!: () => void;
    const opening = new Promise<void>((resolve) => {
      started = resolve;
    });
    deps.openTunnel.mockImplementationOnce(() => {
      started();
      return new Promise((_resolve, reject) => {
        fail = reject;
      });
    });
    const manager = createRemoteOpenCodeServiceManager(deps);
    const acquiring = manager.acquire("a", profileCwd);
    const rejected = expect(acquiring).rejects.toThrow("late tunnel failure");
    await opening;
    const closing = manager.release("a");
    await manager.acquire("a", "remote://voktty-ssh-profile-1/srv/other");
    fail(new Error("late tunnel failure"));
    await rejected;
    await closing;
    expect(deps.sessions.snapshot().map((entry) => entry.leases)).toEqual([
      1, 1,
    ]);
    expect(deps.closeWorkspace).not.toHaveBeenCalled();
    await manager.release("a");
    expect(deps.closeWorkspace).toHaveBeenCalledExactlyOnceWith(8);
    held.release();
    await deps.sessions.closeAll();
  });

  it("parses SSH targets and reuses matching saved SSH credentials", () => {
    const saved: SshConnection = {
      id: "profile-1",
      name: "Build host",
      host: "build-host",
      user: "dev",
      port: 2222,
      identityFile: "/keys/build",
      extraArgs: "-o ProxyJump=bastion",
      initialDirectory: "/srv/projects",
    };
    expect(remoteSshConnectionFor(machine(), [saved])).toEqual(
      remoteSshConnectionForProfile(saved),
    );
    expect(remoteSshConnectionForProfile(saved)).toEqual({
      host: "build-host",
      user: "dev",
      port: 2222,
      identityFile: "/keys/build",
      extraArgs: "-o ProxyJump=bastion",
      initialDirectory: "/srv/projects",
    });
    expect(
      remoteSshConnectionFor(
        {
          ...machine(),
          ssh: { target: "build-host", port: 2222, remotePort: 3774 },
        },
        [saved],
      ),
    ).toEqual(remoteSshConnectionForProfile(saved));
    expect(
      remoteSshConnectionFor(
        {
          ...machine(),
          ssh: { target: "dev@[2001:db8::3]", remotePort: 3774 },
        },
        [],
      ),
    ).toEqual({ host: "[2001:db8::3]", user: "dev", port: 22 });
    expect(() =>
      remoteSshConnectionFor(
        {
          ...machine(),
          ssh: { target: "-oProxyCommand=bad", remotePort: 3774 },
        },
        [],
      ),
    ).toThrow("invalid SSH target");
    expect(() =>
      remoteSshConnectionFor(
        {
          ...machine(),
          ssh: { target: "dev@build-host;touch", remotePort: 3774 },
        },
        [],
      ),
    ).toThrow("invalid SSH target");
  });

  it("opens a project directly from its saved native SSH profile", async () => {
    const deps = dependencies();
    const saved: SshConnection = {
      id: "profile-1",
      name: "Build host",
      host: "build-host",
      user: "dev",
      port: 2222,
      identityFile: "/keys/build",
      initialDirectory: "/srv/projects",
    };
    deps.sshConnections.mockReturnValue([saved]);
    deps.machineFor.mockResolvedValue(undefined);
    const manager = createRemoteOpenCodeServiceManager(deps);
    const cwd = remotePath(remoteSshEnvironmentId(saved.id), "/srv/app");

    await manager.acquire("session-a", cwd);

    expect(deps.machineFor).not.toHaveBeenCalled();
    expect(deps.openWorkspace).toHaveBeenCalledWith(
      remoteSshConnectionForProfile(saved),
      "/srv/app",
    );
    await manager.release("session-a");
  });

  it("does not fall back to a Host machine when a saved profile was removed", async () => {
    const deps = dependencies();
    const manager = createRemoteOpenCodeServiceManager(deps);
    const cwd = remotePath(
      remoteSshEnvironmentId("removed-profile"),
      "/srv/app",
    );

    await expect(manager.acquire("session-a", cwd)).rejects.toThrow(
      "saved SSH connection for this project is missing",
    );

    expect(deps.machineFor).not.toHaveBeenCalled();
  });

  it("opens an authenticated loopback tunnel and shares it between sessions", async () => {
    const deps = dependencies();
    const manager = createRemoteOpenCodeServiceManager(deps);
    const cwd = "remote://env-1/srv/app";

    const [first, second] = await Promise.all([
      manager.acquire("session-a", cwd),
      manager.acquire("session-b", cwd),
    ]);

    expect(first).toEqual({
      url: "http://127.0.0.1:43123",
      password: "secret",
      directory: "/srv/app",
      sessionId: 7,
    });
    expect(second).toEqual(first);
    expect(deps.openWorkspace).toHaveBeenCalledOnce();
    expect(deps.serviceAction.mock.calls.map(([, action]) => action)).toEqual([
      "version",
      "status",
      "start",
      "password",
    ]);
    expect(deps.openTunnel).toHaveBeenCalledOnce();

    await manager.release("session-a");
    expect(deps.closeWorkspace).not.toHaveBeenCalled();
    await manager.release("session-b");
    expect(deps.closeWorkspace).toHaveBeenCalledWith(7);
  });

  it("reopens an invalidated SSH helper without disrupting its other owners", async () => {
    const deps = dependencies();
    let sessionId = 7;
    deps.openWorkspace.mockImplementation(async () => ({
      session_id: sessionId++,
      architecture: "x86_64",
      workspace_root: "/srv/app",
      helper_version: "1.0.0",
      capabilities: ["opencode.service"],
    }));
    const manager = createRemoteOpenCodeServiceManager(deps);
    const cwd = "remote://env-1/srv/app";

    await manager.acquire("session-a", cwd);
    await manager.acquire("session-b", cwd);
    await manager.invalidate("session-a");

    expect(deps.closeWorkspace).not.toHaveBeenCalled();
    await expect(manager.acquire("session-a", cwd)).resolves.toMatchObject({
      sessionId: 8,
    });
    expect(deps.openWorkspace).toHaveBeenCalledTimes(2);
    expect(deps.openTunnel).toHaveBeenCalledTimes(2);

    await manager.release("session-a");
    await manager.release("session-b");
    expect(deps.closeWorkspace.mock.calls.map(([id]) => id)).toEqual([8, 7]);
  });

  it("keeps invalidation pending when opening the replacement SSH helper fails", async () => {
    const deps = dependencies();
    let sessionId = 7;
    deps.openWorkspace.mockImplementation(async () => ({
      session_id: sessionId++,
      architecture: "x86_64",
      workspace_root: "/srv/app",
      helper_version: "1.0.0",
      capabilities: ["opencode.service"],
    }));
    const manager = createRemoteOpenCodeServiceManager(deps);
    const cwd = "remote://env-1/srv/app";
    await manager.acquire("session-a", cwd);
    await manager.acquire("session-b", cwd);
    await manager.invalidate("session-a");

    deps.openWorkspace.mockRejectedValueOnce(new Error("SSH unavailable"));
    await expect(manager.acquire("session-a", cwd)).rejects.toThrow(
      "SSH unavailable",
    );
    await expect(manager.acquire("session-a", cwd)).resolves.toMatchObject({
      sessionId: 8,
    });
    expect(deps.openWorkspace).toHaveBeenCalledTimes(3);
    expect(deps.openTunnel).toHaveBeenCalledTimes(2);

    await manager.release("session-a");
    await manager.release("session-b");
  });

  it("checks service status again when start does not return its port", async () => {
    const deps = dependencies();
    let statusCount = 0;
    deps.serviceAction.mockImplementation(async (_id, action) => {
      if (action === "version") return "opencode 2.1.0";
      if (action === "status") {
        statusCount += 1;
        return statusCount === 1 ? "" : "http://127.0.0.1:4096";
      }
      if (action === "start") return "";
      return "secret";
    });
    const manager = createRemoteOpenCodeServiceManager(deps);

    await expect(
      manager.acquire("session-a", "remote://env-1/srv/app"),
    ).resolves.toMatchObject({ url: "http://127.0.0.1:43123" });
    expect(deps.serviceAction.mock.calls.map(([, action]) => action)).toEqual([
      "version",
      "status",
      "start",
      "status",
      "password",
    ]);
    await manager.release("session-a");
  });

  it("rejects unsupported remote OpenCode versions and closes the SSH session", async () => {
    const deps = dependencies();
    deps.serviceAction.mockImplementation(async (_id, action) =>
      action === "version" ? "opencode 1.15.0" : "",
    );
    const manager = createRemoteOpenCodeServiceManager(deps);

    await expect(
      manager.acquire("session-a", "remote://env-1/srv/app"),
    ).rejects.toThrow("require OpenCode 2.0.15 or newer");
    expect(deps.closeWorkspace).toHaveBeenCalledWith(7);
    expect(deps.openTunnel).not.toHaveBeenCalled();
  });

  it("rejects non-loopback service endpoints and closes the SSH session", async () => {
    const deps = dependencies();
    deps.serviceAction.mockImplementation(async (_id, action) => {
      if (action === "version") return "opencode 2.1.0";
      if (action === "status") return "http://192.168.1.8:4096";
      if (action === "start") return "http://192.168.1.8:4096";
      return "";
    });
    const manager = createRemoteOpenCodeServiceManager(deps);

    await expect(
      manager.acquire("session-a", "remote://env-1/srv/app"),
    ).rejects.toThrow("did not report its loopback service port");
    expect(deps.closeWorkspace).toHaveBeenCalledWith(7);
    expect(deps.openTunnel).not.toHaveBeenCalled();
  });

  it("rejects a ninth simultaneous remote workspace", async () => {
    const deps = dependencies();
    let id = 0;
    deps.machineFor.mockImplementation(async (environmentId) => ({
      ...machine(),
      id: `machine-${++id}`,
      environmentId,
    }));
    const manager = createRemoteOpenCodeServiceManager(deps, 1);
    await manager.acquire("session-a", "remote://env-1/srv/app");

    await expect(
      manager.acquire("session-b", "remote://env-2/srv/app"),
    ).rejects.toThrow("Close an unused remote OpenCode session");
    await manager.release("session-a");
  });
});
