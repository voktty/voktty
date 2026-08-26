import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RdpConnectionProfile } from "./types";

type RdpStoreState = {
  connections: RdpConnectionProfile[];
  addConnection: (conn: Omit<RdpConnectionProfile, "id">) => RdpConnectionProfile;
  updateConnection: (
    id: string,
    updates: Partial<Omit<RdpConnectionProfile, "id">>,
  ) => void;
  deleteConnection: (id: string) => void;
  recordConnectionUse: (id: string) => void;
};

export const useRdpStore = create<RdpStoreState>()(
  persist(
    (set, get) => ({
      connections: [],
      addConnection: (conn) => {
        const id = `rdp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newConn: RdpConnectionProfile = {
          ...conn,
          id,
          port: conn.port || 3389,
        };
        set({ connections: [...get().connections, newConn] });
        return newConn;
      },
      updateConnection: (id, updates) => {
        set({
          connections: get().connections.map((c) =>
            c.id === id ? { ...c, ...updates } : c,
          ),
        });
      },
      deleteConnection: (id) => {
        set({
          connections: get().connections.filter((c) => c.id !== id),
        });
      },
      recordConnectionUse: (id) => {
        set({
          connections: get().connections.map((c) =>
            c.id === id ? { ...c, lastConnectedAt: Date.now() } : c,
          ),
        });
      },
    }),
    {
      name: "voktty-rdp-connections",
    },
  ),
);

export function useRdpConnections(): RdpConnectionProfile[] {
  return useRdpStore((s) => s.connections);
}

export function addRdpConnection(
  conn: Omit<RdpConnectionProfile, "id">,
): RdpConnectionProfile {
  return useRdpStore.getState().addConnection(conn);
}

export function updateRdpConnection(
  id: string,
  updates: Partial<Omit<RdpConnectionProfile, "id">>,
): void {
  useRdpStore.getState().updateConnection(id, updates);
}

export function deleteRdpConnection(id: string): void {
  useRdpStore.getState().deleteConnection(id);
}

export function recordRdpConnectionUse(id: string): void {
  useRdpStore.getState().recordConnectionUse(id);
}
