import { describe, expect, it } from "vitest";
import { featuredLiveAgent } from "@/modules/sidebar/HarnessRailButton";
import type { LiveAgent } from "@/modules/harness/lib/liveAgents";

const agent = (id: string, patch: Partial<LiveAgent> = {}): LiveAgent => ({
  id,
  cwd: `/work/${id}`,
  title: id,
  harness: "claude",
  activity: "",
  needsApproval: false,
  done: false,
  ...patch,
});

describe("featuredLiveAgent", () => {
  it("shows the spark when nothing is running", () => {
    expect(featuredLiveAgent([])).toBeNull();
    expect(featuredLiveAgent([agent("a", { done: true })])).toBeNull();
  });

  it("prefers an agent waiting on approval over a running one", () => {
    const waiting = agent("b", { needsApproval: true });
    expect(featuredLiveAgent([agent("a"), waiting])?.id).toBe("b");
  });

  it("falls back to the first running agent", () => {
    expect(featuredLiveAgent([agent("a", { done: true }), agent("c")])?.id).toBe("c");
  });
});
