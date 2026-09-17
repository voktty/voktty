import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchClaudeRateLimits } from "./rateLimitsFetch";

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
