import { buildTools, type ToolContext } from "@/modules/ai/tools/tools";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import { agentShellSessions } from "@/modules/ai/lib/ownedShellSessions";
import { isLocalPath, type WorkspaceEnv } from "@/modules/workspace";
import {
  parseRemotePath,
  remoteProjectForPath,
} from "@/modules/connections/model/remoteProjects";
import {
  findSshProfile,
  remoteSshConnectionForProfile,
} from "@/modules/connections/model/remoteSshProfiles";
import { remoteSessions } from "@/modules/remote/sessionManager";
import type { RemoteWorkspaceEnv } from "@/modules/remote/filesystem";
import { usePreferencesStore } from "@/modules/settings/preferences";

/**
 * Where a session's tools act. Local projects use the folder itself; an SSH
 * project uses its path on the host through a helper session the turn holds.
 */
export type ApiToolTarget = Readonly<{
  root: string;
  workspace: WorkspaceEnv;
  /** Remote targets have no shell until the helper can run commands. */
  shell: boolean;
}>;

type Owner = {
  cwd: string;
  model: string;
  target: ApiToolTarget;
  context: ToolContext;
};
const owners = new Map<string, Owner>();

const LOCAL = Object.freeze({ kind: "local" as const });

/** The local target of a project folder, or null when it is not local. */
export function localApiToolTarget(cwd: string): ApiToolTarget | null {
  if (!isLocalPath(cwd) || cwd.startsWith("~")) return null;
  return { root: cwd, workspace: LOCAL, shell: true };
}

export type RemoteApiToolLease = Readonly<{
  target: ApiToolTarget;
  release: () => void;
}>;

/**
 * Holds a helper session for one turn of an SSH project and describes where
 * its tools act: the project's path on the host, inside the saved project
 * the session is rooted at. Null when the path is not a saved SSH project or
 * its connection is gone, so the turn can say so instead of guessing.
 */
export async function acquireRemoteApiTools(
  cwd: string,
): Promise<RemoteApiToolLease | null> {
  const parsed = parseRemotePath(cwd);
  const project = remoteProjectForPath(cwd);
  if (!parsed || !project) return null;
  const profile = findSshProfile(
    parsed.environmentId,
    usePreferencesStore.getState().sshConnections ?? [],
    LOCAL,
  );
  if (!profile) return null;
  const captured = { ...profile };
  const lease = await remoteSessions.acquire(
    { profileId: captured.id, root: project.cwd },
    remoteSshConnectionForProfile(captured),
  );
  let released = false;
  const workspace: RemoteWorkspaceEnv = {
    kind: "ssh",
    connection: captured,
    root: lease.info.workspace_root,
    sessionId: lease.info.session_id,
  };
  return {
    target: { root: parsed.hostPath, workspace, shell: false },
    release: () => {
      if (released) return;
      released = true;
      lease.release();
    },
  };
}

/**
 * The chat tool context of one Harness session. It stays the same across
 * turns so read-before-edit state survives, and follows the target of the
 * current turn (a remote turn brings a fresh helper session).
 */
export function apiToolContext(
  sessionId: string,
  cwd: string,
  model: string,
  target: ApiToolTarget | null = localApiToolTarget(cwd),
): ToolContext | null {
  if (!target) return null;
  const previous = owners.get(sessionId);
  if (previous?.cwd === cwd) {
    previous.model = model;
    previous.target = target;
    return previous.context;
  }
  if (previous) {
    fileToolCallsFor(previous.context).forget();
    void agentShellSessions.retire(previous.context).catch(() => {});
  }
  const owner = { cwd, model, target, context: undefined as unknown as ToolContext };
  const context: ToolContext = {
    getCwd: () => owner.target.root,
    getWorkspaceRoot: () => owner.target.root,
    getFileContext: () => ({
      directory: owner.target.root,
      workspace: owner.target.workspace,
    }),
    getFileRootContext: () => ({
      root: owner.target.root,
      workspace: owner.target.workspace,
    }),
    getModelId: () => owner.model,
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => sessionId,
  };
  owner.context = context;
  owners.set(sessionId, owner);
  return context;
}

export function buildApiTools(
  context: ToolContext,
  options: { shell?: boolean } = {},
) {
  const tools = buildTools(context);
  const files = {
    read_file: tools.read_file,
    list_directory: tools.list_directory,
    write_file: tools.write_file,
    create_directory: tools.create_directory,
    edit: tools.edit,
    multi_edit: tools.multi_edit,
    grep: tools.grep,
    glob: tools.glob,
  };
  return options.shell === false ? files : { ...files, bash_run: tools.bash_run };
}

export async function forgetApiTools(sessionId: string): Promise<void> {
  const owner = owners.get(sessionId);
  if (!owner) return;
  owners.delete(sessionId);
  fileToolCallsFor(owner.context).forget();
  await agentShellSessions.retire(owner.context);
}
