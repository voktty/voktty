import type { RemoteMachine } from "@/modules/connections/model/protocol";
import type { SshConnectionConfig } from "@/modules/workspace";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteOpenCodeServiceManager,
  remoteSshConnectionFor,
} from "./remoteOpenCodeService";

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
  const openTunnel = vi.fn(async () => ({
    tunnelId: 12,
    localPort: 43123,
    remotePort: 4096,
  }));
  const closeWorkspace = vi.fn(async () => undefined);
  return {
    machineFor: vi.fn(async (_environmentId: string) => machine()),
    sshConnections: vi.fn(() => [] as SshConnectionConfig[]),
    openWorkspace,
    openTunnel,
    serviceAction,
    closeWorkspace,
  };
}

describe("native remote OpenCode service", () => {
  it("parses SSH targets and reuses matching saved SSH credentials", () => {
    const saved: SshConnectionConfig = {
      host: "build-host",
      user: "dev",
      port: 2222,
      identityFile: "/keys/build",
      extraArgs: "-o ProxyJump=bastion",
    };
    expect(remoteSshConnectionFor(machine(), [saved])).toEqual(saved);
    expect(
      remoteSshConnectionFor(
        {
          ...machine(),
          ssh: { target: "build-host", port: 2222, remotePort: 3774 },
        },
        [saved],
      ),
    ).toEqual(saved);
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
