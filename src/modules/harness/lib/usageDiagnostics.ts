import type { RateLimitProvider, RateLimitStatus } from "./rateLimits";

export type UsageAttempt = {
  provider: RateLimitProvider;
  accountId: string;
  startedAt: number;
  durationMs: number;
  status: RateLimitStatus;
  error: string | null;
};

const MAX_ATTEMPTS = 40;
const attempts: UsageAttempt[] = [];

/** Keeps the latest reads so a stuck or failing provider can be explained. */
export function recordUsageAttempt(attempt: UsageAttempt): void {
  attempts.push(attempt);
  if (attempts.length > MAX_ATTEMPTS) attempts.splice(0, attempts.length - MAX_ATTEMPTS);
  if (attempt.status !== "ok") {
    console.warn(
      `[usage] ${attempt.provider} ${attempt.status} after ${attempt.durationMs}ms: ${attempt.error ?? "no detail"}`,
    );
  }
}

export function lastUsageAttempt(
  provider: RateLimitProvider,
): UsageAttempt | undefined {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    if (attempts[index].provider === provider) return attempts[index];
  }
  return undefined;
}

export function resetUsageAttempts(): void {
  attempts.length = 0;
}