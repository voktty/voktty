import { beforeEach, describe, expect, it, vi } from "vitest";
import { openPty } from "./pty-bridge";
import type { WorkspaceEnv } from "@/modules/workspace";

import {
  clearRemoteSessionAliases,
  recordRemoteSessionReplacement,
} from "@/modules/remote/sessionAliases";

const invokeMock = vi.hoisted(() => vi.fn());
const recoverMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class<T> {
    onmessage: (message: T) => void = () => {};
  },
}));

vi.mock("@/modules/remote/sessionManager", () => ({
  recoverLostRemoteSession: recoverMock,
}));

const sshEnv = (sessionId: number): WorkspaceEnv => ({
  kind: "ssh",
  root: "/srv/app",
  sessionId,
  connection: { id: "server-1", name: "Server", host: "server.example" },
});

describe("PTY bridge", () => {
  beforeEach(() => {
    clearRemoteSessionAliases();
    recoverMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "remote_pty_open") return Promise.resolve(91);
      if (command === "pty_open") return Promise.resolve(12);
      return Promise.resolve();
    });
  });

  it("uses the persistent remote session for SSH workspaces", async () => {
    const session = await openPty(
      120,
      40,
      { onData: vi.fn() },
      "/srv/app",
      true,
      undefined,
      undefined,
      {
        kind: "ssh",
        root: "/srv/app",
        sessionId: 7,
        connection: {
          id: "server-1",
          name: "Server",
          host: "server.example",
          user: "ubuntu",
        },
      },
    );

    expect(invokeMock).toHaveBeenCalledWith(
      "remote_pty_open",
      expect.objectContaining({
        sessionId: 7,
        cols: 120,
        rows: 40,
        cwd: "/srv/app",
        blocks: true,
      }),
    );

    await session.write("ls\r");
    const write = invokeMock.mock.calls.find(
      ([command]) => command === "remote_pty_write",
    );
    expect(write?.[2]).toEqual({
      headers: { "x-pty-id": "91", "x-remote-session-id": "7" },
    });
    expect(Array.from(write?.[1] as Uint8Array)).toEqual(
      Array.from(new TextEncoder().encode("ls\r")),
    );

    await session.resize(100, 30);
    expect(invokeMock).toHaveBeenCalledWith("remote_pty_resize", {
      sessionId: 7,
      ptyId: 91,
      cols: 100,
      rows: 30,
    });

    await session.close();
    expect(invokeMock).toHaveBeenCalledWith("remote_pty_close", {
      sessionId: 7,
      ptyId: 91,
    });
  });

  it("opens the shell on the session that replaced a stale id", async () => {
    recordRemoteSessionReplacement(7, 8);
    const session = await openPty(80, 24, { onData: vi.fn() }, undefined, false, undefined, undefined, sshEnv(7));
    expect(invokeMock).toHaveBeenCalledWith(
      "remote_pty_open",
      expect.objectContaining({ sessionId: 8 }),
    );
    await session.write("x");
    const write = invokeMock.mock.calls.find(([command]) => command === "remote_pty_write");
    expect(write?.[2]).toEqual({ headers: { "x-pty-id": "91", "x-remote-session-id": "8" } });
  });

  it("reopens a session whose SSH channel died and starts the shell there", async () => {
    invokeMock.mockImplementation((command: string, args: { sessionId?: number }) => {
      if (command === "remote_pty_open" && args.sessionId === 7)
        return Promise.reject(
          "remote helper closed the SSH channel: Se está cerrando la canalización. (os error 232)",
        );
      if (command === "remote_pty_open") return Promise.resolve(92);
      return Promise.resolve();
    });
    recoverMock.mockResolvedValue({ session_id: 9 });

    const session = await openPty(80, 24, { onData: vi.fn() }, undefined, false, undefined, undefined, sshEnv(7));

    expect(session.id).toBe(92);
    expect(recoverMock).toHaveBeenCalledWith(
      7,
      "server-1",
      expect.objectContaining({ host: "server.example" }),
      "/srv/app",
    );
    const opens = invokeMock.mock.calls.filter(([command]) => command === "remote_pty_open");
    expect(opens.map(([, args]) => args.sessionId)).toEqual([7, 9]);
    expect(opens[0][1].onData).not.toBe(opens[1][1].onData);
    await session.close();
    expect(invokeMock).toHaveBeenCalledWith("remote_pty_close", { sessionId: 9, ptyId: 92 });
  });

  it("reports the original failure when the host stays unreachable", async () => {
    invokeMock.mockImplementation((command: string) =>
      command === "remote_pty_open"
        ? Promise.reject("remote helper closed the SSH channel")
        : Promise.resolve(),
    );
    recoverMock.mockRejectedValue(new Error("host unreachable"));
    await expect(
      openPty(80, 24, { onData: vi.fn() }, undefined, false, undefined, undefined, sshEnv(7)),
    ).rejects.toBe("remote helper closed the SSH channel");
  });

  it("does not reopen the session for an unrelated failure", async () => {
    invokeMock.mockImplementation((command: string) =>
      command === "remote_pty_open" ? Promise.reject("permission denied") : Promise.resolve(),
    );
    await expect(
      openPty(80, 24, { onData: vi.fn() }, undefined, false, undefined, undefined, sshEnv(7)),
    ).rejects.toBe("permission denied");
    expect(recoverMock).not.toHaveBeenCalled();
  });

  it("keeps local workspaces on the native PTY transport", async () => {
    const session = await openPty(
      80,
      24,
      { onData: vi.fn() },
      undefined,
      false,
      undefined,
      undefined,
      { kind: "local" },
    );

    expect(session.id).toBe(12);
    expect(invokeMock).toHaveBeenCalledWith(
      "pty_open",
      expect.objectContaining({ cols: 80, rows: 24 }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "remote_pty_open",
      expect.anything(),
    );
  });

  it.each<WorkspaceEnv | undefined>([
    undefined,
    { kind: "local" },
    { kind: "wsl", distro: "Ubuntu" },
    {
      kind: "ssh",
      root: "/srv/app",
      sessionId: 7,
      connection: { id: "server-1", name: "Server", host: "server.example" },
    },
    {
      kind: "docker",
      connection: {
        containerId: "container-1",
        containerName: "api",
        image: "node:22",
      },
    },
    { kind: "serial", portName: "COM3", baudRate: 9600 },
  ])(
    "rejects an unresolved remote project URI before native resources open (%j)",
    async (workspace) => {
      await expect(
        openPty(
          80,
          24,
          { onData: vi.fn() },
          "remote://voktty-ssh-server-1/srv/app",
          false,
          undefined,
          undefined,
          workspace,
        ),
      ).rejects.toThrow(
        "Resolve the remote project connection before starting a terminal.",
      );
      expect(invokeMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    "C:/work/app",
    "C:\\work\\app",
    "//server/share/app",
    "\\\\server\\share\\app",
    "/srv/app",
  ])("preserves native directory paths (%s)", async (cwd) => {
    await openPty(
      80,
      24,
      { onData: vi.fn() },
      cwd,
      false,
      undefined,
      undefined,
      { kind: "local" },
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "pty_open",
      expect.objectContaining({ cwd, workspace: { kind: "local" } }),
    );
  });

  it("sends Docker using the flat Rust workspace variant", async () => {
    await openPty(90, 30, { onData: vi.fn() }, "/app", false, undefined, 44, {
      kind: "docker",
      connection: {
        containerId: "container-1",
        containerName: "api",
        image: "node:22",
        shell: "/bin/sh",
        workdir: "/app",
      },
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "pty_open",
      expect.objectContaining({
        cwd: "/app",
        workspace: {
          kind: "docker",
          containerId: "container-1",
          containerName: "api",
          image: "node:22",
          shell: "/bin/sh",
          workdir: "/app",
        },
      }),
    );
  });
});
