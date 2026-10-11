import { invoke } from "@tauri-apps/api/core";
import { remoteMachineFor } from "@/modules/connections/model/connections";
import {
  remoteSshConnectionFor,
  remoteSshConnectionForProfile,
  remoteSshConnectionIdForEnvironment,
} from "@/modules/connections/model/remoteSshProfiles";
import {
  parseRemotePath,
  remoteProjectForPath,
  remotePath,
} from "@/modules/connections/model/remoteProjects";
import {
  closeRemoteWorkspace,
  openRemoteWorkspace,
  type RemoteSshConnection,
} from "@/modules/remote/client";
import {
  currentWorkspaceEnv,
  isWindowsNativePath,
  LOCAL_WORKSPACE,
} from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { notifyGitChanged } from "./fs";
import { isEqualOrInside, pathKey } from "./paths";
export { namedWorktreeBranch } from "./worktreeNaming";

export type Worktree = {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  locked: boolean;
  prunable: boolean;
  missing: boolean;
  dirty: boolean | null;
  unpushed: number | null;
  sessionIds: string[];
};

export type Worktrees = { worktrees: Worktree[]; defaultRoot: string };

type GitWorkspace =
  | { kind: "local" }
  | { kind: "wsl"; distro: string }
  | {
      kind: "ssh";
      root: string;
      sessionId: number;
      connection: { host: string; user?: string; port?: number };
    };

type OpenWorkspace = {
  cwd: string;
  workspace: GitWorkspace;
  environmentId?: string;
};

async function withGitWorkspace<T>(
  cwd: string,
  operation: (workspace: OpenWorkspace) => Promise<T>,
): Promise<T> {
  const remoteProject = parseRemotePath(cwd);
  if (remoteProject) {
    const project = remoteProjectForPath(cwd);
    if (!project || project.environmentId !== remoteProject.environmentId) {
      throw new Error("This path is outside a saved remote project.");
    }
    const savedConnections =
      usePreferencesStore.getState().sshConnections ?? [];
    const connectionId = remoteSshConnectionIdForEnvironment(
      project.environmentId,
    );
    let connection: RemoteSshConnection;
    if (connectionId) {
      const profile = savedConnections.find(
        (entry) => entry.id === connectionId,
      );
      if (!profile) {
        throw new Error(
          "The saved SSH connection for this project is missing.",
        );
      }
      connection = remoteSshConnectionForProfile(profile);
    } else {
      const machine = await remoteMachineFor(project.environmentId);
      if (!machine)
        throw new Error("The remote machine is no longer connected.");
      connection = remoteSshConnectionFor(machine, savedConnections);
    }
    const session = await openRemoteWorkspace(connection, project.cwd);
    const workspace: GitWorkspace = {
      kind: "ssh",
      root: session.workspace_root,
      sessionId: session.session_id,
      connection: {
        host: connection.host,
        ...(connection.user ? { user: connection.user } : {}),
        ...(connection.port ? { port: connection.port } : {}),
      },
    };
    try {
      return await operation({
        cwd: session.workspace_root,
        workspace,
        environmentId: project.environmentId,
      });
    } finally {
      await closeRemoteWorkspace(session.session_id).catch(() => undefined);
    }
  }

  let env = currentWorkspaceEnv();
  if (cwd && isWindowsNativePath(cwd) && env.kind !== "local") {
    env = LOCAL_WORKSPACE;
  }
  if (env.kind === "serial") {
    throw new Error("Git worktrees are unavailable in serial workspaces.");
  }
  if (env.kind === "docker") {
    throw new Error(
      "Git worktrees are unavailable in Docker workspaces until native container Git support is enabled.",
    );
  }
  if (env.kind !== "ssh") {
    return operation({ cwd, workspace: env });
  }

  if (env.sessionId) {
    return operation({
      cwd,
      workspace: {
        kind: "ssh",
        root: env.root,
        sessionId: env.sessionId,
        connection: {
          host: env.connection.host,
          ...(env.connection.user ? { user: env.connection.user } : {}),
          ...(env.connection.port ? { port: env.connection.port } : {}),
        },
      },
    });
  }

  const session = await openRemoteWorkspace(env.connection, cwd || env.root);
  try {
    return await operation({
      cwd,
      workspace: {
        kind: "ssh",
        root: session.workspace_root,
        sessionId: session.session_id,
        connection: {
          host: env.connection.host,
          ...(env.connection.user ? { user: env.connection.user } : {}),
          ...(env.connection.port ? { port: env.connection.port } : {}),
        },
      },
    });
  } finally {
    await closeRemoteWorkspace(session.session_id).catch(() => undefined);
  }
}

function remapWorktrees(result: Worktrees, environmentId?: string): Worktrees {
  if (!environmentId) return result;
  return {
    defaultRoot: remotePath(environmentId, result.defaultRoot),
    worktrees: result.worktrees.map((tree) => ({
      ...tree,
      path: remotePath(environmentId, tree.path),
    })),
  };
}

function remapWorktree(tree: Worktree, environmentId?: string): Worktree {
  return environmentId
    ? { ...tree, path: remotePath(environmentId, tree.path) }
    : tree;
}

function workspaceArgs(workspace: GitWorkspace) {
  return workspace.kind === "local" ? {} : { workspace };
}

export const listWorktrees = (cwd: string) =>
  withGitWorkspace(cwd, ({ cwd: nativeCwd, workspace, environmentId }) =>
    invoke<Worktrees>("git_worktrees", {
      cwd: nativeCwd,
      ...workspaceArgs(workspace),
    }).then((result) => remapWorktrees(result, environmentId)),
  );

