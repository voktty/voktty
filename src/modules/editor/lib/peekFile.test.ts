import { beforeEach, expect, it, vi } from "vitest";
import {
  readPeekFile,
  MAX_PEEK_FILE_BYTES,
} from "@/modules/editor/lib/peekFile";
import type { WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  stat: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/remote", () => ({
  isPathInRemoteWorkspace: (env: WorkspaceEnv) => env.kind === "ssh",
  remoteStat: io.stat,
  remoteReadFile: io.read,
}));

beforeEach(() => {
  vi.clearAllMocks();
  io.invoke.mockImplementation(async (command: string) =>
    command === "fs_stat"
      ? { kind: "file", size: 5, mtime: 1 }
      : { kind: "text", content: "hello", size: 5, mtime: 1 },
  );
  io.stat.mockResolvedValue({ kind: "file", size: 5, mtime: 1 });
  io.read.mockResolvedValue({ content: "hello", size: 5, mtime: 1 });
});

it("keeps an explicit WSL owner through both native stages", async () => {
  const workspace = { kind: "wsl", distro: "original" } as const;
  expect(await readPeekFile("/work/file.ts", workspace)).toEqual({
    status: "ready",
    content: "hello",
  });
  expect(io.invoke).toHaveBeenCalledWith("fs_stat", {
    path: "/work/file.ts",
    workspace,
  });
  expect(io.invoke).toHaveBeenCalledWith("fs_read_file", {
    path: "/work/file.ts",
    workspace,
    force: false,
  });
});

it("does not begin a read after retirement during stat", async () => {
  let current = true;
  io.invoke.mockImplementation(async () => {
    current = false;
    return { kind: "file", size: 5 };
  });
  await expect(
    readPeekFile("/work/file.ts", { kind: "local" }, () => current),
  ).rejects.toThrow();
  expect(io.invoke).toHaveBeenCalledOnce();
});

it("captures the SSH descriptor before its first asynchronous stage", async () => {
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    root: "/work",
    sessionId: 7,
    connection: { id: "a", name: "A", host: "host-a" },
  };
  io.stat.mockImplementation(async () => {
    workspace.connection.host = "host-b";
    workspace.sessionId = 8;
    return { kind: "file", size: 5 };
  });
  await readPeekFile("/work/file.ts", workspace);
  expect(io.read).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: 7,
      connection: expect.objectContaining({ host: "host-a" }),
    }),
    "/work/file.ts",
  );
  expect(io.invoke).not.toHaveBeenCalled();
});

it("rejects unresolved namespaces before any native IO", async () => {
  await expect(
    readPeekFile("remote://missing/work/file.ts", { kind: "local" }),
  ).rejects.toThrow();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("does not turn an unsupported Docker filesystem into local IO", async () => {
  await expect(
    readPeekFile("/work/file.ts", {
      kind: "docker",
      connection: { containerId: "a", containerName: "A", image: "image" },
    }),
  ).rejects.toThrow();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("checks the actual result size if a file grows after stat", async () => {
  io.invoke
    .mockResolvedValueOnce({ kind: "file", size: 5 })
    .mockResolvedValueOnce({
      kind: "text",
      size: MAX_PEEK_FILE_BYTES + 1,
      content: "oversize",
    });
  expect(await readPeekFile("/work/file.ts", { kind: "local" })).toEqual({
    status: "tooLarge",
  });
});

it("stops SSH content IO after retirement during metadata", async () => {
  let current = true;
  io.stat.mockImplementation(async () => {
    current = false;
    return { kind: "file", size: 5 };
  });
  await expect(
    readPeekFile(
      "/work/file.ts",
      {
        kind: "ssh",
        root: "/work",
        sessionId: 7,
        connection: { id: "a", name: "A", host: "host-a" },
      },
      () => current,
    ),
  ).rejects.toThrow("retired");
  expect(io.read).not.toHaveBeenCalled();
});

it.each(["C:\\work\\file.ts", "\\\\server\\share\\file.ts"])(
  "keeps native Windows ownership for %s while WSL is supplied",
  async (path) => {
    await readPeekFile(path, { kind: "wsl", distro: "fixture" });
    expect(io.invoke).toHaveBeenLastCalledWith("fs_read_file", {
      path,
      workspace: { kind: "local" },
      force: false,
    });
  },
);

it("retains pending reads in the quota after retirement", async () => {
  let finish!: (stat: { kind: string; size: number }) => void;
  io.invoke.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let current = true;
  const reads = Array.from({ length: 256 }, () =>
    readPeekFile("/work/file.ts", { kind: "local" }, () => current),
  );
  const outcomes = Promise.allSettled(reads);
  current = false;
  await expect(
    readPeekFile("/work/file.ts", { kind: "local" }),
  ).rejects.toThrow("capacity");
  expect(io.invoke).toHaveBeenCalledTimes(256);
  finish({ kind: "file", size: 5 });
  expect(
    (await outcomes).every((outcome) => outcome.status === "rejected"),
  ).toBe(true);
  io.invoke.mockResolvedValue({ kind: "directory", size: 0 });
  expect(await readPeekFile("/work/file.ts", { kind: "local" })).toEqual({
    status: "binary",
  });
});
