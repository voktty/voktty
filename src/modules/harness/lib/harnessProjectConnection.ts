import { remoteProjectKey } from "@/modules/connections/model/remoteProjects";
import {
  remoteSshConnectionForProfile,
  remoteSshEnvironmentId,
} from "@/modules/connections/model/remoteSshProfiles";
import type { HarnessRemoteEnv } from "@/modules/harness/lib/harnessEnvStore";
import { sameRemoteSessionConnection } from "@/modules/remote/sessionConnectionIdentity";
import type { SshConnection } from "@/modules/ssh/types";

export function harnessSshConnectionsMatch(
  left: SshConnection,
  right: SshConnection,
): boolean {
  if (left.id !== right.id) return false;
  try {
    return sameRemoteSessionConnection(
      remoteSshConnectionForProfile(left),
      remoteSshConnectionForProfile(right),
    );
  } catch {
    return false;
  }
}

export function harnessProjectConnectionMatches(
  env: HarnessRemoteEnv,
  profile: SshConnection,
  root: string,
): boolean {
  if (
    env.kind !== "ssh" ||
    env.sessionId === undefined ||
    !harnessSshConnectionsMatch(env.connection, profile)
  ) {
    return false;
  }
  try {
    const environmentId = remoteSshEnvironmentId(profile.id);
    return (
      remoteProjectKey(environmentId, env.root) ===
      remoteProjectKey(environmentId, root)
    );
  } catch {
    return false;
  }
}
