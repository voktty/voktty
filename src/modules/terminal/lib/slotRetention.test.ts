import { describe, expect, it } from "vitest";
import {
  BYTES_PER_CELL,
  MAX_WEBGL_CONTEXTS,
  planSlotReap,
  planWebglRelease,
  type RetentionSlot,
} from "./slotRetention";

function slot(over: Partial<RetentionSlot> & { id: number }): RetentionSlot {
  return {
    currentLeafId: null,
    retainedLeafId: null,
    parked: false,
    lastUsedAt: 0,
    bufferCells: 0,
    hasWebgl: false,
    ...over,
  };
}

const cellsForBytes = (bytes: number) => bytes / BYTES_PER_CELL;

describe("planSlotReap", () => {
  it("never disposes a bound slot", () => {
    const slots = [
      slot({ id: 1, currentLeafId: 10, lastUsedAt: 0 }),
      slot({ id: 2, currentLeafId: 11, lastUsedAt: 1 }),
    ];
    expect(planSlotReap(slots)).toEqual([]);
  });

  it("keeps a retained buffer alive regardless of how long it sat idle", () => {
    const slots = [
      slot({ id: 1, retainedLeafId: 10, lastUsedAt: 0, bufferCells: 1_000 }),
      slot({ id: 2, currentLeafId: 11, lastUsedAt: 9_999_999 }),
    ];
    expect(planSlotReap(slots)).toEqual([]);
  });

  it("drops empty slots beyond the warm keep, oldest first", () => {
    const slots = [
      slot({ id: 1, lastUsedAt: 30 }),
      slot({ id: 2, lastUsedAt: 10 }),
      slot({ id: 3, lastUsedAt: 20 }),
    ];
    expect(planSlotReap(slots, { keepWarm: 1 })).toEqual([2, 3]);
  });

  it("releases the least recently used retained slots once over budget", () => {
    const maxRetainedBytes = 1_000;
    const each = cellsForBytes(600);
    const slots = [
      slot({ id: 1, retainedLeafId: 10, lastUsedAt: 30, bufferCells: each }),
      slot({ id: 2, retainedLeafId: 11, lastUsedAt: 10, bufferCells: each }),
      slot({ id: 3, retainedLeafId: 12, lastUsedAt: 20, bufferCells: each }),
    ];
    // 1800 bytes retained against a 1000 budget: shed oldest until it fits.
    expect(planSlotReap(slots, { maxRetainedBytes })).toEqual([2, 3]);
  });

  it("does not shed retained slots that already fit the budget", () => {
    const slots = [
      slot({
        id: 1,
        retainedLeafId: 10,
        lastUsedAt: 0,
        bufferCells: cellsForBytes(400),
      }),
      slot({
        id: 2,
        retainedLeafId: 11,
        lastUsedAt: 1,
        bufferCells: cellsForBytes(400),
      }),
    ];
    expect(planSlotReap(slots, { maxRetainedBytes: 1_000 })).toEqual([]);
  });

  it("ignores bound slots when accounting for the retained budget", () => {
    const slots = [
      slot({
        id: 1,
        currentLeafId: 10,
        lastUsedAt: 5,
        bufferCells: cellsForBytes(10_000),
      }),
      slot({
        id: 2,
        retainedLeafId: 11,
        lastUsedAt: 1,
        bufferCells: cellsForBytes(100),
      }),
    ];
    expect(planSlotReap(slots, { maxRetainedBytes: 1_000 })).toEqual([]);
  });
});

describe("planWebglRelease", () => {
  it("releases nothing while under the ceiling", () => {
    const slots = [
      slot({ id: 1, currentLeafId: 10, hasWebgl: true }),
      slot({ id: 2, retainedLeafId: 11, hasWebgl: true }),
    ];
    expect(planWebglRelease(slots, 4)).toEqual([]);
  });

  it("keeps every bound slot even when they fill the ceiling", () => {
    const slots = [
      slot({ id: 1, currentLeafId: 10, hasWebgl: true, lastUsedAt: 0 }),
      slot({ id: 2, currentLeafId: 11, hasWebgl: true, lastUsedAt: 1 }),
      slot({ id: 3, retainedLeafId: 12, hasWebgl: true, lastUsedAt: 99 }),
    ];
    expect(planWebglRelease(slots, 2).sort()).toEqual([3]);
  });

  it("sheds the least recently used retained contexts first", () => {
    const slots = [
      slot({ id: 1, retainedLeafId: 10, hasWebgl: true, lastUsedAt: 30 }),
      slot({ id: 2, retainedLeafId: 11, hasWebgl: true, lastUsedAt: 10 }),
      slot({ id: 3, retainedLeafId: 12, hasWebgl: true, lastUsedAt: 20 }),
    ];
    expect(planWebglRelease(slots, 2)).toEqual([2]);
  });

  it("ignores slots that hold no context", () => {
    const slots = [
      slot({ id: 1, retainedLeafId: 10, hasWebgl: false, lastUsedAt: 0 }),
      slot({ id: 2, retainedLeafId: 11, hasWebgl: true, lastUsedAt: 1 }),
    ];
    expect(planWebglRelease(slots, 1)).toEqual([]);
  });

  it("sheds a parked bound slot before a retained one that painted later", () => {
    // Parked means display:none: bound, but not painting, so its context is
    // not in use and must yield before one a switch could land on.
    const slots = [
      slot({ id: 1, currentLeafId: 10, hasWebgl: true, lastUsedAt: 5 }),
      slot({
        id: 2,
        currentLeafId: 11,
        parked: true,
        hasWebgl: true,
        lastUsedAt: 1,
      }),
      slot({ id: 3, retainedLeafId: 12, hasWebgl: true, lastUsedAt: 9 }),
    ];
    expect(planWebglRelease(slots, 2)).toEqual([2]);
  });

  it("accommodates a full composite space without shedding a bound context", () => {
    // Eight visible leaves is the composite maximum; the ninth pool slot is
    // never bound, so no rendered terminal may ever lose its context.
    const slots = Array.from({ length: 8 }, (_, i) =>
      slot({ id: i + 1, currentLeafId: i + 1, hasWebgl: true, lastUsedAt: i }),
    );
    slots.push(
      slot({ id: 9, retainedLeafId: 99, hasWebgl: true, lastUsedAt: 0 }),
    );
    expect(planWebglRelease(slots, MAX_WEBGL_CONTEXTS)).toEqual([9]);
  });
});
