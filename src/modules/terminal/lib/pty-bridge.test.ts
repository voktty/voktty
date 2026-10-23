import { beforeEach, describe, expect, it, vi } from "vitest";
import { openPty } from "./pty-bridge";
import type { WorkspaceEnv } from "@/modules/workspace";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class<T> {
    onmessage: (message: T) => void = () => {};
  },
}));

describe("PTY bridge", () => {
  beforeEach(() => {
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
