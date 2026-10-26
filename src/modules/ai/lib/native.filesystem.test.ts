import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  current: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  canonicalize: vi.fn(),
  directory: vi.fn(),
  create: vi.fn(),
  stat: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/workspace")>()),
  currentWorkspaceEnv: io.current,
}));
vi.mock("@/modules/remote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/remote")>()),
  remoteReadFile: io.read,
  remoteWriteFile: io.write,
  remoteCanonicalize: io.canonicalize,
  remoteReadDir: io.directory,
  remoteCreateDir: io.create,
  remoteStat: io.stat,
  remoteDelete: io.remove,
}));
import { native } from "@/modules/ai/lib/native";

const local: WorkspaceEnv = { kind: "local" };
const wsl: WorkspaceEnv = { kind: "wsl", distro: "fixture" };
const ssh: WorkspaceEnv = {
  kind: "ssh",
  connection: { id: "fixture", name: "Fixture", host: "fixture.invalid" },
  root: "/work",
  sessionId: 7,
};
const path = "/work/file.ts";
beforeEach(() => {
  vi.resetAllMocks();
  io.current.mockReturnValue(ssh);
  io.read.mockResolvedValue({ content: "fixture", size: 7 });
  io.directory.mockResolvedValue([]);
});

it.each([local, wsl])(
  "uses explicit $kind scope instead of the selected SSH host",
  async (workspace) => {
    const {
      readFile: read,
      writeFile: write,
      canonicalize,
      readDir: directory,
      createDir: create,
    } = native;
    await read(path, workspace);
    await write(path, "fixture", workspace);
    await canonicalize(path, workspace);
    await directory("/work", workspace);
    await create("/work/new", workspace);
    expect(io.invoke.mock.calls).toEqual([
      ["fs_read_file", { path, workspace }],
      ["fs_write_file", { path, content: "fixture", workspace }],
      ["fs_canonicalize", { path, workspace }],
      ["fs_read_dir", { path: "/work", showHidden: false, workspace }],
      ["fs_create_dir", { path: "/work/new", workspace }],
    ]);
    expect(io.current).not.toHaveBeenCalled();
    expect(io.read).not.toHaveBeenCalled();
    expect(io.write).not.toHaveBeenCalled();
  },
);

it("keeps an explicit SSH session when another host is selected", async () => {
  io.current.mockReturnValue({ ...ssh, sessionId: 8 });
  const {
    readFile: read,
    writeFile: write,
    canonicalize,
    readDir: directory,
    createDir: create,
  } = native;
  expect(await read(path, ssh)).toEqual({
    kind: "text",
    content: "fixture",
    size: 7,
  });
  await write(path, "next", ssh);
  await canonicalize(path, ssh);
  await directory("/work", ssh);
  await create("/work/new", ssh);
  expect(io.read).toHaveBeenCalledWith(ssh, path);
  expect(io.write).toHaveBeenCalledWith(ssh, path, "next");
  expect(io.canonicalize).toHaveBeenCalledWith(ssh, path);
  expect(io.directory).toHaveBeenCalledWith(ssh, "/work");
  expect(io.create).toHaveBeenCalledWith(ssh, "/work/new");
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.current).not.toHaveBeenCalled();
});

it("retains the legacy ambient scope when no explicit scope is supplied", async () => {
  await native.readFile(path);
  await native.writeFile(path, "fixture");
  expect(io.read).toHaveBeenCalledWith(ssh, path);
  expect(io.write).toHaveBeenCalledWith(ssh, path, "fixture");
});

it.each([
  "C:/work/file.ts",
  "//server/share/file.ts",
  "\\\\server\\share\\file.ts",
])("keeps an explicit native path on this computer: %s", async (path) => {
  await native.readFile(path, ssh);
  await native.writeFile(path, "fixture", wsl);
  await native.canonicalize(path, ssh);
  expect(io.invoke.mock.calls.map(([, args]) => args.workspace)).toEqual([
    local,
    local,
    local,
  ]);
  expect(io.read).not.toHaveBeenCalled();
  expect(io.write).not.toHaveBeenCalled();
  expect(io.current).not.toHaveBeenCalled();
});

