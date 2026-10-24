import { beforeEach, expect, it, vi } from "vitest";
import {
  toolkitStat,
  toolkitRead,
  toolkitWrite,
  toolkitCreateDir,
  toolkitReadDir,
} from "@/modules/statusbar/lib/toolkitFilesystem";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
const mocks = vi.hoisted(() => ({
  native: vi.fn(),
  stat: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  dir: vi.fn(),
  list: vi.fn(),
  nsStat: vi.fn(),
  nsRead: vi.fn(),
  nsWrite: vi.fn(),
  nsDir: vi.fn(),
  nsList: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.native }));
vi.mock("@/modules/remote/filesystem", () => ({
  remoteStat: mocks.stat,
  remoteReadFile: mocks.read,
  remoteWriteFile: mocks.write,
  remoteCreateDir: mocks.dir,
  remoteReadDir: mocks.list,
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  statFiles: mocks.nsStat,
  readTextFile: mocks.nsRead,
  writeTextFile: mocks.nsWrite,
  createPath: mocks.nsDir,
  invokeWorkspace: mocks.nsList,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.native.mockImplementation(async (command: string) =>
    command === "fs_read_file" ? { kind: "text", content: "native" } : [],
  );
  mocks.read.mockResolvedValue({ content: "ssh" });
  mocks.nsStat.mockResolvedValue([{ mtimeMs: 0 }]);
  mocks.nsRead.mockResolvedValue("namespace");
});
it.each([LOCAL_WORKSPACE, { kind: "wsl", distro: "Debian" }] as WorkspaceEnv[])(
  "preserves native filesystem $kind in every operation",
  async (workspace) => {
    const target = { path: "/project/file", workspace };
    await toolkitStat(target);
    expect(await toolkitRead(target)).toBe("native");
    await toolkitWrite(target, "content");
    await toolkitCreateDir(target);
    await toolkitReadDir(target);
    expect(
      mocks.native.mock.calls.map(([command, args]) => [
        command,
        args.workspace,
      ]),
    ).toEqual([
      ["fs_stat", workspace],
      ["fs_read_file", workspace],
      ["fs_write_file", workspace],
      ["fs_create_dir", workspace],
      ["fs_read_dir", workspace],
    ]);
  },
);
it("uses authenticated SSH adapters instead of native local paths", async () => {
  const workspace = {
    kind: "ssh" as const,
    connection: { id: "host", name: "Host", host: "example.test" },
    root: "/project",
    sessionId: 7,
  };
  const target = { path: "/project/file", workspace };
  await toolkitStat(target);
  expect(await toolkitRead(target)).toBe("ssh");
  await toolkitWrite(target, "content");
  await toolkitCreateDir(target);
  await toolkitReadDir(target);
  expect(mocks.stat).toHaveBeenCalledExactlyOnceWith(workspace, target.path);
  expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
    workspace,
    target.path,
    "content",
  );
  expect(mocks.dir).toHaveBeenCalledExactlyOnceWith(workspace, target.path);
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith(workspace, target.path);
  expect(mocks.native).not.toHaveBeenCalled();
});
it("routes namespace paths without treating them as native locations", async () => {
  const target = {
    path: "remote://host/project/.voktty",
    workspace: LOCAL_WORKSPACE,
  };
  await toolkitStat(target);
  expect(await toolkitRead(target)).toBe("namespace");
  await toolkitWrite(target, "content");
  await toolkitCreateDir(target);
  await toolkitReadDir(target);
  expect(mocks.nsStat).toHaveBeenCalledExactlyOnceWith([target.path]);
  expect(mocks.nsWrite).toHaveBeenCalledExactlyOnceWith(target.path, "content");
  expect(mocks.nsDir).toHaveBeenCalledExactlyOnceWith(
    "remote://host/project",
    ".voktty",
    true,
  );
  expect(mocks.nsList).toHaveBeenCalledExactlyOnceWith("list_dir", {
    path: target.path,
  });
  expect(mocks.native).not.toHaveBeenCalled();
});
it.each([
  { kind: "serial", portName: "COM1", baudRate: 9600 },
  {
    kind: "docker",
    connection: {
      containerId: "id",
      containerName: "Container",
      image: "test",
    },
  },
] as WorkspaceEnv[])(
  "refuses unsupported $kind filesystem without local fallback",
  async (workspace) => {
    const target = { path: "/project/file", workspace };
    await expect(toolkitStat(target)).rejects.toThrow();
    await expect(toolkitRead(target)).rejects.toThrow();
    await expect(toolkitWrite(target, "content")).rejects.toThrow();
    await expect(toolkitCreateDir(target)).rejects.toThrow();
    await expect(toolkitReadDir(target)).rejects.toThrow();
    expect(mocks.native).not.toHaveBeenCalled();
  },
);
it("rejects a retired write before or during lazy transport loading", async () => {
  const target = {
    path: "remote://host/project/file",
    workspace: LOCAL_WORKSPACE,
  };
  await expect(toolkitWrite(target, "content", () => false)).rejects.toThrow();
  let current = true;
  const pending = toolkitWrite(target, "content", () => current);
  current = false;
  await expect(pending).rejects.toThrow();
  expect(mocks.nsWrite).not.toHaveBeenCalled();
  expect(mocks.native).not.toHaveBeenCalled();
});
