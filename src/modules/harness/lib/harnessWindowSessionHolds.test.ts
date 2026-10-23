import {
  createHarnessWindowSessionHolds,
  type HarnessSessionHoldKind,
} from "@/modules/harness/lib/harnessWindowSessionHolds";
import { describe, expect, it, vi } from "vitest";

const kinds: HarnessSessionHoldKind[] = [
  "opening",
  "removing",
  "switching",
  "transfer",
];
const current = () => true;
function required<T>(value: T | null): T {
  if (!value) throw new Error("Missing reservation");
  return value;
}

describe("window session operation reservations", () => {
  it.each(kinds)("excludes every conflicting operation during %s", (kind) => {
    const holds = createHarnessWindowSessionHolds();
    const receipt = required(holds.acquire(kind, ["one", "two"], current));
    expect(receipt.isCurrent()).toBe(true);
    expect(holds.has(kind, "one")).toBe(true);
    for (const conflict of kinds) {
      expect(holds.acquire(conflict, ["two", "three"], current)).toBeNull();
      expect(holds.has(conflict, "three")).toBe(false);
    }
    expect(holds.acquire("transfer", ["sibling"], current)).not.toBeNull();
    receipt.release();
    expect(receipt.isCurrent()).toBe(false);
    expect(holds.hasAny("one")).toBe(false);
    expect(holds.acquire("switching", ["two"], current)).not.toBeNull();
    receipt.release();
    expect(holds.has("switching", "two")).toBe(true);
  });

  it("reserves all IDs before notifying reentrant observers", () => {
    const holds = createHarnessWindowSessionHolds();
    const observations: boolean[] = [];
    holds.subscribe(() => {
      observations.push(holds.hasAny("one") && holds.hasAny("two"));
      expect(holds.acquire("removing", ["two"], current)).toBeNull();
    });
    holds.subscribe(() => {
      throw new Error("Observer failed");
    });
    const receipt = required(holds.acquire("opening", ["one", "two"], current));
    expect(observations).toEqual([true]);
    expect(receipt.isCurrent()).toBe(true);
  });

  it("rechecks collisions after a reentrant authority callback", () => {
    const holds = createHarnessWindowSessionHolds();
    expect(
      holds.acquire("opening", ["one"], () => {
        required(holds.acquire("removing", ["one"], current));
        return true;
      }),
    ).toBeNull();
    expect(holds.has("removing", "one")).toBe(true);
  });

  it.each(["release", "invalidate"] as const)(
    "rechecks ownership when authority callbacks %s their own reservation",
    (action) => {
      const holds = createHarnessWindowSessionHolds();
      let retire = () => {};
      const receipt = required(
        holds.acquire("opening", ["one"], () => {
          retire();
          return true;
        }),
      );
      retire =
        action === "release"
          ? receipt.release
          : () => holds.invalidateOpening("one");
      expect(receipt.isCurrent()).toBe(false);
    },
  );

  it("keeps retired openings reserved until their owning operation settles", async () => {
    const holds = createHarnessWindowSessionHolds();
    const receipt = required(holds.acquire("opening", ["one", "two"], current));
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const operation = pending.finally(receipt.release);
    holds.invalidateOpening("one");
    expect(receipt.isCurrent()).toBe(false);
    expect(holds.has("opening", "two")).toBe(true);
    expect(holds.acquire("removing", ["one"], current)).toBeNull();
    finish();
    await operation;
    expect(holds.getSnapshot().sessionIds).toEqual([]);
    expect(holds.acquire("removing", ["one"], current)).not.toBeNull();
  });

  it("preserves reservations when their external authority retires", () => {
    const holds = createHarnessWindowSessionHolds();
    let active = true;
    const receipt = required(holds.acquire("transfer", ["one"], () => active));
    active = false;
    expect(receipt.isCurrent()).toBe(false);
    expect(holds.hasAny("one")).toBe(true);
    holds.invalidateOpening("one");
    expect(holds.has("transfer", "one")).toBe(true);
    expect(holds.acquire("opening", ["one"], current)).toBeNull();
    receipt.release();
    expect(holds.hasAny("one")).toBe(false);
  });

  it("bounds pending operations including every retired receipt", () => {
    const holds = createHarnessWindowSessionHolds();
    const receipts = Array.from({ length: 256 }, (_, i) =>
      required(holds.acquire("opening", [`s${i}`], current)),
    );
    for (let i = 0; i < 256; i++) holds.invalidateOpening(`s${i}`);
    expect(holds.acquire("opening", ["overflow"], current)).toBeNull();
    expect(holds.getSnapshot().sessionIds).toHaveLength(256);
    receipts[0].release();
    expect(holds.acquire("opening", ["overflow"], current)).not.toBeNull();
    receipts[0].release();
    expect(holds.acquire("opening", ["still-full"], current)).toBeNull();
  });

  it("bounds the union of IDs even in a single operation", () => {
    const holds = createHarnessWindowSessionHolds();
    const ids = Array.from({ length: 256 }, (_, i) => `s${i}`);
    const receipt = required(holds.acquire("switching", ids, current));
    expect(holds.acquire("opening", ["overflow"], current)).toBeNull();
    receipt.release();
    expect(holds.acquire("opening", ["overflow"], current)).not.toBeNull();
    expect(() =>
      holds.acquire("opening", Array(257).fill("x"), current),
    ).toThrow();
  });

  it("owns immutable exact IDs and keeps snapshots stable between membership changes", () => {
    const holds = createHarnessWindowSessionHolds();
    const ids = [" b ", "a", "a"];
    const receipt = required(holds.acquire("opening", ids, current));
    ids[0] = "changed";
    const snapshot = holds.getSnapshot();
    expect(snapshot.sessionIds).toEqual([" b ", "a"]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.sessionIds)).toBe(true);
    holds.invalidateOpening(" b ");
    expect(holds.getSnapshot()).toBe(snapshot);
    receipt.release();
    expect(holds.getSnapshot()).not.toBe(snapshot);
  });

  it("rejects invalid inputs and denied authority without publication", () => {
    const holds = createHarnessWindowSessionHolds();
    const listener = vi.fn();
    holds.subscribe(listener);
    for (const id of ["", " ", "x".repeat(257)])
      expect(() => holds.acquire("opening", [id], current)).toThrow(TypeError);
    expect(holds.acquire("opening", [], current)).toBeNull();
    expect(holds.acquire("opening", ["one"], () => false)).toBeNull();
    expect(() =>
      holds.acquire("opening", ["one"], () => {
        throw new Error("retired");
      }),
    ).toThrow("retired");
    expect(holds.getSnapshot().sessionIds).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("bounds listeners and unsubscribes without releasing operations", () => {
    const holds = createHarnessWindowSessionHolds();
    const listeners = Array.from({ length: 256 }, () => vi.fn());
    const releases = listeners.map((listener) => holds.subscribe(listener));
    expect(() => holds.subscribe(vi.fn())).toThrow(RangeError);
    releases[0]();
    releases[0]();
    const late = vi.fn();
    holds.subscribe(late);
    const receipt = required(holds.acquire("opening", ["one"], current));
    expect(listeners[0]).not.toHaveBeenCalled();
    expect(late).toHaveBeenCalledOnce();
    receipt.release();
    expect(late).toHaveBeenCalledTimes(2);
  });
});
