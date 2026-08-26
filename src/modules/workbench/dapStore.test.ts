import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMock = vi.hoisted(() => ({
  dapStart: vi.fn(),
  dapSend: vi.fn(),
  dapPoll: vi.fn(),
  dapStop: vi.fn(),
}));

vi.mock("@/modules/ai/lib/native", () => ({ native: nativeMock }));

import { useDapStore } from "./dapStore";

describe("useDapStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDapStore.setState({
      sessionId: null,
      root: null,
      scopeKey: null,
      status: "idle",
      error: null,
      breakpoints: [],
    });
  });

  it("stops a native session when initialization cannot be sent", async () => {
    nativeMock.dapStart.mockResolvedValue(12);
    nativeMock.dapSend.mockRejectedValue(new Error("adapter stdin closed"));
    nativeMock.dapStop.mockResolvedValue(undefined);

    await useDapStore.getState().start("C:\\repo", "local:repo", {
      adapterCommand: "debug-adapter",
      request: "launch",
      arguments: {},
    });

    expect(nativeMock.dapStop).toHaveBeenCalledWith(12);
    expect(useDapStore.getState().sessionId).toBeNull();
    expect(useDapStore.getState().status).toBe("error");
  });

  it("stops a session when its workspace scope changes", async () => {
    nativeMock.dapStart.mockResolvedValue(13);
    nativeMock.dapSend.mockResolvedValue(undefined);
    nativeMock.dapStop.mockResolvedValue(undefined);
    await useDapStore.getState().start("C:\\first", "local:first", {
      adapterCommand: "debug-adapter",
      request: "launch",
      arguments: {},
    });

    await useDapStore.getState().syncWorkspace("C:\\second", "local:second");

    expect(nativeMock.dapStop).toHaveBeenCalledWith(13);
    expect(useDapStore.getState().sessionId).toBeNull();
  });
});
