import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  runner: vi.fn(),
  loads: { count: 0, fail: false },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/modules/connections/model/remoteCommands", async () => {
  mocks.loads.count += 1;
  if (mocks.loads.fail) throw new Error("chunk failed");
  const fs = await import("./fs");
  fs.setRemoteCommandRunner(mocks.runner);
  return {};
});

beforeEach(() => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.runner.mockReset().mockResolvedValue("remote-result");
  mocks.loads.count = 0;
  mocks.loads.fail = false;
});

describe("invokeWorkspace remote runner", () => {
  it("loads the runner on the first remote request without any other surface", async () => {
    const { invokeWorkspace } = await import("./fs");
    await expect(
      invokeWorkspace("list_dir", { path: "remote://voktty-ssh-a/srv" }),
    ).resolves.toBe("remote-result");
    await invokeWorkspace("list_dir", { path: "remote://voktty-ssh-a/srv" });
    expect(mocks.loads.count).toBe(1);
    expect(mocks.runner).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps local paths on the local invoke and never loads the runner", async () => {
    mocks.invoke.mockResolvedValue("local-result");
    const { invokeWorkspace } = await import("./fs");
    await expect(invokeWorkspace("list_dir", { path: "/tmp" })).resolves.toBe(
      "local-result",
    );
    expect(mocks.loads.count).toBe(0);
  });

  it("reports a typed error when the module cannot load and retries later", async () => {
    mocks.loads.fail = true;
    const mod = await import("./fs");
    const { invokeWorkspace, RemoteRunnerUnavailableError } = mod;
    await expect(
      invokeWorkspace("list_dir", { path: "remote://voktty-ssh-a/srv" }),
    ).rejects.toBeInstanceOf(RemoteRunnerUnavailableError);

    vi.doMock("@/modules/connections/model/remoteCommands", () => {
      mocks.loads.count += 1;
      mod.setRemoteCommandRunner(mocks.runner);
      return {};
    });
    await expect(
      invokeWorkspace("list_dir", { path: "remote://voktty-ssh-a/srv" }),
    ).resolves.toBe("remote-result");
  });
});
