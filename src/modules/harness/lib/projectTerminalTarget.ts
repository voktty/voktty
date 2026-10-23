import { remoteSessions } from "@/modules/remote/sessionManager";
import type { RemoteSessionLease } from "@/modules/remote/sessionPool";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  parseRemotePath,
  relativeWithinProject,
  remoteProjectForPath,
  remoteProjectKey,
} from "@/modules/connections/model/remoteProjects";
import {
  findSshProfile,
  remoteSshConnectionForProfile,
} from "@/modules/connections/model/remoteSshProfiles";
import {
  shouldPickSshMultiplexer,
  sshMultiplexerSettingsForSelection,
  type SshMultiplexerSelection,
} from "@/modules/ssh/multiplexerSelection";
import {
  probeSshMultiplexer,
  type RemoteMultiplexerProbe,
  type SshConnection,
} from "@/modules/ssh/types";
import {
  harnessProjectEnvironmentFor,
  useHarnessProjectEnvStore,
} from "@/modules/harness/lib/harnessEnvStore";

export type SshMultiplexerPicker = (
  connection: SshConnection,
  probe: RemoteMultiplexerProbe,
) => Promise<SshMultiplexerSelection | null>;

export type ProjectTerminalTarget = {
  cwd: string;
  workspace: Extract<WorkspaceEnv, { kind: "ssh" }>;
  lease: RemoteSessionLease;
  acquireSibling?: (cwd: string) => Promise<ProjectTerminalTarget>;
};

export async function openProjectTerminalTarget(
  cwd: string,
  multiplexerPicker?: SshMultiplexerPicker,
  isCurrent: () => boolean = () => true,
): Promise<ProjectTerminalTarget | undefined> {
  if (!isCurrent()) return undefined;
  const remotePath = parseRemotePath(cwd);
  if (!remotePath) {
    if (cwd.startsWith("remote://")) {
      throw new Error("Remote terminal path is invalid.");
    }
    return undefined;
  }

  const project = remoteProjectForPath(cwd);
  if (project && project.environmentId !== remotePath.environmentId) {
    throw new Error("Remote terminal path is outside a saved project.");
  }

  let root = project?.cwd ?? remotePath.hostPath;
  let profile = findSshProfile(remotePath.environmentId, undefined, {
    kind: "local",
  });
  if (!profile) {
    const projectId = remoteProjectKey(remotePath.environmentId, root);
    const scoped = harnessProjectEnvironmentFor(
      projectId,
      useHarnessProjectEnvStore.getState().projects,
    ).env;
    if (
      scoped.kind === "ssh" &&
      scoped.sessionId !== undefined &&
      remoteProjectKey(remotePath.environmentId, scoped.root) === projectId &&
      relativeWithinProject(scoped.root, remotePath.hostPath) !== undefined
    ) {
      profile = findSshProfile(remotePath.environmentId, [scoped.connection], {
        kind: "local",
      });
      if (profile) root = scoped.root;
    }
  }
  if (!profile) {
    throw new Error("The saved SSH connection for this project is missing.");
  }

  const capturedProfile = { ...profile };
  const connection = remoteSshConnectionForProfile(capturedProfile);
  let selectedProfile = capturedProfile;
  if (multiplexerPicker && capturedProfile.multiplexerMode !== "none") {
    const probe = await probeSshMultiplexer({ ...capturedProfile }).catch(
      () => undefined,
    );
    if (!isCurrent()) return undefined;
    if (probe && shouldPickSshMultiplexer(capturedProfile, probe)) {
      const selection = await multiplexerPicker({ ...capturedProfile }, probe);
      if (!isCurrent()) return undefined;
      if (!selection) throw new Error("SSH terminal connection was canceled.");
      selectedProfile = {
        ...capturedProfile,
        ...sshMultiplexerSettingsForSelection(capturedProfile, selection),
      };
    }
  }

  if (!isCurrent()) return undefined;
  const lease = await remoteSessions.acquire(
    { profileId: capturedProfile.id, root },
    connection,
  );
  const capturedRoot = root;
  const terminalProfile = { ...selectedProfile };
  const materialize = (
    folder: string,
    ownedLease: RemoteSessionLease,
  ): ProjectTerminalTarget => ({
    cwd: folder,
    workspace: {
      kind: "ssh",
      connection: { ...terminalProfile },
      root: ownedLease.info.workspace_root,
      sessionId: ownedLease.info.session_id,
    },
    lease: ownedLease,
    acquireSibling: async (folder) =>
      materialize(
        folder,
        await remoteSessions.acquire(
          { profileId: capturedProfile.id, root: capturedRoot },
          { ...connection },
        ),
      ),
  });
  return materialize(remotePath.hostPath, lease);
}
