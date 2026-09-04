import { invoke } from "@tauri-apps/api/core";
import type { ProviderQuota } from "../../quota/types";
import {
  errorRateLimits,
  parseResetTimestamp,
  type ProviderRateLimits,
  type RateLimitProvider,
  type RateLimitWindow,
} from "./rateLimits";

function providerQuotaToRateLimits(
  provider: RateLimitProvider,
  quota: ProviderQuota,
): ProviderRateLimits {
  let session: RateLimitWindow | null = null;
  let weekly: RateLimitWindow | null = null;

  for (const w of quota.windows) {
    const idLower = w.id.toLowerCase();
    const labelLower = w.label.toLowerCase();
    const resetsAt = parseResetTimestamp(w.resetsAt);

    if (
      idLower.includes("session") ||
      labelLower.includes("session") ||
      labelLower.includes("5h") ||
      idLower.includes("flash")
    ) {
      session = {
        usedPercent: w.usedPercent,
        windowMinutes: 300,
        resetsAt,
      };
    } else if (
      idLower.includes("weekly") ||
      labelLower.includes("weekly") ||
      labelLower.includes("7d") ||
      idLower.includes("pro")
    ) {
      weekly = {
        usedPercent: w.usedPercent,
        windowMinutes: 10_080,
        resetsAt,
      };
    } else if (!session) {
      session = {
        usedPercent: w.usedPercent,
        windowMinutes: 300,
        resetsAt,
      };
    } else if (!weekly) {
      weekly = {
        usedPercent: w.usedPercent,
        windowMinutes: 10_080,
        resetsAt,
      };
    }
  }

  let status: "ok" | "error" | "unavailable" = "ok";
  let error: string | null = null;

  if (quota.state.kind === "unavailable") {
    status = "unavailable";
    error = quota.state.message || "Provider unavailable";
  } else if (quota.state.kind === "unauthenticated") {
    status = "unavailable";
    error = quota.state.message || "Not authenticated";
  } else if (quota.state.kind === "rate_limited") {
    status = "error";
    error = quota.state.message || "Rate limited";
  }

  return {
    provider,
    session,
    weekly,
    updatedAt: Date.now(),
    error,
    status,
  };
}

export async function fetchClaudeRateLimits(): Promise<ProviderRateLimits> {
  try {
    const quota = await invoke<ProviderQuota>("refresh_quota_provider", {
      provider: "claude",
    });
    return providerQuotaToRateLimits("claude", quota);
  } catch (error) {
    return errorRateLimits(
      "claude",
      error instanceof Error ? error.message : "Claude usage unavailable",
    );
  }
}

export async function fetchCodexRateLimits(): Promise<ProviderRateLimits> {
  try {
    const quota = await invoke<ProviderQuota>("refresh_quota_provider", {
      provider: "codex",
    });
    return providerQuotaToRateLimits("codex", quota);
  } catch (error) {
    return errorRateLimits(
      "codex",
      error instanceof Error ? error.message : "Codex usage unavailable",
    );
  }
}

export async function fetchGeminiRateLimits(): Promise<ProviderRateLimits> {
  try {
    const quota = await invoke<ProviderQuota>("refresh_quota_provider", {
      provider: "gemini",
    });
    return providerQuotaToRateLimits("gemini", quota);
  } catch (error) {
    return errorRateLimits(
      "gemini",
      error instanceof Error ? error.message : "Gemini usage unavailable",
    );
  }
}

