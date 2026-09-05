import { IS_WINDOWS } from "@/lib/platform";
import {
  RemoteRequestError,
  requestRemoteResult,
  type RemoteSshConnection,
} from "./client";
import { isWslWorkspacePath, type WorkspaceEnv } from "@/modules/workspace";
import { toDirEntries, toFileStat } from "@/modules/ssh-native/adapt";
import { nativeHandleFor } from "@/modules/ssh-native/handles";
import { SshNativeCallError } from "@/modules/ssh-native/client";
import {
  sftpCreateDir,
  sftpCreateFile,
  sftpDelete,
  sftpReadBinary,
  sftpReadDir,
  sftpReadText,
  sftpRename,
  sftpStat,
  sftpWriteText,
} from "@/modules/ssh-native/client";

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

export function isWindowsLocalPath(path: string): boolean {
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
  if (!env || env.kind === "local") {
    if (isWindowsLocalPath(path)) return true;
    if (path.startsWith("/") || path === ".") {
      return !IS_WINDOWS;
    }
    return true;
  }
  if (env.kind === "wsl") return isWslWorkspacePath(path);
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

/**
 * Pick the backend once per call and run the matching implementation.
 *
 * One dispatcher rather than a guard inside every operation, and the helper
 * stays the default: `nativeHandleFor` only answers when the preference asks
 * for the native backend and its handle actually opened.
 */
function withRemoteBackend<A extends unknown[], T>(
  native: (handle: string, ...args: A) => Promise<T>,
  helper: (env: RemoteWorkspaceEnv, ...args: A) => Promise<T>,
): (env: RemoteWorkspaceEnv, ...args: A) => Promise<T> {
  return async (env, ...args) => {
    const handle = await nativeHandleFor(env);
    return handle === undefined
      ? helper(env, ...args)
      : native(handle, ...args);
  };
}

export async function remoteCanonicalize(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<string> {
  await remoteStat(env, path);
  return normalizePath(path);
}

async function helperReadDir(
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

export const remoteReadDir = withRemoteBackend(
  async (handle, path: string) => toDirEntries(await sftpReadDir(handle, path)),
  helperReadDir,
);

function helperReadFile(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<RemoteFileText> {
  return requestRemoteResult<RemoteFileText>(requireSession(env), REMOTE_READ_FILE, {
    path: remoteRelativePath(env, path),
  });
}

export const remoteReadFile = withRemoteBackend(
  async (handle, path: string): Promise<RemoteFileText> => {
    const content = await sftpReadText(handle, path);
    const stat = await sftpStat(handle, path);
    return { content, size: stat.size, mtime: stat.modifiedMs ?? 0 };
  },
  helperReadFile,
);

function decodeBase64Bytes(contentBase64: string): Uint8Array {
  const decoded = globalThis.atob(contentBase64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

async function helperReadBinaryFile(
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

export const remoteReadBinaryFile = withRemoteBackend(
  async (handle, path: string): Promise<RemoteFileBinary> => {
    const bytes = decodeBase64Bytes(await sftpReadBinary(handle, path));
    const stat = await sftpStat(handle, path);
    return { bytes, size: bytes.length, mtime: stat.modifiedMs ?? 0 };
  },
  helperReadBinaryFile,
);

/** Both backends report "this is not text" with their own error shape. */
function isBinaryFileError(error: unknown): boolean {
  if (error instanceof RemoteRequestError) return error.code === "binary_file";
  if (error instanceof SshNativeCallError) return error.code === "binary_file";
  return false;
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
    if (!isBinaryFileError(error)) {
      throw error;
    }
    const stat = await remoteStat(env, path);
    return { kind: "binary", size: stat.size };
  }
}

async function helperWriteFile(
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

export const remoteWriteFile = withRemoteBackend(
  async (handle, path: string, content: string) => {
    await sftpWriteText(handle, path, content);
    return (await sftpStat(handle, path)).modifiedMs ?? 0;
  },
  helperWriteFile,
);

function helperStat(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<RemoteFileStat> {
  return requestRemoteResult<RemoteFileStat>(requireSession(env), REMOTE_STAT, {
    path: remoteRelativePath(env, path),
  });
}

export const remoteStat = withRemoteBackend(
  async (handle, path: string) => toFileStat(await sftpStat(handle, path)),
  helperStat,
);

function helperCreateFile(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<void> {
  return requestRemoteResult(requireSession(env), REMOTE_CREATE_FILE, {
    path: remoteRelativePath(env, path),
  }).then(() => undefined);
}

export const remoteCreateFile = withRemoteBackend(
  (handle, path: string) => sftpCreateFile(handle, path).then(() => undefined),
  helperCreateFile,
);

function helperCreateDir(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<void> {
  return requestRemoteResult(requireSession(env), REMOTE_CREATE_DIR, {
    path: remoteRelativePath(env, path),
  }).then(() => undefined);
}

export const remoteCreateDir = withRemoteBackend(
  (handle, path: string) => sftpCreateDir(handle, path).then(() => undefined),
  helperCreateDir,
);

function helperRename(
  env: RemoteWorkspaceEnv,
  from: string,
  to: string,
): Promise<void> {
  return requestRemoteResult(requireSession(env), REMOTE_RENAME, {
    from: remoteRelativePath(env, from),
    to: remoteRelativePath(env, to),
  }).then(() => undefined);
}

export const remoteRename = withRemoteBackend(
  (handle, from: string, to: string) =>
    sftpRename(handle, from, to).then(() => undefined),
  helperRename,
);

function helperDelete(
  env: RemoteWorkspaceEnv,
  path: string,
): Promise<void> {
  return requestRemoteResult(requireSession(env), REMOTE_DELETE, {
    path: remoteRelativePath(env, path),
  }).then(() => undefined);
}

export const remoteDelete = withRemoteBackend(
  (handle, path: string) => sftpDelete(handle, path).then(() => undefined),
  helperDelete,
);