it("does not retry SSH failures against the selected local filesystem", async () => {
  io.current.mockReturnValue(local);
  const failure = new Error("connection unavailable");
  io.read.mockRejectedValue(failure);
  io.write.mockRejectedValue(failure);
  io.canonicalize.mockRejectedValue(failure);
  io.directory.mockRejectedValue(failure);
  io.create.mockRejectedValue(failure);
  await expect(native.readFile(path, ssh)).rejects.toBe(failure);
  await expect(native.writeFile(path, "fixture", ssh)).rejects.toBe(failure);
  await expect(native.canonicalize(path, ssh)).rejects.toBe(failure);
  await expect(native.readDir("/work", ssh)).rejects.toBe(failure);
  await expect(native.createDir("/work/new", ssh)).rejects.toBe(failure);
  expect(io.invoke).not.toHaveBeenCalled();
});

it.each([
  { path: "remote://fixture/work/file.ts", workspace: local },
  {
    path,
    workspace: {
      kind: "serial",
      portName: "fixture",
      baudRate: 9600,
    } as WorkspaceEnv,
  },
  {
    path,
    workspace: {
      kind: "docker",
      connection: {
        containerId: "fixture",
        containerName: "Fixture",
        image: "fixture",
      },
    } as WorkspaceEnv,
  },
])(
  "refuses unsupported explicit scopes before IO: $path",
  async ({ path, workspace }) => {
    const calls = [
      () => native.readFile(path, workspace),
      () => native.writeFile(path, "fixture", workspace),
      () => native.canonicalize(path, workspace),
      () => native.readDir(path, workspace),
      () => native.createDir(path, workspace),
    ];
    for (const call of calls)
      await expect(
        Promise.resolve().then(async () => {
          await call();
        }),
      ).rejects.toThrow();
    expect(io.invoke).not.toHaveBeenCalled();
    expect(io.read).not.toHaveBeenCalled();
    expect(io.write).not.toHaveBeenCalled();
    expect(io.current).not.toHaveBeenCalled();
  },
);

it("preserves hidden-entry filtering for an explicitly owned SSH directory", async () => {
  io.directory.mockResolvedValue([
    { name: ".env", kind: "file", size: 1, mtime: 0 },
    { name: "file.ts", kind: "file", size: 1, mtime: 0 },
  ]);
  expect(await native.readDir("/work", ssh)).toEqual([
    { name: "file.ts", kind: "file", size: 1, mtime: 0, gitignored: false },
  ]);
});

it("retains the SSH destination through operation preflight, write and removal", async () => {
  io.current.mockReturnValue(local);
  io.stat.mockResolvedValue({ kind: "file", size: 7 });
  io.read.mockImplementation(async () => {
    io.current.mockReturnValue({ ...ssh, sessionId: 8 });
    return { content: "fixture", size: 7 };
  });
  expect(await native.operationInspect(path, ssh)).toEqual({
    kind: "file",
    content: "fixture",
  });
  await native.operationWriteFile(path, "next", "fixture", ssh);
  await native.operationRemoveFile(path, "fixture", ssh);
  await native.operationRemoveEmptyDirectory("/work/empty", ssh);
  expect(io.write).toHaveBeenCalledWith(ssh, path, "next");
  expect(io.remove.mock.calls).toEqual([
    [ssh, path],
    [ssh, "/work/empty"],
  ]);
  expect(io.current).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});

it.each([local, wsl])(
  "keeps explicit $kind search on its original filesystem",
  async (workspace) => {
    await native.grep({ pattern: "fixture", root: "/work" }, workspace);
    await native.glob({ pattern: "**/*.ts", root: "/work" }, workspace);
    expect(io.invoke.mock.calls).toEqual([
      [
        "fs_grep",
        {
          pattern: "fixture",
          root: "/work",
          glob: null,
          caseInsensitive: null,
          maxResults: null,
          workspace,
        },
      ],
      [
        "fs_glob",
        { pattern: "**/*.ts", root: "/work", maxResults: null, workspace },
      ],
    ]);
    expect(io.current).not.toHaveBeenCalled();
  },
);

it("never falls back to native local search for an SSH root", async () => {
  io.current.mockReturnValue(local);
  for (const operation of [
    () => native.grep({ pattern: "fixture", root: "/work" }, ssh),
    () => native.glob({ pattern: "**/*", root: "/work" }, ssh),
  ])
    await expect(Promise.resolve().then(operation)).rejects.toThrow();
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.current).not.toHaveBeenCalled();
});

it.each(["C:/work", "//server/share/work", "\\\\server\\share\\work"])(
  "keeps native search roots on this computer: %s",
  async (root) => {
    await native.grep({ pattern: "fixture", root }, ssh);
    await native.glob({ pattern: "**/*", root }, wsl);
    expect(io.invoke.mock.calls.map(([, args]) => args.workspace)).toEqual([
      local,
      local,
    ]);
    expect(io.current).not.toHaveBeenCalled();
  },
);
