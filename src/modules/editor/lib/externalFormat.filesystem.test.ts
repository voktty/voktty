import { beforeEach, expect, it, vi } from "vitest";
import {
  runExternalFormatter,
  readFileText,
  formatterWorkspace,
} from "@/modules/editor/lib/externalFormat";
import { useWorkspaceEnvStore, LOCAL_WORKSPACE } from "@/modules/workspace";

const io = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "Ambient" } });
  io.invoke.mockResolvedValue({
    exit_code: 0,
    timed_out: false,
    stdout: "",
    stderr: "",
  });
});
it("runs a native formatter under the explicitly supplied document filesystem", async () => {
  await runExternalFormatter("prettier", "/work/file.ts", "", LOCAL_WORKSPACE);
  expect(io.invoke).toHaveBeenCalledWith(
    "shell_run_command",
    expect.objectContaining({ workspace: LOCAL_WORKSPACE, cwd: "/work" }),
  );
});
it("reads formatted output under the same explicit filesystem", async () => {
  io.invoke.mockResolvedValue({ kind: "text", content: "formatted", mtime: 2 });
  expect(await readFileText("/work/file.ts", LOCAL_WORKSPACE)).toEqual({
    text: "formatted",
    mtime: 2,
  });
  expect(io.invoke).toHaveBeenCalledWith("fs_read_file", {
    path: "/work/file.ts",
    workspace: LOCAL_WORKSPACE,
  });
});
it("refuses namespace formatting without invoking a local shell", async () => {
  const error = await runExternalFormatter(
    "prettier",
    "remote://voktty-ssh-fixture/work/file.ts",
    "",
    LOCAL_WORKSPACE,
  );
  expect(error).not.toBeNull();
  expect(io.invoke).not.toHaveBeenCalled();
});
it("does not invoke a retired formatter request", async () => {
  await runExternalFormatter(
    "prettier",
    "/work/file.ts",
    "",
    LOCAL_WORKSPACE,
    () => false,
  );
  expect(io.invoke).not.toHaveBeenCalled();
});

it.each([
  "relative.ts",
  "C:relative.ts",
  "/work/bad\nfile.ts",
  "/work/bad\0file.ts",
  `/${"x".repeat(32768)}`,
])("rejects a malformed or unqualified formatter path", async (path) => {
  expect(
    await runExternalFormatter("prettier", path, "", LOCAL_WORKSPACE),
  ).not.toBeNull();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("does not project an SSH host path onto the native filesystem", async () => {
  const workspace = {
    kind: "ssh",
    root: "/work",
    sessionId: 9,
    connection: { id: "fixture", name: "Fixture", host: "host-a" },
  } as const;
  expect(
    await runExternalFormatter("prettier", "/work/file.ts", "", workspace),
  ).not.toBeNull();
  expect(await readFileText("/work/file.ts", workspace)).toBeNull();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("admits WSL only on a Windows host", () => {
  const workspace = { kind: "wsl", distro: "Owned" } as const;
  expect(formatterWorkspace("/work/file.ts", workspace, false)).toBeUndefined();
  expect(formatterWorkspace("/work/file.ts", workspace, true)).toEqual(
    workspace,
  );
});
