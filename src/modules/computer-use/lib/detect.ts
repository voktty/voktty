import { remoteSessions } from "@/modules/remote/sessionManager";
import { remoteSshConnectionForProfile } from "@/modules/connections/model/remoteSshProfiles";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  COMPUTER_USE_PROBE_CAPABILITY,
  probeLocalComputerUse,
  probeRemoteComputerUse,
  type ComputerUseProbe,
  type ComputerUseTarget,
} from "./probe";

export type DetectState =
  | { kind: "result"; probe: ComputerUseProbe }
  | { kind: "helper-outdated" }
  | { kind: "unknown-host" }
  | { kind: "error"; message: string };

export type HostLease = {
  sessionId: number;
  capabilities: string[];
  release: () => void;
};

export type DetectDeps = {
  local: (runDoctor: boolean) => Promise<ComputerUseProbe>;
  remote: (sessionId: number, runDoctor: boolean) => Promise<ComputerUseProbe>;
  /** `null` when the saved connection no longer exists. */
  acquireHost: (hostId: string) => Promise<HostLease | null>;
};

const defaultDeps: DetectDeps = {
  local: probeLocalComputerUse,
  remote: probeRemoteComputerUse,
  acquireHost: async (hostId) => {
    const connection = (
      usePreferencesStore.getState().sshConnections ?? []
    ).find((candidate) => candidate.id === hostId);
    if (!connection) return null;
    const lease = await remoteSessions.acquire(
      { profileId: connection.id, root: connection.initialDirectory?.trim() || "." },
      remoteSshConnectionForProfile(connection),
    );
    return {
      sessionId: lease.info.session_id,
      capabilities: lease.info.capabilities ?? [],
      release: lease.release,
    };
  },
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads the install state on this computer or on a saved SSH host. It never
 * installs or configures anything. A host whose helper does not advertise the
 * probe is reported as outdated instead of being asked.
 */
export async function detectComputerUse(
  target: ComputerUseTarget,
  runDoctor: boolean,
  deps: DetectDeps = defaultDeps,
): Promise<DetectState> {
  try {
    if (target.hostId === null) {
      return { kind: "result", probe: await deps.local(runDoctor) };
    }
    const lease = await deps.acquireHost(target.hostId);
    if (!lease) return { kind: "unknown-host" };
    try {
      if (!lease.capabilities.includes(COMPUTER_USE_PROBE_CAPABILITY)) {
        return { kind: "helper-outdated" };
      }
      return { kind: "result", probe: await deps.remote(lease.sessionId, runDoctor) };
    } finally {
      lease.release();
    }
  } catch (error) {
    return { kind: "error", message: describe(error) };
  }
}
