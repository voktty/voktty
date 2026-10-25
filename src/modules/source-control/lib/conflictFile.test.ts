import { beforeEach, expect, it, vi } from "vitest";
import {
  conflictFileTarget,
  readConflictFile,
  writeConflictFile,
} from "@/modules/source-control/lib/conflictFile";
import type { WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  projectRead: vi.fn(),
  projectWrite: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/modules/remote", () => ({
  remoteReadFile: mocks.read,
  remoteWriteFile: mocks.write,
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  readTextFile: mocks.projectRead,
  writeTextFile: mocks.projectWrite,
}));
const local: WorkspaceEnv = { kind: "local" };
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.invoke.mockResolvedValue({ kind: "text", content: "before", size: 6 });
  mocks.read.mockResolvedValue({ content: "before", size: 6 });
  mocks.projectRead.mockResolvedValue("before");
});
it.each([
  "../escape",
  "/absolute",
  "a/../b",
  "a//b",
  "a/./b",
  "a\0b",
  "remote://other/file",
  "C:/file",
])("rejects unqualified conflict paths: %s", (relative) => {
  expect(conflictFileTarget("/repo", relative, local)).toBeNull();
});
it.each(["relative", "/repo/../other", "remote://unknown/repo", "//server"])(
  "rejects unqualified roots: %s",
  (root) => {
    expect(conflictFileTarget(root, "a.ts", local)).toBeNull();
  },
);
it.each<WorkspaceEnv>([
  { kind: "serial", portName: "port", baudRate: 9600 },
  {
    kind: "docker",
    connection: { containerId: "box", containerName: "Box", image: "image" },
  },
])(
  "does not fall back locally for unsupported $kind filesystems",
  (workspace) => {
    expect(conflictFileTarget("/repo", "a.ts", workspace)).toBeNull();
  },
);
it.each([
  ["/repo", local],
  ["C:/repo", local],
  ["//server/share/repo", local],
  ["/repo", { kind: "wsl", distro: "Ubuntu" }],
] as const)(
  "retains native location %s and explicit filesystem",
  async (root, workspace) => {
    const target = conflictFileTarget(root, "src\\a.ts", workspace);
    expect(target?.relative).toBe("src/a.ts");
    expect(target?.path).toBe(`${root}/src/a.ts`);
    if (!target) throw new Error("Missing target");
    await readConflictFile(target);
    await writeConflictFile(target, "after", "before");
    expect(mocks.invoke).toHaveBeenCalledWith("fs_read_file", {
      path: target.path,
      workspace,
      force: false,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("fs_write_file", {
      path: target.path,
      content: "after",
      workspace,
    });
  },
);
it("keeps SSH reads and writes on the captured authenticated filesystem", async () => {
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    root: "/repo",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  };
  const target = conflictFileTarget("/repo", "a.ts", workspace);
  if (!target) throw new Error("Missing target");
  await readConflictFile(target);
  await writeConflictFile(target, "after", "before");
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(workspace, "/repo/a.ts");
  expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
    workspace,
    "/repo/a.ts",
    "after",
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("uses the existing project router and expected-content contract for direct SSH namespaces", async () => {
  const path = "remote://voktty-ssh-build/repo/a.ts";
  const target = conflictFileTarget(
    "remote://voktty-ssh-build/repo",
    "a.ts",
    local,
  );
  if (!target) throw new Error("Missing target");
  await readConflictFile(target);
  await writeConflictFile(target, "after", "before");
  expect(mocks.projectRead).toHaveBeenCalledExactlyOnceWith(path);
  expect(mocks.projectWrite).toHaveBeenCalledExactlyOnceWith(
    path,
    "after",
    "before",
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
});
