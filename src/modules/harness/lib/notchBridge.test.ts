import { describe, expect, it } from "vitest";
import type { LiveAgent } from "./liveAgents";
import { shouldShowNotchOverlay, snapshotForOverlay } from "./notchBridge";
import type { Block, Session } from "./session";

const agent = (id: string): LiveAgent => ({
  id,
  cwd: "/p",
  title: "t",
  harness: "claude",
  activity: "x",
  needsApproval: false,
  done: false,
});

const session = (id: string, blocks: Block[]): Session =>
  ({
    id,
    harness: "claude",
    model: "m",
    modelSettings: { secret: "value" },
    runtimeMode: "default",
    title: "t",
    cwd: "/p",
    blocks,
    composerSeed: "private draft",
  }) as unknown as Session;

describe("shouldShowNotchOverlay", () => {
  it("shows only with live agents while Voktty is not focused", () => {
    expect(shouldShowNotchOverlay({ enabled: true, liveAgentCount: 1, appFocused: false })).toBe(true);
    expect(shouldShowNotchOverlay({ enabled: true, liveAgentCount: 1, appFocused: true })).toBe(false);
    expect(shouldShowNotchOverlay({ enabled: true, liveAgentCount: 0, appFocused: false })).toBe(false);
    expect(shouldShowNotchOverlay({ enabled: false, liveAgentCount: 2, appFocused: false })).toBe(false);
  });
});

describe("snapshotForOverlay", () => {
  it("drops sessions that are not live agents", () => {
    const snap = snapshotForOverlay([agent("a")], [session("a", []), session("b", [])]);
    expect(snap.sessions.map((s) => s.id)).toEqual(["a"]);
  });

  it("keeps a bounded tail of truncated blocks and no extra session fields", () => {
    const blocks = Array.from({ length: 40 }, (_, i) => ({
      id: String(i),
      role: "assistant",
      text: "x".repeat(5000),
    })) as Block[];
    const [out] = snapshotForOverlay([agent("a")], [session("a", blocks)]).sessions;
    expect(out.blocks).toHaveLength(24);
    expect(out.blocks[0].id).toBe("16");
    expect(out.blocks[0].text.length).toBe(2000);
    expect(out.modelSettings).toEqual({});
    expect((out as unknown as Record<string, unknown>).composerSeed).toBeUndefined();
  });
});
