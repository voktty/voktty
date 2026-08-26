import { beforeEach, describe, expect, it } from "vitest";
import { useAgentStore } from "./agentStore";

describe("finished pulse", () => {
  beforeEach(() => {
    useAgentStore.setState({ pulsingLeaves: {}, pulsingTabs: {} });
  });

  it("tracks per-leaf and per-tab pulse", () => {
    useAgentStore.getState().startPulse(3, 10);
    useAgentStore.getState().startPulse(5, 11);
    expect(useAgentStore.getState().pulsingLeaves).toEqual({ 3: 10, 5: 11 });
    expect(useAgentStore.getState().pulsingTabs).toEqual({
      10: true,
      11: true,
    });
  });

  it("clears tab pulse when the last flashing leaf in that tab is cleared", () => {
    useAgentStore.getState().startPulse(3, 10);
    useAgentStore.getState().startPulse(4, 10);
    useAgentStore.getState().clearPulse(3);
    expect(useAgentStore.getState().pulsingLeaves).toEqual({ 4: 10 });
    expect(useAgentStore.getState().pulsingTabs[10]).toBe(true);

    useAgentStore.getState().clearPulse(4);
    expect(useAgentStore.getState().pulsingLeaves).toEqual({});
    expect(useAgentStore.getState().pulsingTabs[10]).toBeUndefined();
  });

  it("does not clear tab pulse on click while leaves still pulse", () => {
    useAgentStore.getState().startPulse(3, 10);
    useAgentStore.getState().clearTabPulse(10);
    expect(useAgentStore.getState().pulsingTabs[10]).toBe(true);
    useAgentStore.getState().clearPulse(3);
    expect(useAgentStore.getState().pulsingTabs[10]).toBeUndefined();
  });
});
