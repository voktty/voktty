import type { Block } from "@/modules/harness/lib/session";
import {
  groupTurnItems,
  groupTurns,
} from "@/modules/harness/surfaces/transcriptActivity";
import { TranscriptTurnCache } from "@/modules/harness/surfaces/transcriptTurnCache";
import { describe, expect, it } from "vitest";

function conversation(): Block[] {
  return Array.from({ length: 20 }, (_, index): Block[] => [
    { id: `u${index}`, role: "user", text: `Question ${index}` },
    { id: `a${index}`, role: "assistant", text: `Answer ${index}` },
  ]).flat();
}

describe("transcript turn cache", () => {
  it("reuses settled history as the latest reply streams", () => {
    const cache = new TranscriptTurnCache();
    const blocks = conversation();
    const before = cache.group(blocks);
    const previousItems = before.map((turn) => cache.turnItems(turn, true));
    const updated = blocks.slice();
    updated[updated.length - 1] = {
      ...updated[updated.length - 1],
      text: "More output",
    };
    const after = cache.group(updated);
    for (let index = 0; index < 19; index++) {
      expect(after[index]).toBe(before[index]);
      expect(cache.turnItems(after[index], true)).toBe(previousItems[index]);
    }
    expect(after[19]).not.toBe(before[19]);
    expect(cache.turnItems(after[19], true)).not.toBe(previousItems[19]);
    expect(after).toEqual(groupTurns(updated));
  });

  it("updates an edited historical turn without changing its neighbors", () => {
    const cache = new TranscriptTurnCache();
    const blocks = conversation();
    const before = cache.group(blocks);
    const edited = blocks.slice();
    edited[3] = { ...edited[3], text: "Corrected answer" };
    const after = cache.group(edited);
    expect(after[1]).not.toBe(before[1]);
    expect(cache.turnItems(after[1], true)).toContainEqual({
      type: "block",
      block: edited[3],
    });
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
  });

  it("keeps Zen and classic activity grouping distinct", () => {
    const cache = new TranscriptTurnCache();
    const turn: Block[] = [
      { id: "u", role: "user", text: "Check this" },
      { id: "thought", role: "reasoning", text: "Inspect the config" },
      { id: "tool", role: "tool", text: "Run tests", tool: { kind: "shell" } },
    ];
    const classic = cache.turnItems(turn, false);
    const zen = cache.turnItems(turn, true);
    expect(classic).toEqual(groupTurnItems(turn, false));
    expect(zen).toEqual(groupTurnItems(turn, true));
    expect(zen).not.toEqual(classic);
    expect(cache.turnItems(turn, false)).toBe(classic);
    expect(cache.turnItems(turn, true)).toBe(zen);
  });

  it("preserves handoff boundaries, rewinds and empty history", () => {
    const cache = new TranscriptTurnCache();
    const blocks: Block[] = [
      ...conversation().slice(0, 4),
      { id: "handoff", role: "handoff", text: "Switch provider" },
      { id: "continued", role: "user", text: "Continue" },
      { id: "reply", role: "assistant", text: "Done" },
    ];
    expect(cache.group(blocks)).toEqual(groupTurns(blocks));
    expect(cache.group(blocks.slice(0, 2))).toEqual(
      groupTurns(blocks.slice(0, 2)),
    );
    expect(cache.group([])).toEqual([]);
    expect(cache.group(blocks)).toEqual(groupTurns(blocks));
  });

  it("reuses groups for local renders and equivalent immutable arrays", () => {
    const cache = new TranscriptTurnCache();
    const blocks = conversation();
    const before = cache.group(blocks);
    expect(cache.group(blocks)).toBe(before);
    expect(cache.group(blocks.slice())).toBe(before);
  });
});
