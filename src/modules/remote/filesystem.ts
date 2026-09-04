import {
  RemoteRequestError,
  requestRemoteResult,
  type RemoteSshConnection,
} from "./client";
import { isWslWorkspacePath, type WorkspaceEnv } from "@/modules/workspace";

const REMOTE_LIST_DIR = "fs.readDir";
const REMOTE_READ_FILE = "fs.readFile";
const REMOTE_READ_BINARY_FILE = "fs.readBinaryFile";
const REMOTE_WRITE_FILE = "fs.writeFile";
const REMOTE_STAT = "fs.stat";
const REMOTE_CREATE_FILE = "fs.createFile";
const REMOTE_CREATE_DIR = "fs.createDir";
const REMOTE_RENAME = "fs.rename";
const REMOTE_DELETE = "fs.delete";

export type RemoteDirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
};

export type RemoteFileText = {
  content: string;
  size: number;
  mtime: number;
};

export type RemoteFileBinary = {
  bytes: Uint8Array;
  size: number;
  mtime: number;
};

export type RemoteDocumentRead =
  | ({ kind: "text" } & RemoteFileText)
  | { kind: "binary"; size: number };

export type RemoteFileStat = {
  size: number;
  mtime: number;
  kind: "file" | "dir";
};

export type RemoteWorkspaceEnv = Extract<WorkspaceEnv, { kind: "ssh" }>;

function requireSession(env: RemoteWorkspaceEnv): number {
  if (env.sessionId === undefined) {
    throw new Error("remote workspace is not connected");
  }
  return env.sessionId;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function isWindowsLocalPath(path: string): boolean {
  return /^[a-zA-Z]:[/\\]|^\\\\/.test(path);
}

export function isPathInRemoteWorkspace(
  env: WorkspaceEnv | undefined,
  path: string,
): env is RemoteWorkspaceEnv {
  if (!env || env.kind !== "ssh") return false;
  if (isWindowsLocalPath(path)) return false;
  return path.startsWith("/") || path === "." || !path.includes(":");
}

export function isPathInWorkspace(
  env: WorkspaceEnv | undefined,
  path: string,
): boolean {
  if (env?.kind === "wsl") return isWslWorkspacePath(path);
  return isPathInRemoteWorkspace(env, path);
}

export function remoteRelativePath(
  env: RemoteWorkspaceEnv,
  path: string,
): string {
  const root = normalizePath(env.root).replace(/\/+$/, "") || "/";
  const candidate = normalizePath(path);
  if (candidate === "." || candidate === root) return ".";
  const prefix = root === "/" ? "/" : `${root}/`;
  if (candidate.startsWith(prefix)) {
    return candidate.slice(prefix.length) || ".";
  }
  return candidate;
}

export function remoteConnection(
  env: RemoteWorkspaceEnv,
): RemoteSshConnection {
  return env.connection;
}

export async function remoteCanonicalize(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<string> {
  await remoteStat(env, path);
  return normalizePath(path);
}

export async function remoteReadDir(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<RemoteDirEntry[]> {
  const result = await requestRemoteResult<{
    entries: Array<{
      name: string;
      kind: "directory" | "file" | "symlink";
      size: number;
      mtime: number;
    }>;
  }>(requireSession(env), REMOTE_LIST_DIR, {
    path: remoteRelativePath(env, path),
  });
  return result.entries.map((entry) => ({
    name: entry.name,
    kind: entry.kind === "directory" ? "dir" : entry.kind,
    size: entry.size,
    mtime: entry.mtime,
  }));
}

export function remoteReadFile(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<RemoteFileText> {
  return requestRemoteResult<RemoteFileText>(requireSession(env), REMOTE_READ_FILE, {
    path: remoteRelativePath(env, path),
  });
}

function decodeBase64Bytes(contentBase64: string): Uint8Array {
  const decoded = globalThis.atob(contentBase64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

export async function remoteReadBinaryFile(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<RemoteFileBinary> {
  const result = await requestRemoteResult<{
    contentBase64: string;
    size: number;
    mtime: number;
  }>(requireSession(env), REMOTE_READ_BINARY_FILE, {
    path: remoteRelativePath(env, path),
  });
  const bytes = decodeBase64Bytes(result.contentBase64);
  if (bytes.length !== result.size) {
    throw new Error("remote binary response size mismatch");
  }
  return { bytes, size: result.size, mtime: result.mtime };
}

export async function remoteReadDocument(
  env: RemoteWorkspaceEnv,
  path: string,
  preferBinary = false,
): Promise<RemoteDocumentRead> {
  if (preferBinary) {
    const stat = await remoteStat(env, path);
    return { kind: "binary", size: stat.size };
  }
  try {
    return { kind: "text", ...(await remoteReadFile(env, path)) };
  } catch (error) {
    if (!(error instanceof RemoteRequestError) || error.code !== "binary_file") {
      throw error;
    }
    const stat = await remoteStat(env, path);
    return { kind: "binary", size: stat.size };
  }
}

export async function remoteWriteFile(
  env: RemoteWorkspaceEnv,
  path: string,
  content: string,
): Promise<number> {
  await requestRemoteResult<{ path: string }>(requireSession(env), REMOTE_WRITE_FILE, {
    path: remoteRelativePath(env, path),
    content,
  });
  return (await remoteStat(env, path)).mtime;
}

export function remoteStat(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<RemoteFileStat> {
  return requestRemoteResult<RemoteFileStat>(requireSession(env), REMOTE_STAT, {
    path: remoteRelativePath(env, path),
  });
}

export function remoteCreateFile(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<void> {
  return requestRemoteResult(requireSession(env), REMOTE_CREATE_FILE, {
    path: remoteRelativePath(env, path),
  }).then(() => undefined);
}

export function remoteCreateDir(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<void> {
  return requestRemoteResult(requireSession(env), REMOTE_CREATE_DIR, {
    path: remoteRelativePath(env, path),
  }).then(() => undefined);
}

export function remoteRename(
  env: RemoteWorkspaceEnv,
  from: string,
  to: string,
): Promise<void> {
  return requestRemoteResult(requireSession(env), REMOTE_RENAME, {
    from: remoteRelativePath(env, from),
    to: remoteRelativePath(env, to),
  }).then(() => undefined);
}

export function remoteDelete(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<void> {
  return requestRemoteResult(requireSession(env), REMOTE_DELETE, {
    path: remoteRelativePath(env, path),
  }).then(() => undefined);
}
