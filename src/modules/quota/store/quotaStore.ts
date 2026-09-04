import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { ProviderQuota, QuotaOverview } from "../types";

type QuotaState = {
  overview: QuotaOverview | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  fetchOverview: () => Promise<void>;
  refreshProvider: (providerId: string) => Promise<void>;
};

export const useQuotaStore = create<QuotaState>((set, get) => ({
  overview: null,
  loading: false,
  error: null,
  lastFetchedAt: null,

  fetchOverview: async () => {
    try {
      set({ loading: true, error: null });
      const overview = await invoke<QuotaOverview>("get_quota_overview");
      set({ overview, loading: false, lastFetchedAt: Date.now() });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  refreshProvider: async (providerId: string) => {
    try {
      const updated = await invoke<ProviderQuota>("refresh_quota_provider", {
        providerId,
      });
      const current = get().overview;
      if (current) {
        const providers = current.providers.map((p) =>
          p.providerId === providerId ? updated : p,
        );
        set({
          overview: {
            ...current,
            providers,
            updatedAt: new Date().toISOString(),
          },
        });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
}));
