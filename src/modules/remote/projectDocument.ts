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
  type RemoteWorkspaceEnv,
} from "@/modules/remote/filesystem";
import { requestRemoteResult } from "@/modules/remote/client";

let pending = 0;
const MAX_PENDING = 256;
type OwnedWorkspace = RemoteWorkspaceEnv & { sessionId: number };

function documentPath(root: string, relative: string): string {
  const windows = /^[a-zA-Z]:[\\/]/.test(root) || root.startsWith("\\\\");
  const normalized = windows ? root.replace(/\\/g, "/") : root;
  if (
    !root ||
    root.includes("\0") ||
    (!root.startsWith("/") && !windows) ||
    normalized.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("Invalid remote document root.");
  }
  if (relative === ".") return root;
  const base = windows ? root.replace(/[\\/]+$/, "") : root.replace(/\/+$/, "");
  return `${base}/${relative}`;
}

export function assertProjectDocumentCurrent(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Error("Remote document request was retired.");
}

export function createProjectDocument(
  path: string,
  project: RemoteProject | undefined,
  profiles: SshConnection[],
) {
  const root = project?.cwd;
  const parsed = parseRemotePath(path);
  const relative =
    parsed && root !== undefined
      ? relativeWithinProject(root, parsed.hostPath)
      : undefined;
  if (
    !parsed ||
    !project ||
    project.environmentId !== parsed.environmentId ||
    root === undefined ||
    relative === undefined
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
  const projectRoot = root;

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
        { profileId: captured.id, root: projectRoot },
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
      return run(isCurrent, (workspace) =>
        requestRemoteResult<unknown>(workspace.sessionId, "fs.searchNames", {
          cwd: relative,
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
        const target = documentPath(workspace.root, relative);
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
      run(isCurrent, (workspace) =>
        remoteReadBinaryFile(workspace, documentPath(workspace.root, relative)),
      ),
    read: (preferBinary: boolean, isCurrent: () => boolean) =>
      run(isCurrent, (workspace) =>
        remoteReadDocument(
          workspace,
          documentPath(workspace.root, relative),
          preferBinary,
        ),
      ),
    stat: (isCurrent: () => boolean) =>
      run(isCurrent, (workspace) =>
        remoteStat(workspace, documentPath(workspace.root, relative)),
      ),
    write: (
      content: string,
      isCurrent: () => boolean,
      expectedContent?: string,
    ) =>
      run(isCurrent, async (workspace) => {
        const path = documentPath(workspace.root, relative);
        await requestRemoteResult(workspace.sessionId, "fs.writeFile", {
          path: relative,
          content,
          ...(expectedContent === undefined ? {} : { expectedContent }),
        });
        assertProjectDocumentCurrent(isCurrent);
        return (await remoteStat(workspace, path)).mtime;
      }),
  };
}
