import { beforeEach, describe, expect, it, vi } from "vitest";

const mockShow = vi.fn().mockResolvedValue(undefined);
const mockMark = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: mockShow,
  }),
}));

vi.mock("@/lib/startupTiming", () => ({
  markStartupPhase: (phase: string) => mockMark(phase),
}));

describe("windowReveal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("reveals the window and marks window-visible phase", async () => {
    const { revealWindow } = await import("./windowReveal");
    revealWindow();

    expect(mockShow).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(mockMark).toHaveBeenCalledWith("window-visible");
  });

  it("is idempotent: subsequent calls do not invoke show again", async () => {
    const { revealWindow } = await import("./windowReveal");
    revealWindow();
    revealWindow();
    revealWindow();

    expect(mockShow).toHaveBeenCalledTimes(1);
  });
});
