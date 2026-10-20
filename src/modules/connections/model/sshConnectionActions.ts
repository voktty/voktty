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
): ProfileLinks {
  return {
    workspace:
      state.workspaceEnv.kind === "ssh" &&
      state.workspaceEnv.connection.id === profileId,
    harness:
      state.harnessEnv.kind === "ssh" &&
      state.harnessEnv.connection.id === profileId,
    pooledSessions: state.pool.filter(
      (entry) =>
        entry.key.profileId === profileId && entry.sessionId !== undefined,
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
): Promise<void> {
  const harness = useHarnessEnvStore.getState().env;
  if (harness.kind === "ssh" && harness.connection.id === profileId) {
    await useHarnessEnvStore.getState().disconnect();
  }
  await remoteSessions.closeProfile(profileId);
}

/** Asks the app to disconnect a profile: workspace terminals, Harness and pool. */
export function requestSshDisconnect(profileId: string): void {
  window.dispatchEvent(
    new CustomEvent(DISCONNECT_SSH_EVENT, { detail: { connectionId: profileId } }),
  );
}
