import { useCallback, useEffect, useRef, useState } from "react";
import type { SshConnectionConfig, WorkspaceEnv } from "@/modules/workspace";
import { fetchLocalHostMetrics, fetchSshServerMetrics, type SshServerMetrics } from "./types";

export type SshMetricsState = {
  metrics: SshServerMetrics | null;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => Promise<void>;
};

export type EnvMetricsTarget =
  | WorkspaceEnv
  | { kind: "ssh"; connection: SshConnectionConfig & { name?: string } }
  | (SshConnectionConfig & { name?: string });

export function useEnvironmentMetrics(
  env?: EnvMetricsTarget | null,
  options?: {
    enabled?: boolean;
    autoRefresh?: boolean;
    intervalMs?: number;
  },
): SshMetricsState {
  const { enabled = true, autoRefresh = false, intervalMs = 5000 } = options ?? {};
  const [metrics, setMetrics] = useState<SshServerMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!env || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      let data: SshServerMetrics;
      if ("kind" in env) {
        if (env.kind === "ssh") {
          data = await fetchSshServerMetrics(env.connection);
        } else {
          data = await fetchLocalHostMetrics();
        }
      } else if ("host" in env && env.host) {
        data = await fetchSshServerMetrics(env);
      } else {
        data = await fetchLocalHostMetrics();
      }
      setMetrics(data);
      setLastUpdated(Date.now());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [env]);

  useEffect(() => {
    if (!enabled || !env) {
      setMetrics(null);
      setError(null);
      return;
    }

    void refresh();

    if (!autoRefresh) return;
    const interval = setInterval(() => {
      void refresh();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [env, enabled, autoRefresh, intervalMs, refresh]);

  return { metrics, loading, error, lastUpdated, refresh };
}

export const useSshMetrics = useEnvironmentMetrics;

