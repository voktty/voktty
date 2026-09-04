export type LimitState =
  | { kind: "healthy" }
  | { kind: "approaching"; usedPercent: number; label: string; resetsAt?: string | null }
  | { kind: "reached"; usedPercent: number; resetsAt?: string | null }
  | { kind: "rate_limited"; retryAfterSecs?: number | null; message: string }
  | { kind: "unauthenticated"; message: string }
  | { kind: "unavailable"; message: string };

export type QuotaWindow = {
  id: string;
  providerId: string;
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: string | null;
  resetsInSeconds?: number | null;
  rawUsed?: number | null;
  rawLimit?: number | null;
  unit?: string | null;
};

export type ProviderQuota = {
  providerId: string;
  providerName: string;
  state: LimitState;
  windows: QuotaWindow[];
  planName?: string | null;
  accountEmail?: string | null;
  costTodayUsd?: number | null;
  totalInputTokens?: number | null;
  totalOutputTokens?: number | null;
  updatedAt: string;
};

export type QuotaOverview = {
  providers: ProviderQuota[];
  overallState: LimitState;
  totalCostTodayUsd: number;
  totalActiveProviders: number;
  updatedAt: string;
};
