import { describe, expect, it } from "vitest";
import { forEachConcurrent } from "./concurrent";

describe("forEachConcurrent", () => {
  it("processes all items", async () => {
    const items = [1, 2, 3, 4, 5];
    const results: number[] = [];
    await forEachConcurrent(items, 2, async (item) => {
      results.push(item * 2);
    });
    expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
  });

  it("handles empty arrays", async () => {
    let called = false;
    await forEachConcurrent([], 4, async () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  it("respects shouldContinue cancellation", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const processed: number[] = [];
    let stop = false;
    await forEachConcurrent(
      items,
      2,
      async (item) => {
        processed.push(item);
        if (processed.length >= 3) {
          stop = true;
        }
      },
      () => !stop,
    );
    expect(processed.length).toBeLessThan(items.length);
  });

  it("handles concurrency <= 0 safely", async () => {
    const items = ["a", "b"];
    const out: string[] = [];
    await forEachConcurrent(items, 0, async (item) => {
      out.push(item);
    });
    expect(out).toEqual(["a", "b"]);
  });
});
