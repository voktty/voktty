import { parseRemotePath } from "@/modules/connections/model/remoteProjects";
import { findSshProfile } from "@/modules/connections/model/remoteSshProfiles";
import type { SshConnection } from "@/modules/ssh/types";

export type ProjectUnavailableReason =
  | "missing-directory"
  | "host-unreachable"
  | "profile-missing";

export type RemoteAvailabilityPlan =
  | { kind: "skip" }
  | { kind: "profile-missing" }
  | { kind: "host"; key: string; host: string; port: number };

const SSH_ENVIRONMENT_PREFIX = "voktty-ssh-";
const JUMP_ARGUMENT = /(?:^|\s)(?:-J\b|-o\s*ProxyJump|-o\s*ProxyCommand)/i;

/**
 * Decides how a `remote://` project can be judged from this computer. Only a
 * saved SSH profile reached directly over TCP can be probed: a proxy or jump
 * host hides the real route, and other remote machines go through tunnels.
 * Those are never reported as unavailable on a guess.
 */
export function remoteAvailabilityPlan(
  path: string,
  savedConnections: readonly SshConnection[],
): RemoteAvailabilityPlan {
  const remote = parseRemotePath(path);
  if (!remote || !remote.environmentId.startsWith(SSH_ENVIRONMENT_PREFIX)) {
    return { kind: "skip" };
  }
  const profile = findSshProfile(
    remote.environmentId,
    [...savedConnections],
    { kind: "local" },
  );
  if (!profile) return { kind: "profile-missing" };
  if (profile.proxy?.enabled) return { kind: "skip" };
  if (profile.extraArgs && JUMP_ARGUMENT.test(profile.extraArgs)) {
    return { kind: "skip" };
  }
  const host = profile.host?.trim();
  if (!host) return { kind: "skip" };
  const port = profile.port ?? 22;
  return { kind: "host", key: `${host.toLowerCase()}:${port}`, host, port };
}

/** A project folder must be a directory: a file with that path is not a project. */
export function localDirectoryExists(
  infos: ReadonlyArray<{ isDir: boolean }> | null | undefined,
): boolean {
  return (infos ?? []).some((info) => Boolean(info) && info.isDir);
}
