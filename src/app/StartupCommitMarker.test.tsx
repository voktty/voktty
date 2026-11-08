// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRevealWindow = vi.fn();
const mockMarkStartupPhase = vi.fn();

vi.mock("@/lib/windowReveal", () => ({
  revealWindow: () => mockRevealWindow(),
}));

vi.mock("@/lib/startupTiming", () => ({
  markStartupPhase: (phase: string) => mockMarkStartupPhase(phase),
}));

describe("StartupCommitMarker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("marks react-committed and reveals the window on mount", async () => {
    const { StartupCommitMarker } = await import("./StartupCommitMarker");
    act(() => {
      root.render(<StartupCommitMarker />);
    });

    expect(mockMarkStartupPhase).toHaveBeenCalledWith("react-committed");
    expect(mockRevealWindow).toHaveBeenCalledTimes(1);
  });
});
