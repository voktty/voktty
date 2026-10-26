import {
  isPathInRemoteWorkspace,
  remoteReadFile,
  remoteStat,
} from "@/modules/remote";
import {
  isWindowsNativePath,
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
let pendingReads = 0;

export async function readPeekFile(
  path: string,
  environment: WorkspaceEnv,
  isCurrent: () => boolean = () => true,
): Promise<PeekFileResult> {
  const workspace = structuredClone(environment);
  const check = () => {
    if (!isCurrent()) throw new Error("Peek request was retired.");
  };
  check();
  if (
    path.startsWith("remote://") ||
    ((workspace.kind === "docker" || workspace.kind === "serial") &&
      !isWindowsNativePath(path))
  )
    throw new Error("Unsupported Peek filesystem.");
  if (pendingReads >= 256) throw new Error("Peek read capacity exceeded.");
  pendingReads++;
  try {
    if (isPathInRemoteWorkspace(workspace, path)) {
      const stat = await remoteStat(workspace, path);
      check();
      if (stat.kind !== "file") return { status: "binary" };
      if (stat.size > MAX_PEEK_FILE_BYTES) return { status: "tooLarge" };
      const result = await remoteReadFile(workspace, path);
      check();
      if (
        result.size > MAX_PEEK_FILE_BYTES ||
        result.content.length > MAX_PEEK_FILE_BYTES
      )
        return { status: "tooLarge" };
      return { status: "ready", content: result.content };
    }

    const stat = await invoke<FileStat>("fs_stat", {
      path,
      workspace: workspaceForNativeFs(workspace, path),
    });
    check();
    if (stat.kind !== "file") return { status: "binary" };
    if (stat.size > MAX_PEEK_FILE_BYTES) return { status: "tooLarge" };
    const result = await invoke<ReadResult>("fs_read_file", {
      path,
      workspace: workspaceForNativeFs(workspace, path),
      force: false,
    });
    check();
    if (result.kind === "binary") return { status: "binary" };
    if (result.kind === "toolarge") return { status: "tooLarge" };
    if (
      result.size > MAX_PEEK_FILE_BYTES ||
      result.content.length > MAX_PEEK_FILE_BYTES
    )
      return { status: "tooLarge" };
    return { status: "ready", content: result.content };
  } finally {
    pendingReads--;
  }
}
