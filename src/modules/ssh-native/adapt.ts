import type {
  RemoteDirEntry,
  RemoteFileStat,
} from "@/modules/remote";
import type {
  HostKeyPrompt,
  NativeRemoteEntry,
  NativeRemoteStat,
  SshCredential,
  SshErrorCode,
  SshNativeError,
  SshNativeHop,
  SshNativeTarget,
} from "./types";
import { HOST_KEY_CODES } from "./types";
import type { SshConnectionConfig } from "@/modules/workspace";

/**
 * Shape the native listing like the helper's, so the explorer keeps one entry
 * type whichever backend served it.
 *
 * A symlink stays a symlink rather than being reported as its target: the tree
 * draws it differently and following it is the user's choice.
 */
export function toDirEntry(entry: NativeRemoteEntry): RemoteDirEntry {
  return {
    name: entry.name,
    kind: entry.isSymlink ? "symlink" : entry.isDir ? "dir" : "file",
    size: entry.size,
    mtime: entry.modifiedMs ?? 0,
  };
}

export function toDirEntries(entries: NativeRemoteEntry[]): RemoteDirEntry[] {
  return entries.map(toDirEntry);
}

/**
 * The helper's stat has no "missing" case: a missing path is an error there,
 * so a native stat that reports `exists: false` is turned back into one.
 */
export function toFileStat(stat: NativeRemoteStat): RemoteFileStat {
  if (!stat.exists) {
    throw new Error(`no such path: ${stat.path}`);
  }
  return {
    size: stat.size,
    mtime: stat.modifiedMs ?? 0,
    kind: stat.isDir ? "dir" : "file",
  };
}

/** Tauri rejects with the serialized error struct; anything else is unexpected. */
export function isSshNativeError(value: unknown): value is SshNativeError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SshNativeError>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

export function toSshNativeError(value: unknown): SshNativeError {
  if (isSshNativeError(value)) return value;
  return {
    code: "protocol",
    message: value instanceof Error ? value.message : String(value),
  };
}

export function hostKeyPrompt(error: SshNativeError): HostKeyPrompt | undefined {
  return HOST_KEY_CODES.includes(error.code) ? error.prompt : undefined;
}

export function isHostKeyError(code: SshErrorCode): boolean {
  return HOST_KEY_CODES.includes(code);
}

/**
 * Build the connect target from a saved workspace connection, including its
 * `ProxyJump` chain.
 */
export function toTarget(connection: SshConnectionConfig): SshNativeTarget {
  const jumps = parseJumps(connection.extraArgs);
  return {
    host: connection.host,
    port: connection.port,
    user: connection.user,
    identityFile: connection.identityFile,
    ...(jumps.length > 0 ? { jumps } : {}),
  };
}

/**
 * Credentials the app can offer without asking anything: the agent first, then
 * the connection's own key. A password is never assembled here, because it
 * only exists after the user types it into a prompt.
 */
export function defaultCredentials(
  connection: SshConnectionConfig,
): SshCredential[] {
  const credentials: SshCredential[] = [{ kind: "agent" }];
  const identity = connection.identityFile?.trim();
  if (identity) {
    credentials.push({ kind: "privateKey", path: identity });
  }
  return credentials;
}

const JUMP_FLAG = /(?:^|\s)(?:-J|--jump)[=\s]+(\S+)/;

/** `user@host:port` hops, comma separated, exactly as OpenSSH accepts them. */
function parseJumps(extraArgs: string | undefined): SshNativeHop[] {
  const match = extraArgs?.match(JUMP_FLAG);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean)
    .map(parseHop);
}

function parseHop(spec: string): SshNativeHop {
  const at = spec.lastIndexOf("@");
  const user = at >= 0 ? spec.slice(0, at) : undefined;
  const hostPort = at >= 0 ? spec.slice(at + 1) : spec;
  const colon = hostPort.lastIndexOf(":");
  if (colon <= 0) {
    return { host: hostPort, ...(user ? { user } : {}) };
  }
  const port = Number.parseInt(hostPort.slice(colon + 1), 10);
  return {
    host: hostPort.slice(0, colon),
    ...(Number.isFinite(port) ? { port } : {}),
    ...(user ? { user } : {}),
  };
}
