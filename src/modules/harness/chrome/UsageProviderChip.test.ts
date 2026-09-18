import { describe, expect, it } from "vitest";
import type { ProviderRateLimits } from "../lib/rateLimits";
import { needsProviderLogin } from "./UsageProviderChip";

describe("UsageProviderChip", () => {
  it("identifies login failure when status is error and error mentions sign-in or login", () => {
    const limits: ProviderRateLimits = {
      provider: "claude",
      session: null,
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: Date.now(),
      error: "Claude sign-in expired",
      status: "error",
    };
    expect(needsProviderLogin(limits)).toBe(true);
  });

  it("does not describe account-specific usage restrictions as login failures", () => {
    const limits: ProviderRateLimits = {
      provider: "claude",
      session: null,
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: Date.now(),
      error: "Claude usage is unavailable for this account",
      status: "error",
    };
    expect(needsProviderLogin(limits)).toBe(false);
  });

  it("returns false when rate limits are ok", () => {
    const limits: ProviderRateLimits = {
      provider: "codex",
      session: {
        usedPercent: 42,
        windowMinutes: 300,
        resetsAt: Date.now() + 45 * 60_000,
      },
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: Date.now(),
      error: null,
      status: "ok",
    };
    expect(needsProviderLogin(limits)).toBe(false);
  });
});
