import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeRemoteWorkspace,
  openRemoteWorkspace,
  requestRemote,
  type RemoteRequestError,
  requestRemoteResult,
} from "./client";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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
});
