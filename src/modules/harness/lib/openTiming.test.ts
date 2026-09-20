import { afterEach, describe, expect, it, vi } from "vitest";
import {
  harnessOpenTiming,
  markHarnessOpenPhase,
  resetHarnessOpenTiming,
} from "./openTiming";

afterEach(() => {
  resetHarnessOpenTiming();
  vi.restoreAllMocks();
});

function at(times: number[]): void {
  let index = 0;
  vi.spyOn(performance, "now").mockImplementation(
    () => times[Math.min(index++, times.length - 1)] ?? 0,
  );
}

describe("harness open timing", () => {
  it("reports nothing before the first open", () => {
    expect(harnessOpenTiming()).toBeNull();
  });

  it("separates the three costs the first open pays", () => {
    at([0, 1200, 1500, 2100]);
    markHarnessOpenPhase("requested");
    markHarnessOpenPhase("loaded");
    markHarnessOpenPhase("rendered");
    markHarnessOpenPhase("ready");

    const timing = harnessOpenTiming();
    expect(timing?.spans).toEqual({ load: 1200, render: 300, ready: 600 });
    expect(timing?.elapsed.ready).toBe(2100);
    expect(timing?.complete).toBe(true);
  });

  it("reports a partial open without inventing the phases not reached", () => {
    at([0, 900]);
    markHarnessOpenPhase("requested");
    markHarnessOpenPhase("loaded");

    const timing = harnessOpenTiming();
    expect(timing?.spans.load).toBe(900);
    expect(timing?.spans.render).toBeUndefined();
    expect(timing?.complete).toBe(false);
  });

  it("keeps the cold open when a later one is marked", () => {
    // Only the first click pays for the chunk; a warm reopen would otherwise
    // overwrite the very measurement being chased.
    at([0, 1000, 1100, 1200, 5000, 5001]);
    markHarnessOpenPhase("requested");
    markHarnessOpenPhase("loaded");
    markHarnessOpenPhase("rendered");
    markHarnessOpenPhase("ready");
    markHarnessOpenPhase("requested");
    markHarnessOpenPhase("loaded");

    expect(harnessOpenTiming()?.spans.load).toBe(1000);
  });

  it("ignores a phase marked out of order rather than reporting negatives", () => {
    at([500, 0]);
    markHarnessOpenPhase("requested");
    markHarnessOpenPhase("loaded");
    expect(harnessOpenTiming()?.spans.load).toBeLessThanOrEqual(0);
  });
});
