import { create } from "zustand";
import type { SshConnection } from "@/modules/ssh";
import {
  closeRemoteWorkspace,
  type RemoteSessionInfo,
} from "@/modules/remote/client";
import { remoteSessions } from "@/modules/remote/sessionManager";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";
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

/** The Harness holds one lease on the shared session so file, Git and terminal
 * work for the connected profile reuse it instead of opening their own. */
let heldLease: RemoteSessionLease | undefined;

function releaseHeldLease() {
  heldLease?.release();
  heldLease = undefined;
}

export const useHarnessEnvStore = create<HarnessEnvState>((set, get) => ({
  env: { kind: "local" },
  connecting: false,
  error: null,

  setEnv: (env) => set({ env }),

  connect: async (profile: SshConnection, targetRoot?: string) => {
    set({ connecting: true, error: null });
    try {
      const nativeConn = remoteSshConnectionForProfile(profile);
      const candidateRoot = targetRoot?.trim();
      const root =
        candidateRoot && candidateRoot !== "~"
          ? candidateRoot
          : profile.initialDirectory?.trim() || ".";
      const lease = await remoteSessions
        .acquire({ profileId: profile.id, root }, nativeConn)
        .catch(() =>
          remoteSessions.acquire({ profileId: profile.id, root: "." }, nativeConn),
        );
      releaseHeldLease();
      heldLease = lease;
      const session: RemoteSessionInfo = lease.info;
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
    releaseHeldLease();
    if (current.kind === "ssh") {
      const pooled = remoteSessions
        .snapshot()
        .some((entry) => entry.sessionId === current.sessionId);
      await remoteSessions.closeProfile(current.connection.id);
      if (current.sessionId !== undefined && !pooled) {
        await closeRemoteWorkspace(current.sessionId).catch(() => undefined);
      }
    }
    set({ env: { kind: "local" }, connecting: false, error: null });
  },

  reconnect: async (profile: SshConnection, targetRoot?: string) => {
    await get().disconnect();
    return get().connect(profile, targetRoot);
  },
}));