import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceEnv } from "@/modules/workspace";

const requestRemoteResultMock = vi.hoisted(() => vi.fn());

vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  requestRemoteResult: requestRemoteResultMock,
}));

import { RemoteRequestError } from "./client";
import {
  isPathInWorkspace,
  remoteReadBinaryFile,
  remoteReadDocument,
  remoteRelativePath,
} from "./filesystem";

const env: Extract<WorkspaceEnv, { kind: "ssh" }> = {
  kind: "ssh",
  connection: {
    id: "ssh-1",
    name: "Server",
    host: "server.example",
  },
  root: "/srv/project",
  sessionId: 4,
};

describe("remote filesystem paths", () => {
  beforeEach(() => {
    requestRemoteResultMock.mockReset();
  });

  it("converts workspace paths to helper-relative paths", () => {
    expect(remoteRelativePath(env, "/srv/project")).toBe(".");
    expect(remoteRelativePath(env, "/srv/project/src/main.rs")).toBe(
      "src/main.rs",
    );
    expect(remoteRelativePath(env, "/srv/other/main.rs")).toBe(
      "/srv/other/main.rs",
    );
  });

  it("routes POSIX paths through the workspace backend", () => {
    const wsl: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };

    expect(isPathInWorkspace(wsl, "/home/serge/project")).toBe(true);
    expect(isPathInWorkspace(wsl, "C:/project")).toBe(false);
    expect(isPathInWorkspace(env, "/srv/other/main.rs")).toBe(true);
    expect(isPathInWorkspace(env, "C:/project")).toBe(false);
  });

  it("reads remote binary files without passing through UTF-8", async () => {
    requestRemoteResultMock.mockResolvedValue({
      contentBase64: "AP+A",
      size: 3,
      mtime: 123,
    });

    const result = await remoteReadBinaryFile(
      env,
      "/srv/project/assets/logo.png",
    );

    expect([...result.bytes]).toEqual([0, 255, 128]);
    expect(result.size).toBe(3);
    expect(result.mtime).toBe(123);
    expect(requestRemoteResultMock).toHaveBeenCalledWith(
      4,
      "fs.readBinaryFile",
      { path: "assets/logo.png" },
    );
  });

  it("classifies remote binary documents for the media preview", async () => {
    requestRemoteResultMock
      .mockRejectedValueOnce(
        new RemoteRequestError("binary_file", "file is not valid UTF-8"),
      )
      .mockResolvedValueOnce({ size: 3, mtime: 123, kind: "file" });

    await expect(
      remoteReadDocument(env, "/srv/project/assets/logo.png"),
    ).resolves.toEqual({ kind: "binary", size: 3 });
    expect(requestRemoteResultMock).toHaveBeenNthCalledWith(
      1,
      4,
      "fs.readFile",
      { path: "assets/logo.png" },
    );
    expect(requestRemoteResultMock).toHaveBeenNthCalledWith(
      2,
      4,
      "fs.stat",
      { path: "assets/logo.png" },
    );
  });

  it("classifies known media before attempting a bounded text read", async () => {
    requestRemoteResultMock.mockResolvedValueOnce({
      size: 12 * 1024 * 1024,
      mtime: 123,
      kind: "file",
    });

    await expect(
      remoteReadDocument(env, "/srv/project/assets/large.png", true),
    ).resolves.toEqual({ kind: "binary", size: 12 * 1024 * 1024 });
    expect(requestRemoteResultMock).toHaveBeenCalledOnce();
    expect(requestRemoteResultMock).toHaveBeenCalledWith(4, "fs.stat", {
      path: "assets/large.png",
    });
  });
});
