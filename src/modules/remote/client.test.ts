import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeRemoteTunnel,
  closeRemoteWorkspace,
  openRemoteTunnel,
  openRemoteWorkspace,
  type RemoteRequestError,
  requestRemote,
  requestRemoteResult,
  runRemoteOpenCodeServiceAction,
} from "./client";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@/modules/ssh-native/handles", () => ({
  releaseNativeHandlesForRemoteSession: vi.fn().mockResolvedValue(undefined),
}));

describe("remote client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a remote workspace through the Tauri command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      session_id: 7,
      architecture: "x86_64",
      workspace_root: "/srv/app",
      helper_version: "1.0.0",
      capabilities: ["fs.readDir"],
    });

    await openRemoteWorkspace(
      { host: "server.example", user: "ubuntu" },
      "/srv/app",
    );

    expect(invoke).toHaveBeenCalledWith("remote_open", {
      connection: { host: "server.example", user: "ubuntu" },
      workspaceRoot: "/srv/app",
    });
  });

  it("keeps request and close operations scoped to a session", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await requestRemote(7, {
      protocol: 2,
      id: "2",
      method: "fs.readDir",
      params: { path: "." },
    });
    await closeRemoteWorkspace(7);

    expect(invoke).toHaveBeenNthCalledWith(1, "remote_request", {
      sessionId: 7,
      request: {
        protocol: 2,
        id: "2",
        method: "fs.readDir",
        params: { path: "." },
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "remote_close", { sessionId: 7 });
  });

  it("opens and closes a loopback tunnel through its remote session", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      tunnelId: 12,
      localPort: 43123,
      remotePort: 4096,
    });
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await expect(openRemoteTunnel(7, 4096)).resolves.toEqual({
      tunnelId: 12,
      localPort: 43123,
      remotePort: 4096,
    });
    await closeRemoteTunnel(7, 12);

    expect(invoke).toHaveBeenNthCalledWith(1, "remote_tunnel_open", {
      sessionId: 7,
      remotePort: 4096,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "remote_tunnel_close", {
      sessionId: 7,
      tunnelId: 12,
    });
  });

  it("preserves structured remote error codes", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      protocol: 2,
      id: "binary",
      ok: false,
      error: { code: "binary_file", message: "file is not valid UTF-8" },
    });

    const request = requestRemoteResult(7, "fs.readFile", {
      path: "image.jpg",
    });

    await expect(request).rejects.toMatchObject({
      name: "RemoteRequestError",
      code: "binary_file",
      message: "binary_file: file is not valid UTF-8",
    } satisfies Partial<RemoteRequestError>);
  });

  it("scopes OpenCode service actions to the authenticated workspace", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      protocol: 2,
      id: "voktty-1-1",
      ok: true,
      result: { stdout: "http://127.0.0.1:4096\n" },
    });

    await expect(
      runRemoteOpenCodeServiceAction(7, "status", "/srv/app"),
    ).resolves.toBe("http://127.0.0.1:4096\n");
    expect(invoke).toHaveBeenCalledWith("remote_request", {
      sessionId: 7,
      request: expect.objectContaining({
        protocol: 2,
        method: "opencode.service",
        params: { action: "status", cwd: "/srv/app" },
      }),
    });
  });

  it("reads the remote OpenCode version through a fixed service action", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      protocol: 2,
      id: "voktty-1-3",
      ok: true,
      result: { stdout: "opencode 2.0.15\n" },
    });

    await expect(
      runRemoteOpenCodeServiceAction(7, "version", "/srv/app"),
    ).resolves.toBe("opencode 2.0.15\n");
    expect(invoke).toHaveBeenCalledWith("remote_request", {
      sessionId: 7,
      request: expect.objectContaining({
        method: "opencode.service",
        params: { action: "version", cwd: "/srv/app" },
      }),
    });
  });

  it("rejects malformed OpenCode service output", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      protocol: 2,
      id: "voktty-1-2",
      ok: true,
      result: { stdout: [] },
    });

    await expect(
      runRemoteOpenCodeServiceAction(7, "password", "/srv/app"),
    ).rejects.toThrow("Remote OpenCode service returned invalid output");
  });
});
