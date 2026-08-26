import {
  consumeSnapshotBarrier,
  registerSnapshotBarrier,
} from "@/modules/terminal/lib/snapshotBarrier";
import { describe, expect, it } from "vitest";

describe("terminal snapshot barrier", () => {
  it("resolves only the matching leaf and consumes the internal marker", async () => {
    const barrier = registerSnapshotBarrier(18, "token-1", 100);

    expect(
      consumeSnapshotBarrier(
        18,
        new TextEncoder().encode("\0VOKTTY_COLLAB_SNAPSHOT:token-1"),
      ),
    ).toBe(true);
    await expect(barrier.reached).resolves.toBeUndefined();
  });

  it("leaves normal terminal output untouched", () => {
    expect(
      consumeSnapshotBarrier(18, new TextEncoder().encode("terminal output")),
    ).toBe(false);
  });
});
