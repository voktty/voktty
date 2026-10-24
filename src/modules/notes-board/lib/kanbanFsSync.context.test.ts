import { beforeEach, expect, it, vi } from "vitest";
import {
  exportCardsToProjectVault,
  importCardsFromProjectVault,
} from "./kanbanFsSync";
import { vaultPath } from "./vaultFilesystem";
import type { KanbanCard } from "./kanbanTypes";
import type { WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  create: vi.fn(),
  remoteList: vi.fn(),
  remoteRead: vi.fn(),
  remoteWrite: vi.fn(),
  remoteCreate: vi.fn(),
  remoteStat: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/modules/harness/lib/fs", () => ({
  listDir: mocks.list,
  readTextFile: mocks.read,
  writeTextFile: mocks.write,
  createPath: mocks.create,
}));
vi.mock("@/modules/remote/filesystem", () => ({
  remoteReadDir: mocks.remoteList,
  remoteReadFile: mocks.remoteRead,
  remoteWriteFile: mocks.remoteWrite,
  remoteCreateDir: mocks.remoteCreate,
  remoteStat: mocks.remoteStat,
}));
const card = (title = "Task"): KanbanCard => ({
  id: title,
  title,
  description: "Details",
  columnId: "todo",
  order: 0,
  createdAt: 1,
  updatedAt: 1,
});
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/project",
  sessionId: 12,
  connection: { id: "host-a", name: "Host", host: "example.invalid" },
};
const wsl: WorkspaceEnv = { kind: "wsl", distro: "Test" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.read.mockResolvedValue("Task details");
  mocks.create.mockResolvedValue(undefined);
  mocks.write.mockResolvedValue(undefined);
  mocks.remoteList.mockResolvedValue([]);
  mocks.remoteRead.mockResolvedValue({ content: "Remote details" });
  mocks.remoteCreate.mockResolvedValue(undefined);
  mocks.remoteWrite.mockResolvedValue(undefined);
  mocks.remoteStat.mockResolvedValue({ kind: "dir" });
  mocks.invoke.mockImplementation(async (command) =>
    command === "fs_read_dir"
      ? []
      : command === "fs_read_file"
        ? { kind: "text", content: "WSL details" }
        : undefined,
  );
});

it.each([
  ["remote://host/project", "remote://host/project/.voktty/tasks/todo/task.md"],
  [
    "\\\\server\\share\\project\\",
    "//server/share/project/.voktty/tasks/todo/task.md",
  ],
  ["C:\\project\\", "C:/project/.voktty/tasks/todo/task.md"],
  ["/", "/.voktty/tasks/todo/task.md"],
])("preserves the root syntax for %s", async (root, path) => {
  await expect(exportCardsToProjectVault(root, [card()])).resolves.toEqual({
    count: 1,
  });
  expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
    path,
    expect.stringContaining("Details"),
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("keeps WSL on its explicit distro and creates parents before writing", async () => {
  await exportCardsToProjectVault("/project", [card()], { workspace: wsl });
  expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
    "fs_create_dir",
    "fs_create_dir",
    "fs_create_dir",
    "fs_write_file",
  ]);
  expect(mocks.invoke).toHaveBeenLastCalledWith(
    "fs_write_file",
    expect.objectContaining({
      path: "/project/.voktty/tasks/todo/task.md",
      workspace: wsl,
    }),
  );
  expect(mocks.write).not.toHaveBeenCalled();
});

