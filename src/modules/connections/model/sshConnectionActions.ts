import type { SshConnection, SshSurface } from "@/modules/ssh/types";
import type { WorkspaceEnv } from "@/modules/workspace";
import { remoteSessions } from "@/modules/remote/sessionManager";
import type { RemoteSessionSnapshot } from "@/modules/remote/sessionPool";
import { useHarnessEnvStore } from "@/modules/harness/lib/harnessEnvStore";
import { registerSshProjectPath } from "./remoteProjectRegistration";
import { remotePath } from "./remoteProjects";
import { remoteSshEnvironmentId } from "./remoteSshProfiles";

/** Where a connected profile is shown: a terminal or the Harness GUI. */
export type ConnectionSurface = SshSurface;

export const OPEN_HARNESS_EVENT = "voktty:open-harness";
export const DISCONNECT_SSH_EVENT = "voktty:disconnect-ssh";

export function surfaceOf(profile: {
  defaultSurface?: ConnectionSurface;
}): ConnectionSurface {
  return profile.defaultSurface === "harness" ? "harness" : "terminal";
}

export function otherSurface(surface: ConnectionSurface): ConnectionSurface {
  return surface === "harness" ? "terminal" : "harness";
}

/** What currently keeps a saved profile connected. */
export type ProfileLinks = {
  workspace: boolean;
  harness: boolean;
  pooledSessions: number;
};

type HarnessEnvLike =
  | { kind: "local" }
  | { kind: "ssh"; connection: { id: string } };

export function profileLinks(
  profileId: string,
  state: {
    workspaceEnv: WorkspaceEnv;
    harnessEnv: HarnessEnvLike;
    pool: readonly RemoteSessionSnapshot[];
  },
  relatedIds: ReadonlySet<string> = new Set([profileId]),
): ProfileLinks {
  const ours = (id: string) => id === profileId || relatedIds.has(id);
  return {
    workspace:
      state.workspaceEnv.kind === "ssh" &&
      ours(state.workspaceEnv.connection.id),
    harness:
      state.harnessEnv.kind === "ssh" && ours(state.harnessEnv.connection.id),
    pooledSessions: state.pool.filter(
      (entry) => ours(entry.key.profileId) && entry.sessionId !== undefined,
    ).length,
  };
}

export function isProfileConnected(links: ProfileLinks): boolean {
  return links.workspace || links.harness || links.pooledSessions > 0;
}

export type SshRowAction = "open-terminal" | "open-harness" | "disconnect";

/** Opening is always possible; Disconnect only while something is connected. */
export function sshRowActions(links: ProfileLinks): SshRowAction[] {
  const actions: SshRowAction[] = ["open-terminal", "open-harness"];
  if (isProfileConnected(links)) actions.push("disconnect");
  return actions;
}

type SshTarget = { host: string; user?: string; port?: number };

const targetKey = (target: SshTarget) =>
  `${(target.user ?? "").trim().toLowerCase()}@${target.host.trim().toLowerCase()}:${target.port ?? 22}`;

export function sameSshTarget(left: SshTarget, right: SshTarget): boolean {
  return targetKey(left) === targetKey(right);
}

/**
 * Ids of every saved profile that reaches the same server as `profileId`.
 * Profiles are often saved twice (typed by hand and imported from ssh config),
 * and a connection opened through one must be closed through the other too.
 */
export function relatedProfileIds(
  profileId: string,
  saved: readonly (SshTarget & { id: string })[],
  extra: readonly (SshTarget & { id: string })[] = [],
): Set<string> {
  const all = [...saved, ...extra];
  const ids = new Set<string>([profileId]);
  const origin = all.find((profile) => profile.id === profileId);
  if (!origin) return ids;
  for (const profile of all) {
    if (sameSshTarget(profile, origin)) ids.add(profile.id);
  }
  return ids;
}

export function harnessProjectPath(profileId: string, root: string): string {
  return remotePath(remoteSshEnvironmentId(profileId), root);
}

/** Connects the profile for the Harness and asks the app to show its project. */
export async function openSshProfileInHarness(
  profile: SshConnection,
): Promise<string> {
  const env = await useHarnessEnvStore.getState().connect(profile);
  if (env.kind !== "ssh") {
    throw new Error("The Harness did not connect to the SSH profile.");
  }
  const path = harnessProjectPath(profile.id, env.root);
  registerSshProjectPath(path, [profile]);
  window.dispatchEvent(
    new CustomEvent(OPEN_HARNESS_EVENT, { detail: { path } }),
  );
  return path;
}

/** Closes every session a profile holds, whichever surface opened it. */
export async function closeSshProfileSessions(
  profileId: string,
  relatedIds: ReadonlySet<string> = new Set([profileId]),
): Promise<void> {
  const harness = useHarnessEnvStore.getState().env;
  if (
    harness.kind === "ssh" &&
    (relatedIds.has(harness.connection.id) ||
      harness.connection.id === profileId)
  ) {
    await useHarnessEnvStore.getState().disconnect();
  }
  await Promise.all(
    [...new Set([profileId, ...relatedIds])].map((id) =>
      remoteSessions.closeProfile(id),
    ),
  );
}

/** Asks the app to disconnect a profile: workspace terminals, Harness and pool. */
export function requestSshDisconnect(profileId: string): void {
  window.dispatchEvent(
    new CustomEvent(DISCONNECT_SSH_EVENT, { detail: { connectionId: profileId } }),
  );
}
