import type { RemoteProject } from "@/modules/connections/model/remoteProjects";
import {
  parseRemotePath,
  relativeWithinProject,
  remotePath,
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
import {
  RemoteRequestError,
  requestRemoteResult,
} from "@/modules/remote/client";
import { parseProjectContentSearch } from "@/modules/remote/projectContentSearch";

let pending = 0;
const MAX_PENDING = 256;
type OwnedWorkspace = RemoteWorkspaceEnv & { sessionId: number };

function fileIndex(value: unknown): { files: string[]; truncated: boolean } {
  const fail = () => new Error("Invalid remote file index.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail();
  const { hits, truncated } = value as Record<string, unknown>;
  if (
    !Array.isArray(hits) ||
    hits.length > 2000 ||
    typeof truncated !== "boolean"
  )
    throw fail();
  const files = new Set<string>();
  let characters = 0;
  for (const hit of hits) {
    if (!hit || typeof hit !== "object" || Array.isArray(hit)) throw fail();
    const relative = (hit as Record<string, unknown>).rel;
    if (
      typeof relative !== "string" ||
      !relative ||
      relative.length > 32768 ||
      /[\\:\x00-\x1f\x7f]/.test(relative) ||
      relative.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw fail();
    characters += relative.length;
    if (characters > 4 * 1024 * 1024) throw fail();
    files.add(relative);
  }
  return { files: [...files], truncated };
}

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
    createText: (content: string, isCurrent: () => boolean) => {
      if (path.length > 32768 || content.length > 8 * 1024 * 1024)
        return Promise.reject(
          new Error("Invalid remote text creation target."),
        );
      const parts = relative.split("/");
      if (
        relative === "." ||
        parts.length > 128 ||
        parts.some(
          (part) =>
            !part ||
            part === "." ||
            part === ".." ||
            /[\\\x00-\x1f\x7f]/.test(part),
        ) ||
        new TextEncoder().encode(content).length > 8 * 1024 * 1024
      )
        return Promise.reject(
          new Error("Invalid remote text creation target."),
        );
      return run(isCurrent, async (workspace) => {
        let parent = "";
        for (const part of parts.slice(0, -1)) {
          parent = parent ? `${parent}/${part}` : part;
          assertProjectDocumentCurrent(isCurrent);
          try {
            const stat = await remoteStat(
              workspace,
              documentPath(workspace.root, parent),
            );
            assertProjectDocumentCurrent(isCurrent);
            if (stat.kind !== "dir")
              throw new Error("A parent path is not a directory.");
          } catch (error) {
            assertProjectDocumentCurrent(isCurrent);
            if (
              !(error instanceof RemoteRequestError) ||
              error.code !== "stat_failed"
            )
              throw error;
            try {
              await requestRemoteResult(workspace.sessionId, "fs.createDir", {
                path: parent,
              });
            } catch (createError) {
              assertProjectDocumentCurrent(isCurrent);
              const stat = await remoteStat(
                workspace,
                documentPath(workspace.root, parent),
              ).catch(() => undefined);
              assertProjectDocumentCurrent(isCurrent);
              if (stat?.kind !== "dir") throw createError;
            }
            assertProjectDocumentCurrent(isCurrent);
          }
        }
        assertProjectDocumentCurrent(isCurrent);
        await requestRemoteResult(workspace.sessionId, "fs.createFile", {
          path: relative,
        });
        assertProjectDocumentCurrent(isCurrent);
        await requestRemoteResult(workspace.sessionId, "fs.writeFile", {
          path: relative,
          content,
          expectedContent: "",
        });
        assertProjectDocumentCurrent(isCurrent);
      });
    },
    searchContent: (query: string, isCurrent: () => boolean) => {
      if (
        !query.trim() ||
        query.includes("\0") ||
        new TextEncoder().encode(query).length > 4096 ||
        path.length > 32768 ||
        /[\\\x00-\x1f\x7f]/.test(path) ||
        !projectRoot.startsWith("/") ||
        projectRoot.startsWith("//") ||
        parsed.hostPath.split("/").some((part) => part === "." || part === "..")
      )
        return Promise.reject(
          new Error("Invalid remote content search query."),
        );
      return run(isCurrent, async (workspace) => {
        const result = await requestRemoteResult<unknown>(
          workspace.sessionId,
          "fs.grep",
          {
            cwd: relative,
            pattern: query.trim(),
            include: [],
            exclude: [],
            caseSensitive: false,
            wholeWord: false,
            regex: false,
            showHidden: true,
            maxResults: 500,
          },
        );
        assertProjectDocumentCurrent(isCurrent);
        return parseProjectContentSearch(
          result,
          remotePath(parsed.environmentId, projectRoot),
        );
      });
    },
    listFiles: (isCurrent: () => boolean) => {
      if (
        path.length > 32768 ||
        /[\\\x00-\x1f\x7f]/.test(path) ||
        /[\\\x00-\x1f\x7f]/.test(projectRoot) ||
        !projectRoot.startsWith("/") ||
        projectRoot.startsWith("//") ||
        parsed.hostPath.split("/").some((part) => part === "." || part === "..")
      )
        return Promise.reject(new Error("Invalid remote file index root."));
      return run(isCurrent, async (workspace) =>
        fileIndex(
          await requestRemoteResult<unknown>(workspace.sessionId, "fs.glob", {
            cwd: relative,
            pattern: "**/*",
            maxResults: 2000,
          }),
        ),
      );
    },
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
