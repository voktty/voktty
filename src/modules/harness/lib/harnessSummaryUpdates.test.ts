import { describe, expect, it, vi } from "vitest";
import { createHarnessSummaryUpdates } from "@/modules/harness/lib/harnessSummaryUpdates";
import type { SessionSummary } from "@/modules/harness/lib/sessionStore";

function summary(): SessionSummary {
  return {
    id: "one",
    cwd: "/work/one",
    harness: "claude",
    model: "default",
    runtimeMode: "supervised",
    title: "One",
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("window Harness summary updates", () => {
  it("copies only history metadata and freezes owned copies without freezing the caller", () => {
    const updates = createHarnessSummaryUpdates();
    const received: SessionSummary[] = [];
    updates.source.subscribe((value) => {
      received.push(value);
    });
    const input = {
      ...summary(),
      blocks: [{ text: "Transcript content" }],
      linkedWorkItem: {
        kind: "pr" as const,
        repo: "acme/web",
        number: 12,
        url: "https://github.com/acme/web/pull/12",
        extra: "Not summary metadata",
      },
    };
    updates.publish(input, () => true);
    input.title = "Changed";
    input.linkedWorkItem.number = 13;
    expect(received[0].title).toBe("One");
    expect(received[0].linkedWorkItem?.number).toBe(12);
    expect(received[0]).not.toHaveProperty("blocks");
    expect(received[0].linkedWorkItem).not.toHaveProperty("extra");
    expect(Object.isFrozen(received[0])).toBe(true);
    expect(Object.isFrozen(received[0].linkedWorkItem)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.linkedWorkItem)).toBe(false);
  });

  it("guards deferred view commits by the exact subscription and publisher authority", () => {
    const updates = createHarnessSummaryUpdates();
    let guard = () => false;
    let current = true;
    const stop = updates.source.subscribe((_, isCurrent) => {
      guard = isCurrent;
    });
    updates.publish(summary(), () => current);
    expect(guard()).toBe(true);
    current = false;
    expect(guard()).toBe(false);
    current = true;
    stop();
    expect(guard()).toBe(false);
  });

  it("isolates throwing observers and excludes listeners replaced during publication", () => {
    const updates = createHarnessSummaryUpdates();
    const successor = vi.fn();
    let stop = () => {};
    updates.source.subscribe(() => {
      stop();
      updates.source.subscribe(successor);
      throw new Error("View left");
    });
    const removed = vi.fn();
    stop = updates.source.subscribe(removed);
    const other = vi.fn();
    updates.source.subscribe(other);
    updates.publish(summary(), () => true);
    expect(removed).not.toHaveBeenCalled();
    expect(successor).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledOnce();
  });

  it("does not replay saves from periods with no views", () => {
    const updates = createHarnessSummaryUpdates();
    updates.publish(summary(), () => true);
    const listener = vi.fn();
    updates.source.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
    updates.publish(summary(), () => false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("bounds registrations and an old cleanup cannot remove a replacement listener", () => {
    const updates = createHarnessSummaryUpdates();
    const listener = vi.fn();
    const old = updates.source.subscribe(listener);
    old();
    updates.source.subscribe(listener);
    old();
    const stops = Array.from({ length: 255 }, () =>
      updates.source.subscribe(() => {}),
    );
    expect(() => updates.source.subscribe(listener)).toThrow(RangeError);
    stops[0]();
    updates.source.subscribe(() => {});
    updates.publish(summary(), () => true);
    expect(listener).toHaveBeenCalledOnce();
  });
});
