import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  shellBgSpawn: vi.fn(),
  shellBgLogs: vi.fn(),
  shellBgKill: vi.fn(),
}));

vi.mock("@/modules/ai/lib/native", () => ({ native: nativeMock }));

import { useTaskStore } from "./taskStore";

describe("useTaskStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskStore.setState({
      root: null,
      scopeKey: null,
      tasks: [],
      loading: false,
      error: null,
      run: null,
      testResults: [],
    });
  });

  it("discovers, runs, tails and cancels a workspace test", async () => {
    nativeMock.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("package.json")) {
        return { kind: "text", content: '{"scripts":{"test":"vitest run"}}', size: 38 };
      }
      throw new Error("missing");
    });
    nativeMock.shellBgSpawn.mockResolvedValue(42);
    nativeMock.shellBgLogs.mockResolvedValue({
      bytes: "✓ src/demo.test.ts > works\n",
      next_offset: 30,
      dropped: 0,
      exited: true,
      exit_code: 0,
    });
    nativeMock.shellBgKill.mockResolvedValue(undefined);

    await useTaskStore.getState().load("C:\\repo", "local");
    const task = useTaskStore.getState().tasks[0];
    expect(task?.id).toBe("package:test");
    if (!task) throw new Error("task missing");
    await useTaskStore.getState().start(task);
    await useTaskStore.getState().poll();
    expect(useTaskStore.getState().run?.exitCode).toBe(0);
    expect(useTaskStore.getState().testResults[0]?.status).toBe("passed");
    expect(nativeMock.shellBgSpawn).toHaveBeenCalledWith("pnpm run test", "C:\\repo");

    await useTaskStore.getState().stop();
    expect(nativeMock.shellBgKill).toHaveBeenCalledWith(42);
  });

  it("cancels and clears a run when the workspace changes", async () => {
    nativeMock.readFile.mockRejectedValue(new Error("missing"));
    nativeMock.shellBgKill.mockResolvedValue(undefined);
    useTaskStore.setState({
      root: "C:\\first",
      scopeKey: "local:first",
      run: {
        taskId: "package:test",
        handle: 77,
        startedAt: 1,
        output: "old workspace",
        offset: 13,
        dropped: 0,
        exited: false,
        exitCode: null,
      },
    });

    await useTaskStore.getState().load("C:\\second", "local:second");

    expect(nativeMock.shellBgKill).toHaveBeenCalledWith(77);
    expect(useTaskStore.getState().run).toBeNull();
    expect(useTaskStore.getState().root).toBe("C:\\second");
  });
});
