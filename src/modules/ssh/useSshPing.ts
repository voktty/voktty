import { useEffect, useRef, useState, useCallback } from "react";
import { pingSshHost, type SshConnection } from "./types";

export type SshPingStatus = {
  online: boolean;
  latencyMs?: number;
  loading: boolean;
  error?: string;
};

export type UseSshPingOptions = {
  /** Polling interval in ms while active. Defaults to 4000ms. */
  intervalMs?: number;
};

export function useSshPing(
  connections: SshConnection[],
  active: boolean = true,
  options?: UseSshPingOptions,
) {
  const [pingMap, setPingMap] = useState<Record<string, SshPingStatus>>({});
  const inFlightRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const intervalMs = options?.intervalMs ?? 4000;

  const refreshPings = useCallback(async () => {
    if (!activeRef.current || inFlightRef.current || connections.length === 0) return;
    inFlightRef.current = true;

    setPingMap((prev) => {
      const next = { ...prev };
      for (const conn of connections) {
        next[conn.id] = {
          online: prev[conn.id]?.online ?? false,
          latencyMs: prev[conn.id]?.latencyMs,
          loading: true,
        };
      }
      return next;
    });

    try {
      const promises = connections.map(async (conn) => {
        const res = await pingSshHost(conn.host, conn.port);
        return {
          id: conn.id,
          online: res.online,
          latencyMs: res.latencyMs,
          error: res.error,
        };
      });

      const results = await Promise.allSettled(promises);
      if (!activeRef.current) return;

      const updates: Record<string, SshPingStatus> = {};

      for (const result of results) {
        if (result.status === "fulfilled") {
          const item = result.value;
          updates[item.id] = {
            online: item.online,
            latencyMs: item.latencyMs,
            loading: false,
            error: item.error,
          };
        }
      }

      setPingMap((prev) => ({ ...prev, ...updates }));
    } finally {
      inFlightRef.current = false;
    }
  }, [connections]);

  useEffect(() => {
    if (!active || connections.length === 0) {
      return;
    }

    // 1. Instant check the moment the workspace window/menu opens
    void refreshPings();

    // 2. Periodic pings while open to keep remote server metrics verified
    const timer = setInterval(() => {
      if (activeRef.current) {
        void refreshPings();
      }
    }, intervalMs);

    // 3. Stop immediately when the window closes or unmounts
    return () => {
      clearInterval(timer);
    };
  }, [active, connections.length, intervalMs, refreshPings]);

  return { pingMap, refreshPings };
}
