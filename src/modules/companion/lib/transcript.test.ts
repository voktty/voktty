import { describe, expect, it } from "vitest";
import type { Block } from "@/modules/harness/lib/session";
import { groupTranscript } from "./transcript";

const block = (id: string, role: Block["role"], text: string, extra: Partial<Block> = {}): Block => ({
  id,
  role,
  text,
  ...extra,
});

describe("groupTranscript", () => {
  it("keeps non reasoning blocks untouched and in order", () => {
    const blocks = [block("1", "user", "hi"), block("2", "assistant", "hello")];
    expect(groupTranscript(blocks)).toEqual([
      { kind: "block", block: blocks[0] },
      { kind: "block", block: blocks[1] },
    ]);
  });

  it("merges consecutive reasoning blocks into one item", () => {
    const items = groupTranscript([
      block("1", "user", "q"),
      block("2", "reasoning", "first"),
      block("3", "reasoning", "second"),
      block("4", "assistant", "a"),
    ]);
    expect(items).toHaveLength(3);
    expect(items[1]).toEqual({ kind: "reasoning", id: "2", text: "first\n\nsecond", streaming: false });
  });

  it("starts a new group after an interleaved block", () => {
    const items = groupTranscript([
      block("1", "reasoning", "a"),
      block("2", "assistant", "x"),
      block("3", "reasoning", "b"),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["reasoning", "block", "reasoning"]);
  });

  it("drops empty reasoning unless it is streaming", () => {
    expect(groupTranscript([block("1", "reasoning", "  ")])).toEqual([]);
    expect(groupTranscript([block("1", "reasoning", "", { streaming: true })])).toEqual([
      { kind: "reasoning", id: "1", text: "", streaming: true },
    ]);
  });

  it("reports streaming from the latest reasoning block", () => {
    const items = groupTranscript([
      block("1", "reasoning", "a"),
      block("2", "reasoning", "b", { streaming: true }),
    ]);
    expect(items[0]).toMatchObject({ kind: "reasoning", text: "a\n\nb", streaming: true });
  });
});
