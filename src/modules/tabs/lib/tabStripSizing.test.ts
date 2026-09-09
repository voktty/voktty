import { describe, expect, it } from "vitest";
import {
  fitTabStripItems,
  originalGapForFittedItems,
} from "./tabStripSizing";

describe("fitTabStripItems", () => {
  it("only includes complete items that fit", () => {
    expect(fitTabStripItems([80, 100, 90], 182, 0)).toEqual([0, 1]);
    expect(fitTabStripItems([80, 100, 90], 181, 0)).toEqual([0]);
  });

  it("temporarily replaces trailing items with a hidden active item", () => {
    expect(fitTabStripItems([80, 80, 120], 202, 2)).toEqual([0, 2]);
  });

  it("removes as many trailing items as the active item needs", () => {
    expect(fitTabStripItems([60, 60, 60, 150], 246, 3)).toEqual([0, 3]);
  });

  it("does not expose an item that cannot fit without clipping", () => {
    expect(fitTabStripItems([240, 80], 200, 0)).toEqual([]);
  });

  it("handles empty and unavailable strips", () => {
    expect(fitTabStripItems([], 200, -1)).toEqual([]);
    expect(fitTabStripItems([80], 0, 0)).toEqual([]);
  });
});

describe("originalGapForFittedItems", () => {
  it("maps a gap after a temporary active replacement to the saved order", () => {
    expect(originalGapForFittedItems([10, 20, 30, 40], [10, 40], 1)).toBe(1);
    expect(originalGapForFittedItems([10, 20, 30, 40], [10, 40], 2)).toBe(4);
  });

  it("keeps the leading gap at the start", () => {
    expect(originalGapForFittedItems([10, 20], [10], 0)).toBe(0);
  });
});
