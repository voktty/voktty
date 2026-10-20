import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { idleRateLimits } from "./rateLimits";
import { fetchClaudeRateLimits, observeUsageFetch } from "./rateLimitsFetch";
import { lastUsageAttempt, resetUsageAttempts } from "./usageDiagnostics";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

describe("fetchClaudeRateLimits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses valid claude oauth usage payload", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      status: "ok",
      body: JSON.stringify({
        five_hour: { used_percentage: 42, resets_at: "2026-09-17T18:00:00Z" },
        seven_day: { used_percentage: 15, resets_at: "2026-09-24T00:00:00Z" },
      }),
    });

    const result = await fetchClaudeRateLimits();
    expect(result.status).toBe("ok");
    expect(result.provider).toBe("claude");
    expect(result.session?.usedPercent).toBeCloseTo(42);
    expect(result.weekly?.usedPercent).toBeCloseTo(15);
  });

  it("handles unavailable when not signed in", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      status: "unavailable",
      error: "Claude not signed in",
    });

    const result = await fetchClaudeRateLimits();
    expect(result.status).toBe("unavailable");
    expect(result.error).toBe("Claude not signed in");
  });

  it("handles invoke rejection gracefully", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("IPC failed"));

    const result = await fetchClaudeRateLimits();
    expect(result.status).toBe("error");
    expect(result.error).toBe("IPC failed");
  });
});

describe("observeUsageFetch", () => {
  beforeEach(() => {
    resetUsageAttempts();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("turns a read that never answers into an error instead of staying on loading", async () => {
    vi.useFakeTimers();
    const pending = observeUsageFetch(
      "codex",
      "default",
      () => new Promise(() => {}),
      5_000,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;
    expect(result.status).toBe("error");
    expect(result.error).toBe("codex usage did not answer within 5s");
    expect(lastUsageAttempt("codex")).toMatchObject({
      provider: "codex",
      accountId: "default",
      status: "error",
      durationMs: 5_000,
    });
  });

  it("records a healthy read without warning", async () => {
    const ok = { ...idleRateLimits("claude"), status: "ok" as const };
    await expect(
      observeUsageFetch("claude", "work", async () => ok, 5_000),
    ).resolves.toBe(ok);
    expect(lastUsageAttempt("claude")).toMatchObject({ status: "ok", accountId: "work" });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("reports a failed read once, with its duration and cause", async () => {
    await observeUsageFetch(
      "claude",
      "default",
      () => Promise.reject(new Error("socket closed")),
      5_000,
    );
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(
      /\[usage\] claude error after \d+ms: socket closed/,
    );
  });

  it("keeps attempts of different providers apart", async () => {
    await observeUsageFetch("claude", "default", async () => idleRateLimits("claude"), 1_000);
    expect(lastUsageAttempt("codex")).toBeUndefined();
    expect(lastUsageAttempt("claude")).toBeDefined();
  });
});