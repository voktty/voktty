import { beforeEach, expect, it, vi } from "vitest";
import {
  createEditorFile,
  newEditorFileTarget,
} from "@/modules/editor/lib/newEditorFile";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
const calls = vi.hoisted(() => ({
  invoke: vi.fn(),
  remote: vi.fn(),
  namespace: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: calls.invoke }));
vi.mock("@/modules/remote/filesystem", () => ({
  remoteCreateFile: calls.remote,
}));
vi.mock("@/modules/harness/lib/fs", () => ({ createPath: calls.namespace }));
beforeEach(() => {
  vi.clearAllMocks();
  calls.invoke.mockResolvedValue("/root/new.ts");
  calls.remote.mockResolvedValue(undefined);
  calls.namespace.mockResolvedValue("remote://machine/root/new.ts");
});

it.each([
  "/absolute.ts",
  "\\absolute.ts",
  "C:relative.ts",
  "C:/absolute.ts",
  "//server/share/file",
  "../file",
  "a/../file",
  "a\\..\\file",
  "./file",
  "a//file",
  "file\0.ts",
  "https://host/file",
])("rejects a nonrelative file name %s before native work", async (name) => {
  expect(newEditorFileTarget("/root", name)).toEqual({
    error: "pathMustBeRelative",
  });
  expect(
    await createEditorFile("/root", name, LOCAL_WORKSPACE, () => true),
  ).toBeNull();
  expect(calls.invoke).not.toHaveBeenCalled();
});
it("keeps root, Windows separators and nested relative names distinct", () => {
  expect(newEditorFileTarget("C:\\root\\", "folder\\new.ts")).toEqual({
    root: "C:\\root\\",
    name: "folder/new.ts",
    path: "C:/root/folder/new.ts",
  });
  expect(newEditorFileTarget("/", "new.ts")).toMatchObject({ path: "/new.ts" });
  expect(newEditorFileTarget(null, "new.ts")).toEqual({
    error: "noWorkspaceRoot",
  });
  expect(newEditorFileTarget("/root", " ")).toEqual({ error: "nameRequired" });
});
it("uses exclusive native create_path for a local file and preserves WSL identity", async () => {
  expect(
    await createEditorFile("/root", "new.ts", LOCAL_WORKSPACE, () => true),
  ).toBe("/root/new.ts");
  expect(calls.invoke).toHaveBeenCalledExactlyOnceWith("create_path", {
    parent: "/root",
    name: "new.ts",
    isDir: false,
  });
  calls.invoke.mockClear();
  const wsl = { kind: "wsl" as const, distro: "Debian" };
  await createEditorFile("/root", "new.ts", wsl, () => true);
  expect(calls.invoke).toHaveBeenCalledExactlyOnceWith("fs_create_file", {
    path: "/root/new.ts",
    workspace: wsl,
  });
});
it("keeps SSH and remote namespace writes off the local filesystem", async () => {
  const ssh: WorkspaceEnv = {
    kind: "ssh",
    connection: { id: "a", host: "host-a", name: "A" },
    root: "/root",
    sessionId: 11,
  };
  await createEditorFile("/root", "new.ts", ssh, () => true);
  expect(calls.remote).toHaveBeenCalledExactlyOnceWith(ssh, "/root/new.ts");
  await createEditorFile(
    "remote://machine/root",
    "new.ts",
    LOCAL_WORKSPACE,
    () => true,
  );
  expect(calls.namespace).toHaveBeenCalledExactlyOnceWith(
    "remote://machine/root",
    "new.ts",
    false,
  );
  expect(calls.invoke).not.toHaveBeenCalled();
});
it("cancels before a lazy remote writer is admitted and never falls back after failure", async () => {
  let current = true;
  const pending = createEditorFile(
    "remote://machine/root",
    "new.ts",
    LOCAL_WORKSPACE,
    () => current,
  );
  current = false;
  expect(await pending).toBeNull();
  expect(calls.namespace).not.toHaveBeenCalled();
  const failure = new Error("Remote creation failed");
  calls.namespace.mockRejectedValueOnce(failure);
  await expect(
    createEditorFile(
      "remote://machine/root",
      "new.ts",
      LOCAL_WORKSPACE,
      () => true,
    ),
  ).rejects.toBe(failure);
  expect(calls.invoke).not.toHaveBeenCalled();
});
it.each<WorkspaceEnv>([
  {
    kind: "docker",
    connection: { containerId: "a", containerName: "A", image: "image" },
  },
  { kind: "serial", portName: "COM3", baudRate: 9600 },
])("refuses a local fallback for $kind file creation", async (workspace) => {
  await expect(
    createEditorFile("/root", "new.ts", workspace, () => true),
  ).rejects.toThrow("unavailable");
  expect(calls.invoke).not.toHaveBeenCalled();
});
