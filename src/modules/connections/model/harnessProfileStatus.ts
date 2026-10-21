import type { HarnessProjectEnvironmentEntry } from "@/modules/harness/lib/harnessEnvStore";
import { sameRemoteSessionConnection } from "@/modules/remote/sessionConnectionIdentity";
import type { RemoteSessionSnapshot } from "@/modules/remote/sessionPool";
import type { SshConnection } from "@/modules/ssh/types";
import { remoteProjectKey } from "@/modules/connections/model/remoteProjects";

export type HarnessProfileStatus = {
  phase: "none" | "connecting" | "ready" | "error";
  error: string | null;
};

const NONE: HarnessProfileStatus = { phase: "none", error: null };

function isLiveProject(
  project: HarnessProjectEnvironmentEntry,
  profile: SshConnection,
  pool: readonly RemoteSessionSnapshot[],
): boolean {
  const { env, identity } = project;
  return (
    env.kind === "ssh" &&
    env.connection.id === profile.id &&
    identity.resolvedRoot !== undefined &&
    remoteProjectKey(profile.id, env.root) ===
      remoteProjectKey(profile.id, identity.resolvedRoot) &&
    sameRemoteSessionConnection(env.connection, profile) &&
    env.sessionId !== undefined &&
    pool.some(
      (entry) =>
        entry.sessionId === env.sessionId &&
        entry.key.profileId === identity.profileId &&
        entry.key.root === identity.requestedRoot &&
        entry.leases > 0 &&
        entry.state.phase === "ready",
    )
  );
}

/** Presentation only: a live root takes precedence over another root's attempt. */
export function harnessProfileStatus(
  profile: SshConnection,
  projects: Readonly<Record<string, HarnessProjectEnvironmentEntry>>,
  pool: readonly RemoteSessionSnapshot[],
): HarnessProfileStatus {
  let result = NONE;
  for (const project of Object.values(projects)) {
    if (project.identity.profileId !== profile.id) continue;
    if (
      !project.connecting &&
      !project.error &&
      isLiveProject(project, profile, pool)
    ) {
      return { phase: "ready", error: null };
    }
    if (project.connecting) result = { phase: "connecting", error: null };
    else if (project.error && result.phase === "none") {
      result = { phase: "error", error: project.error };
    }
  }
  return result;
}
