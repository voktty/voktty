import { describe, expect, it } from "vitest";
import { createInflightTracker } from "./usageInflight";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("inflight tracker", () => {
  it("tracks each key on its own, so one stuck provider does not block another", async () => {
    const tracker = createInflightTracker<"claude" | "codex">();
    const stuck = deferred();
    tracker.track("codex", stuck.promise);
    expect(tracker.has("codex")).toBe(true);
    expect(tracker.has("claude")).toBe(false);

    const quick = deferred();
    const done = tracker.track("claude", quick.promise);
    quick.resolve();
    await done;
    expect(tracker.has("claude")).toBe(false);
    expect(tracker.has("codex")).toBe(true);
    expect(tracker.size).toBe(1);
    stuck.resolve();
  });

  it("never rejects and clears the key after a failure", async () => {
    const tracker = createInflightTracker<"codex">();
    const failing = deferred();
    const tracked = tracker.track("codex", failing.promise);
    failing.reject(new Error("probe exited"));
    await expect(tracked).resolves.toBeUndefined();
    expect(tracker.has("codex")).toBe(false);
  });

  it("does not let an older run clear a newer one registered under the same key", async () => {
    const tracker = createInflightTracker<"codex">();
    const first = deferred();
    const second = deferred();
    tracker.track("codex", first.promise);
    tracker.track("codex", second.promise);
    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(tracker.has("codex")).toBe(true);
    second.resolve();
    await tracker.idle();
    expect(tracker.has("codex")).toBe(false);
  });

  it("idle waits for work that starts while it is waiting", async () => {
    const tracker = createInflightTracker<"claude" | "codex">();
    const a = deferred();
    const b = deferred();
    tracker.track("claude", a.promise);
    let finished = false;
    const idle = tracker.idle().then(() => {
      finished = true;
    });
    tracker.track("codex", b.promise);
    a.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    b.resolve();
    await idle;
    expect(finished).toBe(true);
  });
});