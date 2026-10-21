import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeRemoteWorkspace: vi.fn(),
  openPty: vi.fn(),
  openRemoteWorkspace: vi.fn(),
  probeSshMultiplexer: vi.fn(),
  remoteProjectForPath: vi.fn(),
  sshConnections: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/modules/terminal/lib/pty-bridge", () => ({
  openPty: mocks.openPty,
}));
vi.mock("@/modules/remote/client", () => ({
  closeRemoteWorkspace: mocks.closeRemoteWorkspace,
  openRemoteWorkspace: mocks.openRemoteWorkspace,
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ sshConnections: mocks.sshConnections }),
  },
}));
vi.mock(
  "@/modules/connections/model/remoteProjects",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/modules/connections/model/remoteProjects")
      >();
    return {
      ...actual,
      remoteProjectForPath: mocks.remoteProjectForPath,
    };
  },
);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/modules/ssh/types", () => ({
  probeSshMultiplexer: mocks.probeSshMultiplexer,
}));

import { useWorkspaceEnvStore } from "@/modules/workspace";
import { remoteSessions } from "@/modules/remote/sessionManager";
import { remoteSshConnectionForProfile } from "@/modules/connections/model/remoteSshProfiles";
import type {
  PtyHandlers,
  PtySession,
} from "@/modules/terminal/lib/pty-bridge";
import type { RemoteSessionInfo } from "@/modules/remote/client";
import { RemoteSessionConnectionChangedError } from "@/modules/remote/sessionPool";
import { openSshProfileInHarness } from "@/modules/connections/model/sshConnectionActions";
import {
  useHarnessEnvStore,
  useHarnessProjectEnvStore,
} from "./harnessEnvStore";
import { killAllPtys, killPty, spawnPty, subscribePty, writePty } from "./pty";

