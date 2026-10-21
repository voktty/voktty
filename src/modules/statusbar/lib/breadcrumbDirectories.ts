import { invoke } from "@tauri-apps/api/core";
import { isPathInWorkspace, remoteReadDir } from "@/modules/remote/filesystem";
import { remoteSessions } from "@/modules/remote/sessionManager";
import {
  findSshProfile,
  remoteSshConnectionForProfile,
} from "@/modules/connections/model/remoteSshProfiles";
import {
  parseRemotePath,
  relativeWithinProject,
  remoteProjectForPath,
  remoteProjectKey,
} from "@/modules/connections/model/remoteProjects";
import {
  harnessProjectEnvironmentFor,
  useHarnessProjectEnvStore,
} from "@/modules/harness/lib/harnessEnvStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type WorkspaceEnv,
  workspaceEnvForNativePty,
  workspaceForNativeFs,
} from "@/modules/workspace";

export function breadcrumbRemoteReadRoot(path: string, root?: string): string {
  if (root && (path === "." || relativeWithinProject(root, path) !== undefined))
    return root;
  const normalized = path.replace(/\\/g, "/");
  const drive = normalized.match(/^([A-Za-z]:)(?:\/|$)/)?.[1];
  if (drive) return `${drive}/`;
  const share = normalized.match(/^(\/\/[^/]+\/[^/]+)(?:\/|$)/)?.[1];
  if (share) return share;
  return normalized.startsWith("/") ? "/" : root || ".";
}

function sshWorkspaceForRead(path: string, workspace?: WorkspaceEnv) {
  const parsed = parseRemotePath(path);
  if (!parsed) {
    if (path.startsWith("remote://"))
      throw new Error("Remote directory path is invalid.");
    return workspace?.kind === "ssh" && isPathInWorkspace(workspace, path)
      ? workspace
      : undefined;
  }
  const local = { kind: "local" as const };
  if (
    workspace?.kind === "ssh" &&
    findSshProfile(parsed.environmentId, [workspace.connection], local)?.id ===
      workspace.connection.id
  ) {
    return workspace;
  }
  const project = remoteProjectForPath(path);
  const projectId = remoteProjectKey(
    parsed.environmentId,
    project?.cwd ?? parsed.hostPath,
  );
  const scoped = harnessProjectEnvironmentFor(
    projectId,
    useHarnessProjectEnvStore.getState().projects,
  ).env;
  const configured = findSshProfile(
    parsed.environmentId,
    usePreferencesStore.getState().sshConnections ?? [],
    local,
  );
  const scopedMatch =
    scoped.kind === "ssh" &&
    scoped.sessionId !== undefined &&
    remoteProjectKey(parsed.environmentId, scoped.root) === projectId &&
    relativeWithinProject(scoped.root, parsed.hostPath) !== undefined;
  const profile =
    configured ??
    (scopedMatch && scoped.kind === "ssh"
      ? findSshProfile(parsed.environmentId, [scoped.connection], local)
      : undefined);
  if (!profile)
    throw new Error(
      "The configured SSH connection for this directory is missing.",
    );
  return {
    kind: "ssh" as const,
    connection: profile,
    root:
      scopedMatch &&
      scoped.kind === "ssh" &&
      scoped.connection.id === profile.id
        ? scoped.root
        : (project?.cwd ?? breadcrumbRemoteReadRoot(parsed.hostPath)),
  };
}

export async function readBreadcrumbDirectories(
  path: string,
  workspace: WorkspaceEnv | undefined,
  showHidden: boolean,
): Promise<string[]> {
  const ssh = sshWorkspaceForRead(path, workspace);
  if (ssh) {
    const hostPath = parseRemotePath(path)?.hostPath ?? path;
    const connection = Object.freeze({ ...ssh.connection });
    const lease = await remoteSessions.acquire(
      {
        profileId: connection.id,
        root: breadcrumbRemoteReadRoot(hostPath, ssh.root),
      },
      remoteSshConnectionForProfile(connection),
    );
    try {
      const directories = await remoteReadDir(
        {
          kind: "ssh",
          connection,
          root: lease.info.workspace_root,
          sessionId: lease.info.session_id,
        },
        path,
      );
      return directories
        .filter(
          (entry) =>
            entry.kind === "dir" && (showHidden || !entry.name.startsWith(".")),
        )
        .map((entry) => entry.name);
    } finally {
      lease.release();
      const live = remoteSessions
        .snapshot()
        .find((entry) => entry.sessionId === lease.info.session_id);
      if (live?.leases === 0)
        await remoteSessions.closeSession(lease.info.session_id);
    }
  }
  if (workspace?.kind === "docker") {
    const entries = await invoke<Array<{ name: string; kind: string }>>(
      "fs_read_dir",
      {
        path,
        showHidden,
        gitDecorations: false,
        workspace: workspaceEnvForNativePty(workspace),
      },
    );
    return entries
      .filter((entry) => entry.kind === "dir")
      .map((entry) => entry.name);
  }
  return invoke<string[]>("list_subdirs", {
    path,
    showHidden,
    workspace: workspaceForNativeFs(workspace, path),
  });
}
