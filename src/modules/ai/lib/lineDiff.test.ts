import { describe, expect, it } from "vitest";
import { createLineDiff } from "./lineDiff";

describe("createLineDiff", () => {
  it("preserves context and change order in separate hunks", () => {
    const diff = createLineDiff(
      "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine",
      "one\nTWO\nthree\nfour\nfive\nsix\nseven\nEIGHT\nnine",
      1,
    );
    expect(diff.stats).toEqual({ added: 2, removed: 2 });
    expect(diff.hunks).toHaveLength(2);
    expect(
      diff.hunks[0]?.lines.map((line) => `${line.kind}:${line.text}`),
    ).toEqual(["context:one", "remove:two", "add:TWO", "context:three"]);
    expect(
      diff.hunks[1]?.lines.map((line) => `${line.kind}:${line.text}`),
    ).toEqual(["context:seven", "remove:eight", "add:EIGHT", "context:nine"]);
  });

  it("treats duplicate lines positionally instead of set membership", () => {
    const diff = createLineDiff("a\ndup\nb\ndup\nc", "a\ndup\nB\ndup\nc");
    expect(diff.stats).toEqual({ added: 1, removed: 1 });
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]?.lines.some((line) => line.text === "dup")).toBe(true);
  });
});
