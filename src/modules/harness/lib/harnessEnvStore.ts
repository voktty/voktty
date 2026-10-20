import { create } from "zustand";
import type { SshConnection } from "@/modules/ssh";
import type { RemoteSessionInfo } from "@/modules/remote/client";
import {
  closeRemoteSessionById,
  openHeldRemoteSession,
} from "@/modules/remote/sessionManager";
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

/** The session this store holds, shared with file, Git and terminal work of
 * the same profile and root instead of opening a private one. */
let heldSessionId: number | undefined;

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
      const session: RemoteSessionInfo = await openHeldRemoteSession(
        "harness",
        profile.id,
        nativeConn,
        root,
      ).catch(() =>
        openHeldRemoteSession("harness", profile.id, nativeConn, "."),
      );
      const previous = heldSessionId;
      heldSessionId = session.session_id;
      if (previous !== undefined) {
        await closeRemoteSessionById("harness", previous).catch(() => undefined);
      }
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
    const held = heldSessionId;
    heldSessionId = undefined;
    if (held !== undefined) {
      await closeRemoteSessionById("harness", held).catch(() => undefined);
    }
    if (
      current.kind === "ssh" &&
      current.sessionId !== undefined &&
      current.sessionId !== held
    ) {
      await closeRemoteSessionById("harness", current.sessionId).catch(() => undefined);
    }
    set({ env: { kind: "local" }, connecting: false, error: null });
  },

  reconnect: async (profile: SshConnection, targetRoot?: string) => {
    await get().disconnect();
    return get().connect(profile, targetRoot);
  },
}));