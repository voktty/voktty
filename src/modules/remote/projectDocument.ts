import type { RemoteProject } from "@/modules/connections/model/remoteProjects";
import {
  parseRemotePath,
  relativeWithinProject,
} from "@/modules/connections/model/remoteProjects";
import {
  findSshProfile,
  remoteSshConnectionForProfile,
} from "@/modules/connections/model/remoteSshProfiles";
import type { SshConnection } from "@/modules/ssh/types";
import { remoteSessions } from "@/modules/remote/sessionManager";
import {
  remoteCanonicalize,
  remoteReadDocument,
  remoteReadBinaryFile,
  remoteStat,
  remoteRelativePath,
  type RemoteWorkspaceEnv,
} from "@/modules/remote/filesystem";
import { requestRemoteResult } from "@/modules/remote/client";

let pending = 0;
const MAX_PENDING = 256;
type OwnedWorkspace = RemoteWorkspaceEnv & { sessionId: number };

export function assertProjectDocumentCurrent(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Error("Remote document request was retired.");
}

export function createProjectDocument(
  path: string,
  project: RemoteProject | undefined,
  profiles: SshConnection[],
) {
  const parsed = parseRemotePath(path);
  if (
    !parsed ||
    !project ||
    project.environmentId !== parsed.environmentId ||
    relativeWithinProject(project.cwd, parsed.hostPath) === undefined
  ) {
    throw new Error("The document is outside a saved remote project.");
  }
  const profile = findSshProfile(parsed.environmentId, profiles, {
    kind: "local",
  });
  if (!profile)
    throw new Error("The saved SSH connection for this document is missing.");
  const captured = { ...profile };
  const connection = remoteSshConnectionForProfile(captured);
  const root = project.cwd;
  const hostPath = parsed.hostPath;

  async function run<T>(
    isCurrent: () => boolean,
    task: (workspace: OwnedWorkspace) => Promise<T>,
  ): Promise<T> {
    assertProjectDocumentCurrent(isCurrent);
    if (pending >= MAX_PENDING)
      throw new Error("Remote document request capacity exceeded.");
    pending++;
    try {
      const lease = await remoteSessions.acquire(
        { profileId: captured.id, root },
        { ...connection },
      );
      try {
        assertProjectDocumentCurrent(isCurrent);
        const result = await task({
          kind: "ssh",
          connection: { ...captured },
          root: lease.info.workspace_root,
          sessionId: lease.info.session_id,
        });
        assertProjectDocumentCurrent(isCurrent);
        return result;
      } finally {
        lease.release();
      }
    } finally {
      pending--;
    }
  }

  return {
    searchNames: (
      query: string,
      showHidden: boolean,
      isCurrent: () => boolean,
    ) => {
      if (
        !query.trim() ||
        query.includes("\0") ||
        new TextEncoder().encode(query).length > 4096
      )
        return Promise.reject(new Error("Invalid filename search query."));
      const cwd = relativeWithinProject(root, hostPath);
      if (cwd === undefined)
        return Promise.reject(new Error("Search is outside its project."));
      return run(isCurrent, (workspace) =>
        requestRemoteResult<unknown>(workspace.sessionId, "fs.searchNames", {
          cwd,
          query,
          showHidden,
          maxResults: 200,
        }),
      );
    },
    readReference: (
      isCurrent: () => boolean,
      allowPath: (canonical: string) => boolean,
      maxBytes: number,
    ) =>
      run(isCurrent, async (workspace) => {
        const relative = relativeWithinProject(root, hostPath);
        if (relative === undefined)
          throw new Error("Reference is outside its project.");
        const target = `${workspace.root.replace(/[/\\]+$/, "")}/${relative}`;
        const canonical = await remoteCanonicalize(workspace, target);
        assertProjectDocumentCurrent(isCurrent);
        if (
          relativeWithinProject(workspace.root, canonical) === undefined ||
          !allowPath(canonical)
        )
          return;
        const stat = await remoteStat(workspace, canonical);
        assertProjectDocumentCurrent(isCurrent);
        if (stat.kind !== "file" || stat.size > maxBytes) return;
        return remoteReadDocument(workspace, canonical, false);
      }),
    readBinary: (isCurrent: () => boolean) =>
      run(isCurrent, (workspace) => remoteReadBinaryFile(workspace, hostPath)),
    read: (preferBinary: boolean, isCurrent: () => boolean) =>
      run(isCurrent, (workspace) =>
        remoteReadDocument(workspace, hostPath, preferBinary),
      ),
    stat: (isCurrent: () => boolean) =>
      run(isCurrent, (workspace) => remoteStat(workspace, hostPath)),
    write: (
      content: string,
      isCurrent: () => boolean,
      expectedContent?: string,
    ) =>
      run(isCurrent, async (workspace) => {
        await requestRemoteResult(workspace.sessionId, "fs.writeFile", {
          path: remoteRelativePath(workspace, hostPath),
          content,
          ...(expectedContent === undefined ? {} : { expectedContent }),
        });
        assertProjectDocumentCurrent(isCurrent);
        return (await remoteStat(workspace, hostPath)).mtime;
      }),
  };
}
