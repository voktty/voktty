import type { Tab } from "@/modules/tabs";
import {
  isPathWithinRemoteRoot,
  type RemoteSessionInfo,
  type RemoteSshConnection,
} from "@/modules/remote";
import { type WorkspaceEnv, workspaceScopeKey } from "@/modules/workspace";

type OpenRemoteWorkspace = (
  connection: RemoteSshConnection,
  workspaceRoot?: string,
) => Promise<RemoteSessionInfo>;

export async function prepareRemoteExplorerEnv(
  workspaceEnv: WorkspaceEnv,
  cwd: string,
  openRemoteWorkspace: OpenRemoteWorkspace,
): Promise<{ workspaceEnv: WorkspaceEnv; opened: boolean }> {
  if (workspaceEnv.kind !== "ssh") {
    return { workspaceEnv, opened: false };
  }
  if (workspaceEnv.sessionId === undefined) {
    const session = await openRemoteWorkspace(
      workspaceEnv.connection,
      cwd || "/",
    );
    return {
      workspaceEnv: {
        ...workspaceEnv,
        root: session.workspace_root,
        sessionId: session.session_id,
      },
      opened: true,
    };
  }
  if (isPathWithinRemoteRoot(workspaceEnv, cwd)) {
    return { workspaceEnv, opened: false };
  }
  // The remote cwd moved outside the session's current root (e.g. `cd` from
  // ~/project to /opt/data): widen to "/" instead of the new cwd itself, so
  // navigating elsewhere later on the same host never needs another session.
  const session = await openRemoteWorkspace(workspaceEnv.connection, "/");
  return {
    workspaceEnv: {
      ...workspaceEnv,
      root: session.workspace_root,
      sessionId: session.session_id,
    },
    opened: true,
  };
}

export function explorerNavigationScopeKey(env: WorkspaceEnv): string {
  if (env.kind === "ssh") return `ssh:${env.connection.id}`;
  return workspaceScopeKey(env);
}

export function planRemoteExplorerSessionRelease(
  environments: ReadonlyMap<number, WorkspaceEnv>,
  closingTabIds: readonly number[],
  tabs?: readonly Tab[],
  spaces?: readonly { env?: WorkspaceEnv }[],
): number[] {
  const closing = new Set(closingTabIds);
  const survivingSessions = new Set<number>();
  const closingSessions = new Set<number>();
  for (const [tabId, environment] of environments) {
    if (environment.kind !== "ssh" || environment.sessionId === undefined) {
      continue;
    }
    (closing.has(tabId) ? closingSessions : survivingSessions).add(
      environment.sessionId,
    );
  }
  if (tabs) {
    for (const tab of tabs) {
      if (closing.has(tab.id)) continue;
      if (
        "workspaceEnv" in tab &&
        tab.workspaceEnv?.kind === "ssh" &&
        tab.workspaceEnv.sessionId !== undefined
      ) {
        survivingSessions.add(tab.workspaceEnv.sessionId);
      }
    }
  }
  if (spaces) {
    for (const space of spaces) {
      if (space.env?.kind === "ssh" && space.env.sessionId !== undefined) {
        survivingSessions.add(space.env.sessionId);
      }
    }
  }
  return [...closingSessions].filter(
    (sessionId) => !survivingSessions.has(sessionId),
  );
}

