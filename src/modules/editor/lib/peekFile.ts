import {
  isPathInRemoteWorkspace,
  remoteReadFile,
  remoteStat,
} from "@/modules/remote";
import {
  currentWorkspaceEnv,
  workspaceForNativeFs,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";

type FileStat = { size: number; mtime: number; kind: string };

type ReadResult =
  | { kind: "text"; content: string; size: number; mtime: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type PeekFileResult =
  | { status: "ready"; content: string }
  | { status: "binary" | "tooLarge" };

export const MAX_PEEK_FILE_BYTES = 2 * 1024 * 1024;

export async function readPeekFile(
  path: string,
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
): Promise<PeekFileResult> {
  if (isPathInRemoteWorkspace(workspace, path)) {
    const stat = await remoteStat(workspace, path);
    if (stat.kind !== "file") return { status: "binary" };
    if (stat.size > MAX_PEEK_FILE_BYTES) return { status: "tooLarge" };
    const result = await remoteReadFile(workspace, path);
    return { status: "ready", content: result.content };
  }

  const stat = await invoke<FileStat>("fs_stat", {
    path,
    workspace: workspaceForNativeFs(workspace, path),
  });
  if (stat.kind !== "file") return { status: "binary" };
  if (stat.size > MAX_PEEK_FILE_BYTES) return { status: "tooLarge" };
  const result = await invoke<ReadResult>("fs_read_file", {
    path,
    workspace: workspaceForNativeFs(workspace, path),
    force: false,
  });
  if (result.kind === "binary") return { status: "binary" };
  if (result.kind === "toolarge") return { status: "tooLarge" };
  return { status: "ready", content: result.content };
}