const projectPath = "remote://voktty-ssh-profile-1/srv/app";
const profile = {
  id: "profile-1",
  name: "Build host",
  host: "build-host",
  user: "dev",
  port: 2222,
  identityFile: "/keys/build",
  extraArgs: "-o ProxyJump=bastion",
  multiplexerMode: "auto" as const,
  tmuxSessionName: "voktty-main",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakePty(id: number) {
  return {
    id,
    close: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Harness remote terminals", () => {
  afterEach(async () => {
    await killAllPtys();
    await useHarnessProjectEnvStore.getState().disconnectAll();
    await remoteSessions.closeAll();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sshConnections = [profile];
    mocks.remoteProjectForPath.mockReturnValue({
      environmentId: "voktty-ssh-profile-1",
      cwd: "/srv/app",
    });
    mocks.openRemoteWorkspace.mockResolvedValue({
      session_id: 71,
      workspace_root: "/srv/app",
      architecture: "x86_64",
      helper_version: "test",
      capabilities: [],
    } satisfies RemoteSessionInfo);
    mocks.closeRemoteWorkspace.mockResolvedValue(undefined);
    mocks.probeSshMultiplexer.mockResolvedValue({
      supported: true,
      sessions: [],
    });
    mocks.openPty.mockResolvedValue(fakePty(91));
    useWorkspaceEnvStore.setState({ env: { kind: "local" } });
    useHarnessEnvStore.setState({
      env: { kind: "local" },
      connecting: false,
      error: null,
    });
  });

  it("opens the Harness PTY through the saved profile's native SSH helper", async () => {
    await spawnPty("remote-terminal", projectPath, 100, 32);

    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      {
        host: "build-host",
        user: "dev",
        port: 2222,
        identityFile: "/keys/build",
        extraArgs: "-o ProxyJump=bastion",
      },
      "/srv/app",
    );
    expect(mocks.openPty).toHaveBeenCalledWith(
      100,
      32,
      expect.objectContaining({ onData: expect.any(Function) }),
      "/srv/app",
      false,
      undefined,
      undefined,
      {
        kind: "ssh",
        connection: profile,
        root: "/srv/app",
        sessionId: 71,
      },
    );

    await killPty("remote-terminal");
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(71);
  });

  it("never borrows the global active SSH session without its own lease", async () => {
    useWorkspaceEnvStore.setState({
      env: {
        kind: "ssh",
        connection: profile,
        root: "/srv/app",
        sessionId: 42,
      },
    });

    await spawnPty("active-ssh-terminal", projectPath, 100, 32);

    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ host: "build-host" }),
      "/srv/app",
    );
    expect(mocks.openPty).toHaveBeenCalledWith(
      100,
      32,
      expect.objectContaining({ onData: expect.any(Function) }),
      "/srv/app",
      false,
      undefined,
      undefined,
      {
        kind: "ssh",
        connection: profile,
        root: "/srv/app",
        sessionId: 71,
      },
    );

    await killPty("active-ssh-terminal");
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(71);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalledWith(42);
  });

  it("allows ad-hoc remote paths not registered in saved projects", async () => {
    mocks.remoteProjectForPath.mockReturnValue(undefined);

    await spawnPty(
      "adhoc-remote",
      "remote://voktty-ssh-profile-1/workspace/pepe",
      80,
      24,
    );

    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ host: "build-host" }),
      "/workspace/pepe",
    );
    expect(mocks.openPty).toHaveBeenCalledWith(
      80,
      24,
      expect.anything(),
      "/workspace/pepe",
      false,
      undefined,
      undefined,
      expect.objectContaining({
        kind: "ssh",
        sessionId: 71,
      }),
    );
  });

  it("rejects remote paths with conflicting project environment", async () => {
    mocks.remoteProjectForPath.mockReturnValue({
      environmentId: "different-env-id",
      cwd: "/srv/other",
    });

    await expect(
      spawnPty(
        "conflicting-project",
        "remote://voktty-ssh-profile-1/srv/other",
        80,
        24,
      ),
    ).rejects.toThrow("outside a saved project");

    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
    expect(mocks.openPty).not.toHaveBeenCalled();
  });

  it("rejects malformed remote paths instead of opening them locally", async () => {
    await expect(
      spawnPty("malformed-remote", "remote://voktty-ssh-profile-1", 80, 24),
    ).rejects.toThrow("Remote terminal path is invalid");

    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
    expect(mocks.openPty).not.toHaveBeenCalled();
  });

  it("rejects a missing saved SSH profile without opening a local PTY", async () => {
    mocks.sshConnections = [];

    await expect(
      spawnPty("missing-profile", projectPath, 80, 24),
    ).rejects.toThrow("saved SSH connection for this project is missing");

    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
    expect(mocks.openPty).not.toHaveBeenCalled();
  });

  it("closes the authenticated helper session when PTY startup fails", async () => {
    mocks.openPty.mockRejectedValueOnce(new Error("PTY unavailable"));

    await expect(
      spawnPty("startup-failure", projectPath, 80, 24),
    ).rejects.toThrow("PTY unavailable");
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(71);
  });

  it("passes a chosen tmux session through the native helper to the remote PTY", async () => {
    const probe = {
      supported: true,
      sessions: [
        {
          name: "build",
          windowsCount: 1,
          attachedCount: 0,
          isAttached: false,
          multiplexer: "tmux",
        },
        {
          name: "deploy",
          windowsCount: 2,
          attachedCount: 1,
          isAttached: true,
          multiplexer: "tmux",
        },
      ],
    };
    mocks.probeSshMultiplexer.mockResolvedValueOnce(probe);
    const multiplexerPicker = vi
      .fn()
      .mockResolvedValue({ action: "attach_force", sessionName: "deploy" });

    await spawnPty("picked-terminal", projectPath, 80, 24, {
      multiplexerPicker,
    });

    expect(multiplexerPicker).toHaveBeenCalledWith(profile, probe);
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      {
        host: "build-host",
        user: "dev",
        port: 2222,
        identityFile: "/keys/build",
        extraArgs: "-o ProxyJump=bastion",
      },
      "/srv/app",
    );
    expect(mocks.openPty).toHaveBeenCalledWith(
      80,
      24,
      expect.anything(),
      "/srv/app",
      false,
      undefined,
      undefined,
      expect.objectContaining({
        kind: "ssh",
        connection: expect.objectContaining({
          activeMultiplexerSession: "deploy",
          multiplexerAction: "attach_force",
        }),
        sessionId: 71,
      }),
    );

    await killPty("picked-terminal");
  });

  it("does not open a remote session when the tmux picker is canceled", async () => {
    mocks.probeSshMultiplexer.mockResolvedValueOnce({
      supported: true,
      sessions: [
        {
          name: "build",
          windowsCount: 1,
          attachedCount: 0,
          isAttached: false,
          multiplexer: "tmux",
        },
        {
          name: "deploy",
          windowsCount: 1,
          attachedCount: 1,
          isAttached: true,
          multiplexer: "tmux",
        },
      ],
    });

    await expect(
      spawnPty("canceled-terminal", projectPath, 80, 24, {
        multiplexerPicker: vi.fn().mockResolvedValue(null),
      }),
    ).rejects.toThrow("SSH terminal connection was canceled");
    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
    expect(mocks.openPty).not.toHaveBeenCalled();
  });

  it("closes the helper session when the remote process exits", async () => {
    const pty = fakePty(91);
    mocks.openPty.mockResolvedValueOnce(pty);

    await spawnPty("remote-exit", projectPath, 80, 24);
    const handlers = mocks.openPty.mock.calls[0]?.[2] as {
      onExit: (code: number) => void;
    };
    handlers.onExit(0);
    await vi.waitFor(() => {
      expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(71);
    });
  });

  it("shares the actual project holder and preserves project and other consumers on PTY close", async () => {
    await useHarnessProjectEnvStore
      .getState()
      .connect(profile, "/srv/app", projectPath);
    const other = await remoteSessions.acquire(
      { profileId: profile.id, root: "/srv/app" },
      remoteSshConnectionForProfile(profile),
    );
    await spawnPty("shared-project", `${projectPath}/src`, 80, 24);

    expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
    expect(remoteSessions.snapshot()[0]?.leases).toBe(3);
    expect(mocks.openPty.mock.calls[0]?.[3]).toBe("/srv/app/src");
    expect(mocks.openPty.mock.calls[0]?.[7]).toMatchObject({
      root: "/srv/app",
      sessionId: 71,
    });

    await killPty("shared-project");
    expect(remoteSessions.snapshot()[0]?.leases).toBe(2);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    expect(
      useHarnessProjectEnvStore.getState().projects[projectPath]?.env,
    ).toMatchObject({ sessionId: 71 });

    await useHarnessProjectEnvStore.getState().disconnect(projectPath);
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    other.release();
  });

  it("retains a busy PTY's own lease after the project owner is released", async () => {
    await useHarnessProjectEnvStore
      .getState()
      .connect(profile, "/srv/app", projectPath);
    const pty = fakePty(91);
    mocks.openPty.mockResolvedValueOnce(pty);
    await spawnPty("busy-project", projectPath, 80, 24);

    await useHarnessProjectEnvStore.getState().disconnect(projectPath);
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    await writePty("busy-project", "still running\r");
    expect(pty.write).toHaveBeenCalledWith("still running\r");

    await killPty("busy-project");
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledExactlyOnceWith(71);
  });

  it("does not borrow a selected Harness environment with the same host but another profile/root", async () => {
    useHarnessEnvStore.setState({
      env: {
        kind: "ssh",
        connection: { ...profile, id: "other-profile", user: "other-user" },
        root: "/",
        sessionId: 42,
      },
    });
    await spawnPty("explicit-project", `${projectPath}/src`, 80, 24);
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ user: "dev" }),
      "/srv/app",
    );
    expect(mocks.openPty.mock.calls[0]?.[7]).toMatchObject({
      root: "/srv/app",
      sessionId: 71,
    });
    await killPty("explicit-project");
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalledWith(42);
  });

  it("opens a PTY from an arbitrary unsaved profile registered by openSshProfileInHarness without borrowing its native ID", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class extends Event {
        constructor(
          type: string,
          public detail: unknown,
        ) {
          super(type);
        }
      },
    );
    mocks.sshConnections = [];
    const ownedPath = await openSshProfileInHarness(profile);
    expect(ownedPath).toBe(projectPath);
    mocks.openRemoteWorkspace.mockResolvedValueOnce({
      session_id: 72,
      workspace_root: "/srv/app",
      architecture: "x86_64",
      helper_version: "test",
      capabilities: [],
    });
    await spawnPty("unsaved-api-project", `${ownedPath}/src`, 80, 24);
    expect(mocks.openRemoteWorkspace).toHaveBeenNthCalledWith(
      1,
      remoteSshConnectionForProfile(profile),
      ".",
    );
    expect(mocks.openRemoteWorkspace).toHaveBeenNthCalledWith(
      2,
      remoteSshConnectionForProfile(profile),
      "/srv/app",
    );
    expect(mocks.openPty.mock.calls[0]?.[7]).toMatchObject({
      sessionId: 72,
      root: "/srv/app",
      connection: profile,
    });
    expect(remoteSessions.snapshot().map((entry) => entry.leases)).toEqual([
      1, 1,
    ]);
    await killPty("unsaved-api-project");
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledExactlyOnceWith(72);
    expect(remoteSessions.snapshot()[0]?.sessionId).toBe(71);
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
  });

  it.each(["voktty-ssh-profile-1", "build-host"])(
    "uses only the configuration of the exact owned project for an unsaved profile: %s",
    async (environmentId) => {
      const ownedPath = `remote://${environmentId}/srv/app`;
      mocks.remoteProjectForPath.mockReturnValue({
        environmentId,
        cwd: "/srv/app",
      });
      await useHarnessProjectEnvStore
        .getState()
        .connect(profile, "/srv/app", ownedPath);
      mocks.sshConnections = [];
      const other = await remoteSessions.acquire(
        { profileId: profile.id, root: "/srv/app" },
        remoteSshConnectionForProfile(profile),
      );
      await spawnPty("unsaved-project", `${ownedPath}/src`, 80, 24);
      expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
      expect(remoteSessions.snapshot()[0]?.leases).toBe(3);
      expect(mocks.openPty.mock.calls[0]?.[7]).toMatchObject({
        connection: profile,
        root: "/srv/app",
        sessionId: 71,
      });
      await killPty("unsaved-project");
      expect(remoteSessions.snapshot()[0]?.leases).toBe(2);
      expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
      await useHarnessProjectEnvStore.getState().disconnect(ownedPath);
      expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
      other.release();
    },
  );

  it("prefers changed saved configuration and rejects its binding instead of using old project configuration", async () => {
    await useHarnessProjectEnvStore
      .getState()
      .connect(profile, "/srv/app", projectPath);
    mocks.sshConnections = [{ ...profile, host: "changed-host" }];
    await expect(
      spawnPty("changed-saved", projectPath, 80, 24),
    ).rejects.toBeInstanceOf(RemoteSessionConnectionChangedError);
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.openPty).not.toHaveBeenCalled();
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  });

  it("does not adopt an ownerless selected environment for an unsaved profile", async () => {
    mocks.sshConnections = [];
    useHarnessProjectEnvStore.getState().setEnv({
      kind: "ssh",
      connection: profile,
      root: "/srv/app",
      sessionId: 42,
    });
    await expect(
      spawnPty("ownerless-profile", projectPath, 80, 24),
    ).rejects.toThrow("saved SSH connection for this project is missing");
    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
    expect(mocks.openPty).not.toHaveBeenCalled();
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  });

  it("rejects an owned record whose actual root differs from the registered project root", async () => {
    mocks.openRemoteWorkspace.mockResolvedValueOnce({
      session_id: 71,
      workspace_root: "/srv/other",
      architecture: "x86_64",
      helper_version: "test",
      capabilities: [],
    });
    await useHarnessProjectEnvStore
      .getState()
      .connect(profile, "/srv/app", projectPath);
    mocks.sshConnections = [];
    await expect(
      spawnPty("wrong-owned-root", projectPath, 80, 24),
    ).rejects.toThrow("saved SSH connection for this project is missing");
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.openPty).not.toHaveBeenCalled();
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  });

  it("does not search an ancestor project for an unsaved profile", async () => {
    mocks.openRemoteWorkspace.mockResolvedValueOnce({
      session_id: 71,
      workspace_root: "/srv",
      architecture: "x86_64",
      helper_version: "test",
      capabilities: [],
    });
    await useHarnessProjectEnvStore
      .getState()
      .connect(profile, "/srv", "remote://voktty-ssh-profile-1/srv");
    mocks.sshConnections = [];
    await expect(
      spawnPty("ancestor-profile", projectPath, 80, 24),
    ).rejects.toThrow("saved SSH connection for this project is missing");
    expect(mocks.openPty).not.toHaveBeenCalled();
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  });

  it("rejects a project-owned connection belonging to another encoded profile ID", async () => {
    await useHarnessProjectEnvStore
      .getState()
      .connect({ ...profile, id: "other-profile" }, "/srv/app", projectPath);
    mocks.sshConnections = [];
    await expect(
      spawnPty("wrong-owned-profile", projectPath, 80, 24),
    ).rejects.toThrow("saved SSH connection for this project is missing");
    expect(mocks.openPty).not.toHaveBeenCalled();
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  });

  it("does not infer SSH from an unknown namespace even when an owned record exists", async () => {
    const unknownPath = "remote://unknown-transport/srv/app";
    await useHarnessProjectEnvStore
      .getState()
      .connect(profile, "/srv/app", unknownPath);
    mocks.remoteProjectForPath.mockReturnValue({
      environmentId: "unknown-transport",
      cwd: "/srv/app",
    });
    mocks.sshConnections = [];
    await expect(
      spawnPty("unknown-owned-transport", unknownPath, 80, 24),
    ).rejects.toThrow("saved SSH connection for this project is missing");
    expect(mocks.openPty).not.toHaveBeenCalled();
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  });

  it("does not resolve a missing saved profile from the global active connection", async () => {
    mocks.sshConnections = [];
    useWorkspaceEnvStore.setState({
      env: {
        kind: "ssh",
        connection: profile,
        root: "/srv/app",
        sessionId: 42,
      },
    });
    await expect(
      spawnPty("missing-saved", projectPath, 80, 24),
    ).rejects.toThrow("saved SSH connection for this project is missing");
    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
    expect(mocks.openPty).not.toHaveBeenCalled();
  });

  it("preserves legacy SSH namespace resolution and rejects unknown transports", async () => {
    mocks.remoteProjectForPath.mockReturnValue(undefined);
    await spawnPty("legacy-ssh", "remote://build-host/srv/app", 80, 24);
    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ host: "build-host" }),
      "/srv/app",
    );
    await expect(
      spawnPty(
        "unknown-transport",
        "remote://machine-without-ssh/srv/app",
        80,
        24,
      ),
    ).rejects.toThrow("saved SSH connection for this project is missing");
    expect(mocks.openPty).toHaveBeenCalledTimes(1);
  });

  it("releases only the failed PTY lease when its helper is shared with a project", async () => {
    await useHarnessProjectEnvStore
      .getState()
      .connect(profile, "/srv/app", projectPath);
    mocks.openPty.mockRejectedValueOnce(new Error("PTY unavailable"));
    await expect(
      spawnPty("shared-failure", projectPath, 80, 24),
    ).rejects.toThrow("PTY unavailable");
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  });

  it("releases the PTY lease exactly once across exit and repeated disposal", async () => {
    const acquire = remoteSessions.acquire.bind(remoteSessions);
    const release = vi.fn();
    vi.spyOn(remoteSessions, "acquire").mockImplementation(
      async (key, connection) => {
        const lease = await acquire(key, connection);
        return {
          info: lease.info,
          release: () => {
            release();
            lease.release();
          },
        };
      },
    );
    await spawnPty("exit-and-close", projectPath, 80, 24);
    const handlers = mocks.openPty.mock.calls[0]?.[2] as PtyHandlers;
    handlers.onExit?.(0);
    await killPty("exit-and-close");
    handlers.onExit?.(0);
    await killPty("exit-and-close");
    expect(release).toHaveBeenCalledTimes(1);
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledExactlyOnceWith(71);
  });

  it("cleans up an exit delivered before the native PTY ID resolves", async () => {
    const pty = fakePty(91);
    mocks.openPty.mockImplementationOnce(
      async (_cols, _rows, handlers: PtyHandlers) => {
        handlers.onExit?.(0);
        return pty;
      },
    );
    await spawnPty("early-exit", projectPath, 80, 24);
    await killPty("early-exit");
    expect(pty.close).toHaveBeenCalledTimes(1);
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledExactlyOnceWith(71);
  });

  it("releases a helper that finishes opening after PTY disposal without opening a PTY", async () => {
    const pending = deferred<RemoteSessionInfo>();
    mocks.openRemoteWorkspace.mockReturnValueOnce(pending.promise);
    const opening = spawnPty("late-helper", projectPath, 80, 24);
    await vi.waitFor(() =>
      expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(1),
    );
    await killPty("late-helper");
    pending.resolve({
      session_id: 71,
      workspace_root: "/srv/app",
      architecture: "x86_64",
      helper_version: "test",
      capabilities: [],
    });
    await opening;
    expect(mocks.openPty).not.toHaveBeenCalled();
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledExactlyOnceWith(71);
  });

  it("keeps the lease until a late native PTY is closed after disposal", async () => {
    const pending = deferred<PtySession>();
    const pty = fakePty(91);
    mocks.openPty.mockReturnValueOnce(pending.promise);
    const opening = spawnPty("late-pty", projectPath, 80, 24);
    await vi.waitFor(() => expect(mocks.openPty).toHaveBeenCalledTimes(1));
    await killPty("late-pty");
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    pending.resolve(pty);
    await opening;
    expect(pty.close).toHaveBeenCalledTimes(1);
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledExactlyOnceWith(71);
  });

  it("holds the lease until native PTY close settles", async () => {
    const pendingClose = deferred<void>();
    const pty = fakePty(91);
    pty.close.mockReturnValueOnce(pendingClose.promise);
    mocks.openPty.mockResolvedValueOnce(pty);
    await spawnPty("closing-pty", projectPath, 80, 24);
    const closing = killPty("closing-pty");
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    pendingClose.resolve();
    await closing;
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledExactlyOnceWith(71);
  });

  it("cleans failed late PTY creation without releasing a sibling project's lease", async () => {
    await useHarnessProjectEnvStore
      .getState()
      .connect(profile, "/srv/app", projectPath);
    const pending = deferred<PtySession>();
    mocks.openPty.mockReturnValueOnce(pending.promise);
    const opening = spawnPty("late-failure", projectPath, 80, 24);
    const failed = expect(opening).rejects.toThrow("late PTY failure");
    await vi.waitFor(() => expect(mocks.openPty).toHaveBeenCalledTimes(1));
    await killPty("late-failure");
    pending.reject(new Error("late PTY failure"));
    await failed;
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
  });

  it("closes a replaced late PTY without overwriting the replacement or replaying stale output", async () => {
    const pending = deferred<PtySession>();
    const oldPty = fakePty(91);
    const replacement = fakePty(92);
    mocks.openPty
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(replacement);
    const opening = spawnPty("replaced-pty", projectPath, 80, 24);
    await vi.waitFor(() => expect(mocks.openPty).toHaveBeenCalledTimes(1));
    const oldHandlers = mocks.openPty.mock.calls[0]?.[2] as PtyHandlers;
    await spawnPty("replaced-pty", projectPath, 80, 24);
    oldHandlers.onData(new Uint8Array([1]));
    const onData = vi.fn();
    const onExit = vi.fn();
    subscribePty("replaced-pty", onData, onExit);
    oldHandlers.onExit?.(1);
    pending.resolve(oldPty);
    await opening;
    expect(oldPty.close).toHaveBeenCalledTimes(1);
    expect(replacement.close).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
    expect(remoteSessions.snapshot()[0]?.leases).toBe(1);
    await writePty("replaced-pty", "replacement\r");
    expect(replacement.write).toHaveBeenCalledWith("replacement\r");
    await killPty("replaced-pty");
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledExactlyOnceWith(71);
  });

  it("invalidates pending opens when all PTYs are disposed", async () => {
    const pending = deferred<PtySession>();
    const pty = fakePty(91);
    mocks.openPty.mockReturnValueOnce(pending.promise);
    const opening = spawnPty("late-kill-all", projectPath, 80, 24);
    await vi.waitFor(() => expect(mocks.openPty).toHaveBeenCalledTimes(1));
    await killAllPtys();
    pending.resolve(pty);
    await opening;
    expect(pty.close).toHaveBeenCalledTimes(1);
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledExactlyOnceWith(71);
  });

  it("does not reuse active SSH session when target path is outside session root", async () => {
    mocks.remoteProjectForPath.mockReturnValue(undefined);
    useWorkspaceEnvStore.setState({
      env: {
        kind: "ssh",
        connection: profile,
        root: "/root",
        sessionId: 42,
      },
    });

    await spawnPty(
      "adhoc-outside-root",
      "remote://voktty-ssh-profile-1/workspace/pepe",
      80,
      24,
    );

    expect(mocks.openRemoteWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ host: "build-host" }),
      "/workspace/pepe",
    );
    expect(mocks.openPty).toHaveBeenCalledWith(
      80,
      24,
      expect.anything(),
      "/workspace/pepe",
      false,
      undefined,
      undefined,
      expect.objectContaining({
        kind: "ssh",
        sessionId: 71,
      }),
    );
  });
});
