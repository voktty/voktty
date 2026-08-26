import { beforeEach, describe, expect, it } from "vitest";
import { useDevServerCaptureStore } from "./devServerStore";

describe("dev server capture store", () => {
  beforeEach(() => {
    useDevServerCaptureStore.setState({
      capturesByLeaf: {},
      commandsByLeaf: {},
    });
  });

  it("associates a detected server with its command and workspace", () => {
    const store = useDevServerCaptureStore.getState();
    store.beginCommand(7, {
      ptyId: 21,
      workspaceKey: "wsl:Ubuntu",
      cwd: "/work/app",
    });
    useDevServerCaptureStore
      .getState()
      .processOutput(7, "VITE ready at http://localhost:5173/\n");

    expect(useDevServerCaptureStore.getState().capturesByLeaf[7]).toEqual([
      expect.objectContaining({
        leafId: 7,
        ptyId: 21,
        workspaceKey: "wsl:Ubuntu",
        cwd: "/work/app",
        url: "http://localhost:5173",
      }),
    ]);
  });

  it("clears captures at command end without affecting another terminal", () => {
    for (const leafId of [1, 2]) {
      useDevServerCaptureStore.getState().beginCommand(leafId, {
        ptyId: leafId,
        workspaceKey: "local",
        cwd: `C:\\repo\\${leafId}`,
      });
      useDevServerCaptureStore
        .getState()
        .processOutput(leafId, `http://localhost:${5100 + leafId}\n`);
    }

    useDevServerCaptureStore.getState().endCommand(1);

    const state = useDevServerCaptureStore.getState();
    expect(state.capturesByLeaf[1]).toBeUndefined();
    expect(state.commandsByLeaf[1]).toBeUndefined();
    expect(state.capturesByLeaf[2]).toHaveLength(1);
    expect(state.commandsByLeaf[2]).toBeDefined();
  });

  it("ignores terminal output outside an active command", () => {
    useDevServerCaptureStore
      .getState()
      .processOutput(5, "http://localhost:3000\n");

    expect(
      useDevServerCaptureStore.getState().capturesByLeaf[5],
    ).toBeUndefined();
  });
});
