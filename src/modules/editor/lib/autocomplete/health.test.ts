import { describe, expect, it } from "vitest";
import { CompletionHealth } from "./health";

describe("CompletionHealth", () => {
  it("pauses automatic requests after three consecutive failures", () => {
    const health = new CompletionHealth(3, 60_000);

    health.recordFailure(1_000);
    health.recordFailure(2_000);
    expect(health.recordFailure(3_000)).toBe(63_000);
    expect(health.canRequest(false, 4_000)).toBe(false);
    expect(health.canRequest(false, 63_000)).toBe(true);
  });

  it("allows manual recovery while automatic requests are paused", () => {
    const health = new CompletionHealth(1, 60_000);
    health.recordFailure(1_000);

    expect(health.canRequest(true, 2_000)).toBe(true);
    health.recordSuccess();
    expect(health.canRequest(false, 2_000)).toBe(true);
  });
});