export async function createWorktree(
  cwd: string,
  branch: string,
  base: string,
  existing: boolean,
): Promise<Worktree> {
  return withGitWorkspace(
    cwd,
    async ({ cwd: nativeCwd, workspace, environmentId }) => {
      const tree = await invoke<Worktree>("git_worktree_create", {
        cwd: nativeCwd,
        branch,
        base,
        existing,
        ...workspaceArgs(workspace),
      });
      notifyGitChanged();
      return remapWorktree(tree, environmentId);
    },
  );
}

export async function createOrchestrationWorktree(
  cwd: string,
  branch: string,
): Promise<Worktree> {
  const tree = await invoke<Worktree>("git_orchestration_worktree_create", {
    cwd,
    branch,
  });
  notifyGitChanged();
  return tree;
}

export async function renameWorktreeBranch(
  cwd: string,
  path: string,
  branch: string,
): Promise<Worktree> {
  const tree = await invoke<Worktree>("git_worktree_rename_branch", {
    cwd,
    path,
    branch,
  });
  notifyGitChanged();
  return tree;
}

export function temporaryWorktreeBranchName(
  id: string = crypto.randomUUID(),
): string {
  const token = id
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toLowerCase();
  return `mc/${token || Date.now().toString(36)}`;
}

export function orchestrationWorktreeBranchName(id: string): string {
  const token = id
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 12)
    .toLowerCase();
  return `mc/orch-${token || Date.now().toString(36)}`;
}

export async function removeWorktree(
  cwd: string,
  path: string,
  force = false,
): Promise<void> {
  const targetPath = worktreePathForProject(cwd, path);
  return withGitWorkspace(cwd, async ({ cwd: nativeCwd, workspace }) => {
    const result = await invoke<{ removed: boolean; reason?: string | null }>(
      "git_worktree_delete",
      {
        cwd: nativeCwd,
        path: targetPath,
        force,
        ...workspaceArgs(workspace),
      },
    );
    if (!result.removed) {
      throw new Error(result.reason || "The worktree was not removed.");
    }
    notifyGitChanged();
  });
}

export async function removeOrchestrationWorktree(
  cwd: string,
  path: string,
): Promise<{ sessionIds: string[]; projectCwd: string }> {
  const result = await invoke<{ sessionIds: string[]; projectCwd: string }>(
    "git_orchestration_worktree_remove",
    { cwd, path },
  );
  notifyGitChanged();
  return result;
}

export async function removeOrchestrationBranch(
  cwd: string,
  branch: string,
): Promise<void> {
  await invoke<void>("git_orchestration_branch_remove", { cwd, branch });
  notifyGitChanged();
}

/** Read-only preflight; final removal rechecks against Git's worktree list. */
export async function checkWorktreeRemoval(
  cwd: string,
  path: string,
  force: boolean,
): Promise<void> {
  worktreePathForProject(cwd, path);
  const { worktrees } = await listWorktrees(cwd);
  const tree = worktrees.find((entry) => pathKey(entry.path) === pathKey(path));
  if (!tree || tree.path !== path || tree.isMain) {
    throw new Error("The selected worktree is no longer available.");
  }
  if (tree.missing || tree.prunable) {
    throw new Error("The worktree folder is missing.");
  }
  if (tree.locked) {
    throw new Error("Unlock this worktree in Git first.");
  }
  if (!tree.branch) {
    throw new Error("Create a branch before removing this detached worktree.");
  }
  if (tree.dirty === null) {
    throw new Error("Worktree status is unavailable.");
  }
  if (!force && tree.dirty) {
    throw new Error("The worktree has uncommitted changes.");
  }
}

function worktreePathForProject(cwd: string, path: string): string {
  const project = parseRemotePath(cwd);
  const tree = parseRemotePath(path);
  if (!project) {
    if (tree) throw new Error("Worktrees must belong to the selected project.");
    return path;
  }
  if (!tree || tree.environmentId !== project.environmentId) {
    throw new Error("Worktrees must belong to the selected remote project.");
  }
  return tree.hostPath;
}

export function assertWorktreeFilesClosed(
  path: string,
  files: readonly { cwd: string; path?: string }[],
) {
  if (
    files.some(
      (file) =>
        isEqualOrInside(file.cwd, path) ||
        (file.path && isEqualOrInside(file.path, path)),
    )
  ) {
    throw new Error(
      "Close the files and terminals open in this worktree first.",
    );
  }
}

export function worktreeSessionIds(
  tree: Worktree,
  sessions: readonly {
    id: string;
    cwd: string;
    worktreeCwd?: string;
    worktreeRemoved?: boolean;
  }[],
): string[] {
  const ids = new Set(tree.sessionIds);
  for (const session of sessions) {
    // Live sessions override their last saved context.
    ids.delete(session.id);
    if (
      !session.worktreeRemoved &&
      isEqualOrInside(session.worktreeCwd || session.cwd, tree.path)
    ) {
      ids.add(session.id);
    }
  }
  return [...ids];
}

export const NO_BRANCH_LABEL = "No branch selected";

/** Keep the transcript and project identity while requiring a new working copy. */
export function detachSessionWorktree<
  T extends { cwd: string; worktreeCwd?: string },
>(session: T, projectCwd: string, path: string) {
  return {
    ...session,
    cwd: isEqualOrInside(session.cwd, path) ? projectCwd : session.cwd,
    worktreeCwd: session.worktreeCwd || session.cwd,
    worktreeRemoved: true,
    branch: undefined,
    providerSessionId: undefined,
    context: undefined,
    pendingSwitch: undefined,
    pendingQuestion: undefined,
    busy: false,
    queueStatus: "paused" as const,
  };
}

export type RemoveWorktree = (
  cwd: string,
  path: string,
  force: boolean,
) => Promise<void>;
