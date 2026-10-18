import { create } from "zustand";
import type { SshConnection } from "@/modules/ssh";
import {
  closeRemoteWorkspace,
  openRemoteWorkspace,
  type RemoteSessionInfo,
} from "@/modules/remote/client";
import { remoteSshConnectionForProfile } from "@/modules/connections/model/remoteSshProfiles";

export type HarnessRemoteEnv =
  | { kind: "local" }
  | {
      kind: "ssh";
      connection: SshConnection;
      root: string;
      sessionId?: number;
    };

type HarnessEnvState = {
  env: HarnessRemoteEnv;
  connecting: boolean;
  error: string | null;
  connect: (
    profile: SshConnection,
    targetRoot?: string,
  ) => Promise<HarnessRemoteEnv>;
  disconnect: () => Promise<void>;
  reconnect: (
    profile: SshConnection,
    targetRoot?: string,
  ) => Promise<HarnessRemoteEnv>;
  setEnv: (env: HarnessRemoteEnv) => void;
};

export const useHarnessEnvStore = create<HarnessEnvState>((set, get) => ({
  env: { kind: "local" },
  connecting: false,
  error: null,

  setEnv: (env) => set({ env }),

  connect: async (profile: SshConnection, targetRoot?: string) => {
    set({ connecting: true, error: null });
    try {
      const nativeConn = remoteSshConnectionForProfile(profile);
      const root = targetRoot?.trim() || profile.initialDirectory?.trim() || "/";
      const session: RemoteSessionInfo = await openRemoteWorkspace(
        nativeConn,
        root,
      ).catch(() => openRemoteWorkspace(nativeConn, "/"));
      const nextEnv: HarnessRemoteEnv = {
        kind: "ssh",
        connection: profile,
        root: session.workspace_root,
        sessionId: session.session_id,
      };
      set({ env: nextEnv, connecting: false, error: null });
      return nextEnv;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ connecting: false, error: message });
      throw err;
    }
  },

  disconnect: async () => {
    const current = get().env;
    if (current.kind === "ssh" && current.sessionId !== undefined) {
      await closeRemoteWorkspace(current.sessionId).catch(() => {});
    }
    set({ env: { kind: "local" }, connecting: false, error: null });
  },

  reconnect: async (profile: SshConnection, targetRoot?: string) => {
    await get().disconnect();
    return get().connect(profile, targetRoot);
  },
}));
