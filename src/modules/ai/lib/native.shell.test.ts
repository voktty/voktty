import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  current: vi.fn(),
  windows: false,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/lib/platform", () => ({
  get IS_WINDOWS() {
    return io.windows;
  },
}));
vi.mock("@/modules/workspace", async (original) => ({
  ...(await original<typeof import("@/modules/workspace")>()),
  currentWorkspaceEnv: io.current,
}));
import { native } from "@/modules/ai/lib/native";

const local: WorkspaceEnv = { kind: "local" };
const wsl: WorkspaceEnv = { kind: "wsl", distro: "original" };
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/fixture",
  sessionId: 7,
  connection: { id: "original", name: "Original", host: "fixture.invalid" },
};
beforeEach(() => {
  vi.resetAllMocks();
  io.windows = false;
  io.current.mockReturnValue(ssh);
});

async function commands(workspace?: WorkspaceEnv, cwd = "/fixture") {
  await native.runCommand("fixture", cwd, 10, workspace);
  await native.shellSessionOpen(cwd, workspace);
  await native.shellSessionRun(3, "fixture", cwd, 10, workspace);
  await native.shellBgSpawn("fixture", cwd, workspace);
}

it.each([
  "/fixture",
  "C:/fixture",
  "//server/share/fixture",
  "\\\\server\\share\\fixture",
])(
  "keeps explicit local command scope while SSH is selected: %s",
  async (cwd) => {
    await commands(local, cwd);
    expect(
      io.invoke.mock.calls.map(([command, params]) => [
        command,
        params.workspace,
        params.cwd,
      ]),
    ).toEqual([
      ["shell_run_command", local, cwd],
      ["shell_session_open", local, cwd],
      ["shell_session_run", local, cwd],
      ["shell_bg_spawn", local, cwd],
    ]);
    expect(io.current).not.toHaveBeenCalled();
  },
);

it("keeps an explicit WSL distribution on Windows", async () => {
  io.windows = true;
  await commands(wsl);
  expect(io.invoke.mock.calls.map(([, params]) => params.workspace)).toEqual([
    wsl,
    wsl,
    wsl,
    wsl,
  ]);
  expect(io.current).not.toHaveBeenCalled();
});

it.each<WorkspaceEnv>([
  ssh,
  wsl,
  { kind: "serial", portName: "fixture", baudRate: 9600 },
  {
    kind: "docker",
    connection: {
      containerId: "fixture",
      containerName: "Fixture",
      image: "fixture",
    },
  },
])(
  "refuses unsupported command transports before invocation: %j",
  async (workspace) => {
    for (const operation of [
      () => native.runCommand("fixture", "/fixture", 10, workspace),
      () => native.shellSessionOpen("/fixture", workspace),
      () => native.shellSessionRun(3, "fixture", "/fixture", 10, workspace),
      () => native.shellBgSpawn("fixture", "/fixture", workspace),
    ])
      await expect(
        Promise.resolve().then(async () => {
          await operation();
        }),
      ).rejects.toThrow("unavailable");
    expect(io.invoke).not.toHaveBeenCalled();
  },
);

it("refuses unresolved namespaces even with explicit local scope", async () => {
  await expect(commands(local, "remote://fixture/work")).rejects.toThrow();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("preserves legacy local scope when no scope is supplied", async () => {
  io.current.mockReturnValue(local);
  await commands();
  expect(io.invoke.mock.calls.map(([, params]) => params.workspace)).toEqual([
    local,
    local,
    local,
    local,
  ]);
});
