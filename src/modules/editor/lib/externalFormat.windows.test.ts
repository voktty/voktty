import { beforeEach, expect, it, vi } from "vitest";
import {
  readFileText,
  runExternalFormatter,
} from "@/modules/editor/lib/externalFormat";

const io = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/lib/platform", () => ({ IS_WINDOWS: true }));
beforeEach(() => {
  vi.clearAllMocks();
  io.invoke.mockResolvedValue({
    exit_code: 0,
    timed_out: false,
    stdout: "",
    stderr: "",
  });
});
it("quotes WSL formatter paths for the POSIX shell and retains its distribution", async () => {
  await runExternalFormatter("prettier", "/work/o'file.ts", "", {
    kind: "wsl",
    distro: "Owned",
  });
  expect(io.invoke).toHaveBeenCalledWith("shell_run_command", {
    command: "prettier --write '/work/o'\\''file.ts'",
    cwd: "/work",
    timeoutSecs: 20,
    workspace: { kind: "wsl", distro: "Owned" },
  });
});
it("keeps native Windows file paths local even when a WSL document environment is supplied", async () => {
  await runExternalFormatter("prettier", "C:/o'file.ts", "", {
    kind: "wsl",
    distro: "Other",
  });
  expect(io.invoke).toHaveBeenCalledWith("shell_run_command", {
    command: "prettier --write 'C:/o''file.ts'",
    cwd: "C:/",
    timeoutSecs: 20,
    workspace: { kind: "local" },
  });
});
it("reads formatter output through the same explicitly supplied WSL distribution", async () => {
  io.invoke.mockResolvedValue({ kind: "text", content: "formatted", mtime: 2 });
  await readFileText("/work/file.ts", { kind: "wsl", distro: "Owned" });
  expect(io.invoke).toHaveBeenCalledWith("fs_read_file", {
    path: "/work/file.ts",
    workspace: { kind: "wsl", distro: "Owned" },
  });
});
