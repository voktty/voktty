import { invoke } from "@tauri-apps/api/core";
import { IS_WINDOWS } from "@/lib/platform";
import {
  isWindowsNativePath,
  workspaceForDocumentPath,
  type WorkspaceEnv,
} from "@/modules/workspace";

export type FilenameHit = {
  path: string;
  rel: string;
  name: string;
  is_dir: boolean;
};

export type FilenameResult = { hits: FilenameHit[]; truncated: boolean };

export class FilenameSearchUnavailableError extends Error {}

function posixAbsolute(path: string): boolean {
  return (
    path.length <= 32768 &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("\0") &&
    !path.split("/").some((part) => part === "." || part === "..")
  );
}

function target(workspace: WorkspaceEnv, root: string) {
  if (root.startsWith("remote://")) return null;
  const owner = workspaceForDocumentPath(workspace, root);
  if (
    isWindowsNativePath(root) ||
    (workspace.kind !== "docker" &&
      workspace.kind !== "serial" &&
      (owner.kind === "local" || (owner.kind === "wsl" && IS_WINDOWS)))
  )
    return { kind: "native" as const, workspace: owner };
  if (
    owner.kind !== "ssh" ||
    owner.sessionId === undefined ||
    !Number.isSafeInteger(owner.sessionId) ||
    owner.sessionId <= 0
  )
    return null;
  const base = owner.root.replace(/\/+$/, "") || "/";
  const directory = root.replace(/\/+$/, "") || "/";
  const prefix = base === "/" ? "/" : `${base}/`;
  if (
    !posixAbsolute(base) ||
    !posixAbsolute(directory) ||
    (directory !== base && !directory.startsWith(prefix))
  )
    return null;
  return {
    kind: "ssh" as const,
    sessionId: owner.sessionId,
    directory,
    cwd: directory === base ? "." : directory.slice(prefix.length),
  };
}

export function canSearchFilenames(
  workspace: WorkspaceEnv,
  root: string,
): boolean {
  return target(workspace, root) !== null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decode(value: unknown, directory: string): FilenameResult {
  if (
    !record(value) ||
    !Array.isArray(value.hits) ||
    value.hits.length > 200 ||
    typeof value.truncated !== "boolean" ||
    new TextEncoder().encode(JSON.stringify(value)).length > 4 * 1024 * 1024
  )
    throw new Error("Invalid remote filename search response.");
  const seen = new Set<string>();
  const hits = value.hits.map((hit: unknown): FilenameHit => {
    if (
      !record(hit) ||
      typeof hit.rel !== "string" ||
      !hit.rel ||
      hit.rel.length > 32768 ||
      hit.rel.startsWith("/") ||
      hit.rel.includes("\0") ||
      hit.rel
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      typeof hit.is_dir !== "boolean" ||
      hit.name !== hit.rel.slice(hit.rel.lastIndexOf("/") + 1) ||
      "path" in hit ||
      seen.has(hit.rel)
    )
      throw new Error("Invalid remote filename search hit.");
    seen.add(hit.rel);
    return {
      rel: hit.rel,
      name: hit.name as string,
      is_dir: hit.is_dir,
      path: `${directory === "/" ? "" : directory}/${hit.rel}`,
    };
  });
  return { hits, truncated: value.truncated };
}

export async function searchFilenames(
  workspace: WorkspaceEnv,
  root: string,
  query: string,
  showHidden: boolean,
  isCurrent: () => boolean,
): Promise<FilenameResult> {
  const destination = target(workspace, root);
  if (!destination) throw new FilenameSearchUnavailableError();
  if (
    !query.trim() ||
    query.includes("\0") ||
    new TextEncoder().encode(query).length > 4096
  )
    throw new Error("Invalid filename search query.");
  if (!isCurrent()) throw new Error("Filename search retired.");
  if (destination.kind === "native")
    return invoke<FilenameResult>("fs_search", {
      root,
      query,
      limit: 200,
      showHidden,
      workspace: destination.workspace,
    });
  const { requestRemoteResult, RemoteRequestError } = await import(
    "@/modules/remote/client"
  );
  if (!isCurrent()) throw new Error("Filename search retired.");
  try {
    const response = await requestRemoteResult<unknown>(
      destination.sessionId,
      "fs.searchNames",
      {
        cwd: destination.cwd,
        query,
        showHidden,
        maxResults: 200,
      },
    );
    if (!isCurrent()) throw new Error("Filename search retired.");
    return decode(response, destination.directory);
  } catch (error) {
    if (
      error instanceof RemoteRequestError &&
      error.code === "method_not_found"
    )
      throw new FilenameSearchUnavailableError();
    throw error;
  }
}
