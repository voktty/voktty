import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  getToolsConfigTarget,
  ensureToolsConfigTarget,
  loadToolsConfigFile,
  parseToolsConfig,
  DEFAULT_PROJECT_TOOLS,
} from "@/modules/statusbar/lib/toolsConfigFile";
import { LOCAL_WORKSPACE, useWorkspaceEnvStore } from "@/modules/workspace";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: async () => "/config",
  join: async (...parts: string[]) => parts.join("/"),
}));
const originalEnv = useWorkspaceEnvStore.getState().env;
const tool = { id: "test", command: "echo example", category: "custom" };
beforeEach(() => {
  useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "fs_read_file")
      return { kind: "text", content: JSON.stringify({ tools: [tool] }) };
    return {};
  });
});
afterEach(() => useWorkspaceEnvStore.setState({ env: originalEnv }));
it("captures the workspace once before awaiting project lookup", async () => {
  const workspace = { kind: "wsl" as const, distro: "Debian" };
  useWorkspaceEnvStore.setState({ env: workspace });
  let finish!: () => void;
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const loading = loadToolsConfigFile("/project");
  useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
  finish();
  expect(await loading).toEqual([tool]);
  expect(mocks.invoke).toHaveBeenLastCalledWith("fs_read_file", {
    path: "/project/.voktty/tools.json",
    workspace,
  });
});

it("preserves native Windows project paths while WSL is selected", async () => {
  const target = await getToolsConfigTarget("C:\\project", {
    kind: "wsl",
    distro: "Debian",
  });
  expect(target).toEqual({
    path: "C:/project/.voktty/tools.json",
    workspace: LOCAL_WORKSPACE,
  });
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("fs_stat", target);
});
it("keeps global fallback reads and creation local while WSL is selected", async () => {
  const workspace = { kind: "wsl" as const, distro: "Debian" };
  mocks.invoke.mockImplementation(
    async (command: string, args: { path: string }) => {
      if (command === "fs_stat") throw new Error("missing");
      if (command === "fs_read_file")
        return { kind: "text", content: JSON.stringify([tool]) };
      return args;
    },
  );
  expect(await getToolsConfigTarget("/project", workspace)).toEqual({
    path: "/config/project-tools.json",
    workspace: LOCAL_WORKSPACE,
  });
  expect(await loadToolsConfigFile("/project", workspace)).toEqual([tool]);
  expect(await ensureToolsConfigTarget("/project", workspace)).toEqual({
    path: "/config/project-tools.json",
    workspace: LOCAL_WORKSPACE,
  });
  for (const [command, args] of mocks.invoke.mock.calls) {
    if (command !== "fs_stat") expect(args.workspace).toBe(LOCAL_WORKSPACE);
  }
});
it("does not admit creation or writing after a stat retires its caller", async () => {
  let current = true;
  let finish!: () => void;
  let entered!: () => void;
  const statEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        entered();
      }),
  );
  const pending = ensureToolsConfigTarget(null, LOCAL_WORKSPACE, () => current);
  await statEntered;
  current = false;
  finish();
  await expect(pending).rejects.toThrow();
  expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
    "fs_stat",
  ]);
});
it("does not write after admitted directory creation retires its caller", async () => {
  let current = true;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "fs_stat") throw new Error("missing");
    if (command === "fs_create_dir") current = false;
  });
  await expect(
    ensureToolsConfigTarget(null, LOCAL_WORKSPACE, () => current),
  ).rejects.toThrow();
  expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
    "fs_stat",
    "fs_create_dir",
  ]);
});
it("accepts bounded legacy arrays and object configurations", () => {
  expect(parseToolsConfig(JSON.stringify([tool]))).toEqual([tool]);
  expect(
    parseToolsConfig(JSON.stringify({ tools: DEFAULT_PROJECT_TOOLS })),
  ).toEqual(DEFAULT_PROJECT_TOOLS);
});
it.each([
  "null",
  "{}",
  "broken",
  JSON.stringify([{ ...tool, command: null }]),
  JSON.stringify([tool, tool]),
  JSON.stringify([{ ...tool, tags: [null] }]),
  JSON.stringify(
    Array.from({ length: 257 }, (_, index) => ({ ...tool, id: String(index) })),
  ),
  " ".repeat(1024 * 1024 + 1),
])("rejects malformed or excessive configuration %#", (content) => {
  expect(parseToolsConfig(content)).toBeNull();
});
