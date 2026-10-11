import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { killPty, spawnPty } from "./pty";

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

function fakePty(id: number) {
  return {
    id,
    close: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Harness remote terminals", () => {
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
    });
    mocks.closeRemoteWorkspace.mockResolvedValue(undefined);
    mocks.probeSshMultiplexer.mockResolvedValue({
      supported: true,
      sessions: [],
    });
    mocks.openPty.mockResolvedValue(fakePty(91));
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
        multiplexerMode: "auto",
        tmuxSessionName: "voktty-main",
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

  it("rejects remote paths outside a saved project instead of opening locally", async () => {
    mocks.remoteProjectForPath.mockReturnValue(undefined);

    await expect(
      spawnPty(
        "outside-project",
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
      expect.objectContaining({
        multiplexerMode: "auto",
        activeMultiplexerSession: "deploy",
        multiplexerAction: "attach_force",
      }),
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
});
