import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setSshTunnels } from "@/modules/settings/store";
import type {
  ActiveTunnelState,
  SshTunnelConfig,
  TunnelStatusEvent,
} from "./types";

interface LiveTunnelStoreState {
  activeTunnels: Record<string, ActiveTunnelState>;
  initialized: boolean;
  setTunnelStatus: (event: TunnelStatusEvent) => void;
  clearAllActive: () => void;
  setInitialized: (val: boolean) => void;
}

export const useLiveTunnelStore = create<LiveTunnelStoreState>((set) => ({
  activeTunnels: {},
  initialized: false,
  setTunnelStatus: (event) =>
    set((state) => {
      const next = { ...state.activeTunnels };
      if (event.status === "stopped") {
        delete next[event.id];
      } else {
        next[event.id] = {
          status: event.status,
          error: event.error,
          startedAt: event.startedAt,
        };
      }
      return { activeTunnels: next };
    }),
  clearAllActive: () => set({ activeTunnels: {} }),
  setInitialized: (val) => set({ initialized: val }),
}));

let listenerUnsub: UnlistenFn | null = null;
let stoppedUnsub: UnlistenFn | null = null;

export async function initTunnelListeners(): Promise<() => void> {
  if (useLiveTunnelStore.getState().initialized) {
    return () => {};
  }

  try {
    const list = await invoke<TunnelStatusEvent[]>("ssh_tunnel_list");
    for (const item of list) {
      useLiveTunnelStore.getState().setTunnelStatus(item);
    }
  } catch (err) {
    console.warn("[voktty-tunnel] could not fetch initial active tunnels:", err);
  }

  if (!listenerUnsub) {
    listenerUnsub = await listen<TunnelStatusEvent>(
      "ssh-tunnel://status-changed",
      (event) => {
        useLiveTunnelStore.getState().setTunnelStatus(event.payload);
      },
    );
  }

  if (!stoppedUnsub) {
    stoppedUnsub = await listen<void>("ssh-tunnel://all-stopped", () => {
      useLiveTunnelStore.getState().clearAllActive();
    });
  }

  useLiveTunnelStore.getState().setInitialized(true);

  return () => {
    listenerUnsub?.();
    stoppedUnsub?.();
    listenerUnsub = null;
    stoppedUnsub = null;
    useLiveTunnelStore.getState().setInitialized(false);
  };
}

export function useSshTunnels(): SshTunnelConfig[] {
  return usePreferencesStore((s) => s.sshTunnels ?? []);
}

export function useTunnelStatus(id: string): ActiveTunnelState {
  return (
    useLiveTunnelStore((s) => s.activeTunnels[id]) ?? {
      status: "stopped",
    }
  );
}

export async function addSshTunnel(
  tunnel: Omit<SshTunnelConfig, "id">,
): Promise<SshTunnelConfig> {
  const current = usePreferencesStore.getState().sshTunnels ?? [];
  const newTunnel: SshTunnelConfig = {
    ...tunnel,
    id: `tun-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  const next = [...current, newTunnel];
  usePreferencesStore.setState({ sshTunnels: next });
  await setSshTunnels(next);
  return newTunnel;
}

export async function updateSshTunnel(
  id: string,
  updates: Partial<Omit<SshTunnelConfig, "id">>,
): Promise<void> {
  const current = usePreferencesStore.getState().sshTunnels ?? [];
  const next = current.map((t) => (t.id === id ? { ...t, ...updates } : t));
  usePreferencesStore.setState({ sshTunnels: next });
  await setSshTunnels(next);
}

export async function deleteSshTunnel(id: string): Promise<void> {
  // If active, stop it first
  await stopSshTunnel(id);
  const current = usePreferencesStore.getState().sshTunnels ?? [];
  const next = current.filter((t) => t.id !== id);
  usePreferencesStore.setState({ sshTunnels: next });
  await setSshTunnels(next);
}

function resolveTunnelConfig(config: SshTunnelConfig): SshTunnelConfig {
  if (!config.connectionId) return config;

  const connections = usePreferencesStore.getState().sshConnections ?? [];
  const matched = connections.find((c) => c.id === config.connectionId);
  if (!matched) return config;

  return {
    ...config,
    host: matched.host || config.host,
    port: matched.port ?? config.port,
    user: matched.user ?? config.user,
    identityFile: matched.identityFile ?? config.identityFile,
    extraArgs: matched.extraArgs ?? config.extraArgs,
  };
}

export async function startSshTunnel(
  id: string,
): Promise<TunnelStatusEvent | null> {
  const tunnels = usePreferencesStore.getState().sshTunnels ?? [];
  const found = tunnels.find((t) => t.id === id);
  if (!found) return null;

  const resolved = resolveTunnelConfig(found);

  useLiveTunnelStore.getState().setTunnelStatus({
    id,
    status: "connecting",
    startedAt: Date.now(),
  });

  try {
    const result = await invoke<TunnelStatusEvent>("ssh_tunnel_start", {
      config: resolved,
    });
    useLiveTunnelStore.getState().setTunnelStatus(result);
    return result;
  } catch (err) {
    const errorEvt: TunnelStatusEvent = {
      id,
      status: "error",
      error: String(err),
    };
    useLiveTunnelStore.getState().setTunnelStatus(errorEvt);
    return errorEvt;
  }
}

export async function stopSshTunnel(id: string): Promise<void> {
  try {
    await invoke("ssh_tunnel_stop", { id });
  } catch (err) {
    console.warn(`[voktty-tunnel] failed to stop tunnel ${id}:`, err);
  } finally {
    useLiveTunnelStore.getState().setTunnelStatus({
      id,
      status: "stopped",
    });
  }
}

export async function toggleSshTunnel(id: string): Promise<void> {
  const status = useLiveTunnelStore.getState().activeTunnels[id]?.status;
  if (status === "active" || status === "connecting") {
    await stopSshTunnel(id);
  } else {
    await startSshTunnel(id);
  }
}

export async function stopAllSshTunnels(): Promise<void> {
  try {
    await invoke("ssh_tunnel_stop_all");
  } catch (err) {
    console.warn("[voktty-tunnel] failed to stop all tunnels:", err);
  } finally {
    useLiveTunnelStore.getState().clearAllActive();
  }
}