it("uses the captured SSH connection after caller mutation", async () => {
  const original = structuredClone(ssh);
  const workspace = structuredClone(ssh);
  let release!: () => void;
  mocks.remoteCreate.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const operation = exportCardsToProjectVault("/project", [card()], {
    workspace,
  });
  await vi.waitFor(() => expect(mocks.remoteCreate).toHaveBeenCalledOnce());
  if (workspace.kind === "ssh") {
    workspace.sessionId = 99;
    workspace.connection.host = "other.invalid";
  }
  release();
  await operation;
  expect(mocks.remoteWrite).toHaveBeenCalledExactlyOnceWith(
    original,
    "/project/.voktty/tasks/todo/task.md",
    expect.any(String),
  );
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it.each([ssh, wsl])(
  "imports through the owning $kind adapter and distrusts returned absolute paths",
  async (workspace) => {
    const entries = [
      { name: "task.md", kind: "file", path: "/outside/private.md" },
    ];
    if (workspace.kind === "ssh")
      mocks.remoteList.mockResolvedValueOnce(entries);
    else mocks.invoke.mockResolvedValueOnce(entries);
    const imported = await importCardsFromProjectVault("/project", {
      workspace,
    });
    expect(imported).toHaveLength(1);
    expect(imported[0].sourceCwd).toBe("/project");
    if (workspace.kind === "ssh")
      expect(mocks.remoteRead).toHaveBeenCalledExactlyOnceWith(
        workspace,
        "/project/.voktty/tasks/ideas/task.md",
      );
    else
      expect(mocks.invoke).toHaveBeenCalledWith("fs_read_file", {
        path: "/project/.voktty/tasks/ideas/task.md",
        workspace,
      });
    expect(mocks.read).not.toHaveBeenCalled();
  },
);

it("snapshots the complete export before its first asynchronous stage", async () => {
  const cards = [card("First"), card("Second")];
  mocks.create.mockImplementationOnce(async () => {
    cards[1].title = "Changed";
    cards[1].description = "Changed";
  });
  await exportCardsToProjectVault("/project", cards);
  expect(mocks.write).toHaveBeenLastCalledWith(
    "/project/.voktty/tasks/todo/second.md",
    expect.stringContaining("Details"),
  );
});

it("retires between parent creation and writing without entering another stage", async () => {
  let current = true;
  mocks.create.mockImplementationOnce(async () => {
    current = false;
  });
  await expect(
    exportCardsToProjectVault("/project", [card()], { current: () => current }),
  ).rejects.toThrow("retired");
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.write).not.toHaveBeenCalled();
});

it("retires after a directory read before opening any card", async () => {
  let current = true;
  mocks.list.mockImplementationOnce(async () => {
    current = false;
    return [{ name: "task.md", isDir: false }];
  });
  await expect(
    importCardsFromProjectVault("/project", { current: () => current }),
  ).rejects.toThrow("retired");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledOnce();
});

it.each(["../task.md", "nested/task.md", "nested\\task.md"])(
  "rejects an unsafe returned entry %s",
  async (name) => {
    mocks.list.mockResolvedValueOnce([{ name, isDir: false }]);
    await expect(importCardsFromProjectVault("/project")).rejects.toThrow(
      "filename",
    );
    expect(mocks.read).not.toHaveBeenCalled();
  },
);

it("reports failed writes instead of acknowledging a partial export", async () => {
  mocks.write.mockRejectedValueOnce(new Error("write denied"));
  await expect(
    exportCardsToProjectVault("/project", [card(), card("Second")]),
  ).rejects.toThrow("write denied");
  expect(mocks.write).toHaveBeenCalledOnce();
});

it("allows missing column directories but propagates connection and permission failures", async () => {
  mocks.list.mockRejectedValueOnce(new Error("ENOENT"));
  await expect(importCardsFromProjectVault("/project")).resolves.toEqual([]);
  mocks.list.mockRejectedValueOnce(new Error("Permission denied"));
  await expect(importCardsFromProjectVault("/project")).rejects.toThrow(
    "Permission denied",
  );
  mocks.list.mockRejectedValueOnce(new Error("SSH session not found"));
  await expect(importCardsFromProjectVault("/project")).rejects.toThrow(
    "SSH session not found",
  );
});

it("preflights duplicate filenames and oversized exports before filesystem work", async () => {
  await expect(
    exportCardsToProjectVault("/project", [card(), card()]),
  ).rejects.toThrow("Duplicate");
  await expect(
    exportCardsToProjectVault("/project", [
      { ...card(), description: "x".repeat(1024 * 1024) },
    ]),
  ).rejects.toThrow("too large");
  await expect(
    exportCardsToProjectVault(
      "/project",
      Array.from({ length: 257 }, (_, i) => card(String(i))),
    ),
  ).rejects.toThrow("Too many");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});

it("bounds imported card count and content before returning a batch", async () => {
  mocks.list.mockResolvedValueOnce(
    Array.from({ length: 257 }, (_, i) => ({ name: `${i}.md`, isDir: false })),
  );
  await expect(importCardsFromProjectVault("/project")).rejects.toThrow(
    "Too many",
  );
  expect(mocks.read).toHaveBeenCalledTimes(256);
  mocks.list.mockResolvedValueOnce([{ name: "big.md", isDir: false }]);
  mocks.read.mockResolvedValueOnce("x".repeat(1024 * 1024 + 1));
  await expect(importCardsFromProjectVault("/project")).rejects.toThrow(
    "too large",
  );
});

it.each<WorkspaceEnv>([
  { kind: "serial", portName: "COM1", baudRate: 9600 },
  {
    kind: "docker",
    connection: { containerId: "id", containerName: "name", image: "test" },
  },
])("rejects $kind before any IO", async (workspace) => {
  await expect(
    exportCardsToProjectVault("/project", [card()], { workspace }),
  ).rejects.toThrow("unavailable");
  await expect(
    importCardsFromProjectVault("/project", { workspace }),
  ).rejects.toThrow("unavailable");
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
});

it("joins only controlled path segments without changing a namespace", () => {
  expect(vaultPath("remote://host/project/", ".voktty", "tasks")).toBe(
    "remote://host/project/.voktty/tasks",
  );
});

it("reuses confirmed directories within one export without retaining a global cache", async () => {
  await exportCardsToProjectVault("/project", [card(), card("Second")]);
  expect(mocks.create).toHaveBeenCalledTimes(3);
  await exportCardsToProjectVault("/project", [card()]);
  expect(mocks.create).toHaveBeenCalledTimes(6);
});

it("verifies an existing parent and stops before writes if verification fails", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Already exists"));
  mocks.list.mockResolvedValueOnce([]);
  await expect(
    exportCardsToProjectVault("/project", [card()]),
  ).resolves.toEqual({ count: 1 });
  mocks.create.mockRejectedValueOnce(new Error("Permission denied"));
  mocks.list.mockRejectedValueOnce(new Error("Permission denied"));
  await expect(exportCardsToProjectVault("/project", [card()])).rejects.toThrow(
    "Permission denied",
  );
  expect(mocks.write).toHaveBeenCalledOnce();
});

it("preflights aggregate export size and long filenames", async () => {
  await expect(
    exportCardsToProjectVault(
      "/project",
      Array.from({ length: 10 }, (_, i) => ({
        ...card(String(i)),
        description: "x".repeat(900000),
      })),
    ),
  ).rejects.toThrow("too large");
  await expect(
    exportCardsToProjectVault("/project", [card("x".repeat(256))]),
  ).rejects.toThrow("filename");
  expect(mocks.create).not.toHaveBeenCalled();
});
