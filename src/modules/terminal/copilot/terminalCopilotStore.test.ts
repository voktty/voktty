import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  isAiRuntimeAvailable: () => true,
}));
import { useTerminalCopilotStore } from "./terminalCopilotStore";

describe("useTerminalCopilotStore", () => {
  it("opens and closes copilot properly", () => {
    const store = useTerminalCopilotStore.getState();
    expect(store.isOpen).toBe(false);

    store.openCopilot(42, "list files");
    const updated = useTerminalCopilotStore.getState();
    expect(updated.isOpen).toBe(true);
    expect(updated.leafId).toBe(42);
    expect(updated.initialPrompt).toBe("list files");

    updated.closeCopilot();
    const closed = useTerminalCopilotStore.getState();
    expect(closed.isOpen).toBe(false);
    expect(closed.initialPrompt).toBe("");

    // Test toggleCopilot
    closed.toggleCopilot(42, "toggle test");
    expect(useTerminalCopilotStore.getState().isOpen).toBe(true);
    expect(useTerminalCopilotStore.getState().initialPrompt).toBe("toggle test");

    useTerminalCopilotStore.getState().toggleCopilot(42);
    expect(useTerminalCopilotStore.getState().isOpen).toBe(false);
  });

  it("manages autoApprovedLeafIds correctly", () => {
    const store = useTerminalCopilotStore.getState();
    expect(store.isLeafAutoApproved(101)).toBe(false);

    store.allowAlwaysForLeaf(101);
    expect(useTerminalCopilotStore.getState().isLeafAutoApproved(101)).toBe(
      true,
    );
    expect(useTerminalCopilotStore.getState().isLeafAutoApproved(102)).toBe(
      false,
    );
  });
});
