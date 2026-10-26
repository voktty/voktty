import { invoke } from "@tauri-apps/api/core";
import { checkReadable } from "@/modules/ai/lib/security";
import { remoteProjectForPath } from "@/modules/connections/model/remoteProjects";
import { resolveRelativeDocPath } from "@/modules/markdown/lib/pathUtils";
import {
  isPathInRemoteWorkspace,
  remoteCanonicalize,
  remoteReadDocument,
  remoteStat,
} from "@/modules/remote";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type WorkspaceEnv,
  isWindowsNativePath,
  workspaceForDocumentPath,
  workspaceForNativeFs,
} from "@/modules/workspace";

const MAX_REFERENCE_BYTES = 1024 * 1024;
type FileStat = { size: number; kind: string };
type ReadResult = { kind: string; content?: string; size: number };

export function createInlineReferenceReader(
  documentPath: string | undefined,
  environment: WorkspaceEnv,
) {
  const workspace = structuredClone(environment);
  const namespace =
    documentPath?.replace(/\\/g, "/").startsWith("remote://") ?? false;
  const project = namespace
    ? remoteProjectForPath(documentPath ?? "")
    : undefined;
  const profiles = namespace
    ? (usePreferencesStore.getState().sshConnections ?? []).map((profile) => ({
        ...profile,
      }))
    : [];
  return async (
    mention: string,
    current: () => boolean,
  ): Promise<string | undefined> => {
    if (!current() || !documentPath || mention.length > 32768) return;
    const path = resolveRelativeDocPath(documentPath, mention);
    if (path.length > 32768 || !checkReadable(path).ok) return;
    let result: ReadResult;
    if (namespace) {
      if (!path.startsWith("remote://")) return;
      const { createProjectDocument } = await import(
        "@/modules/remote/projectDocument"
      );
      if (!current()) return;
      const document = createProjectDocument(path, project, profiles);
      const stat = await document.stat(current);
      if (!current() || stat.kind !== "file" || stat.size > MAX_REFERENCE_BYTES)
        return;
      result = await document.read(false, current);
    } else {
      if (!path.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(path)) return;
      if (
        /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) &&
        !/^[a-zA-Z]:[\\/]/.test(path)
      )
        return;
      if (
        (workspace.kind === "docker" || workspace.kind === "serial") &&
        !isWindowsNativePath(path)
      )
        return;
      const owner = workspaceForDocumentPath(workspace, path);
      const remote = isPathInRemoteWorkspace(owner, path);
      const nativeWorkspace = workspaceForNativeFs(owner, path);
      const canonical = remote
        ? await remoteCanonicalize(owner, path)
        : await invoke<string>("fs_canonicalize", {
            path,
            workspace: nativeWorkspace,
          });
      if (!current() || !checkReadable(canonical).ok) return;
      const stat = remote
        ? await remoteStat(owner, canonical)
        : await invoke<FileStat>("fs_stat", {
            path: canonical,
            workspace: nativeWorkspace,
          });
      if (!current() || stat.kind !== "file" || stat.size > MAX_REFERENCE_BYTES)
        return;
      result = remote
        ? await remoteReadDocument(owner, canonical, false)
        : await invoke<ReadResult>("fs_read_file", {
            path: canonical,
            workspace: nativeWorkspace,
          });
    }
    if (
      !current() ||
      result.kind !== "text" ||
      result.size > MAX_REFERENCE_BYTES
    )
      return;
    return result.content?.slice(0, 4000);
  };
}
