import { invoke } from "@tauri-apps/api/core";
import { toSshNativeError } from "./adapt";
import type {
  HostKeyApproval,
  HostKeyPrompt,
  NativeRemoteEntry,
  NativeRemoteStat,
  SftpHandleInfo,
  SshCredential,
  SshErrorCode,
  SshNativeError,
  SshNativeTarget,
  SshSessionInfo,
} from "./types";

/** Mirrors `RemoteRequestError`, so callers handle both backends alike. */
export class SshNativeCallError extends Error {
  constructor(readonly detail: SshNativeError) {
    super(detail.message);
    this.name = "SshNativeCallError";
  }

  get code(): SshErrorCode {
    return this.detail.code;
  }

  get prompt(): HostKeyPrompt | undefined {
    return this.detail.prompt;
  }
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new SshNativeCallError(toSshNativeError(error));
  }
}

export function sshNativeConnect(
  target: SshNativeTarget,
  credentials: SshCredential[],
  approval?: HostKeyApproval,
): Promise<SshSessionInfo> {
  return call("ssh_native_connect", { target, credentials, approval });
}

export function sshNativeDisconnect(sessionId: string): Promise<void> {
  return call("ssh_native_disconnect", { sessionId });
}

export function sshNativeSessions(): Promise<SshSessionInfo[]> {
  return call("ssh_native_sessions", {});
}

export function sftpOpen(sessionId: string, root?: string): Promise<SftpHandleInfo> {
  return call("ssh_native_sftp_open", { sessionId, root });
}

export function sftpClose(handle: string): Promise<void> {
  return call("ssh_native_sftp_close", { handle });
}

export function sftpReadDir(handle: string, path: string): Promise<NativeRemoteEntry[]> {
  return call("ssh_native_sftp_read_dir", { handle, path });
}

export function sftpStat(handle: string, path: string): Promise<NativeRemoteStat> {
  return call("ssh_native_sftp_stat", { handle, path });
}

export function sftpCanonicalize(handle: string, path: string): Promise<string> {
  return call("ssh_native_sftp_canonicalize", { handle, path });
}

export function sftpReadText(handle: string, path: string): Promise<string> {
  return call("ssh_native_sftp_read_text", { handle, path });
}

/** Base64, so binary bytes never pass through the UTF-8 document reader. */
export function sftpReadBinary(handle: string, path: string): Promise<string> {
  return call("ssh_native_sftp_read_binary", { handle, path });
}

export function sftpWriteText(
  handle: string,
  path: string,
  content: string,
): Promise<string> {
  return call("ssh_native_sftp_write_text", { handle, path, content });
}

export function sftpCreateDir(handle: string, path: string): Promise<string> {
  return call("ssh_native_sftp_create_dir", { handle, path });
}

export function sftpCreateFile(handle: string, path: string): Promise<string> {
  return call("ssh_native_sftp_create_file", { handle, path });
}

export function sftpRename(handle: string, from: string, to: string): Promise<string> {
  return call("ssh_native_sftp_rename", { handle, from, to });
}

/** Resolves to how many entries were removed. */
export function sftpDelete(handle: string, path: string): Promise<number> {
  return call("ssh_native_sftp_delete", { handle, path });
}
