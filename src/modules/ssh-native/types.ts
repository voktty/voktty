/** Mirrors of the DTOs in `src-tauri/src/modules/ssh_native`. */

export type SshNativeHop = {
  host: string;
  port?: number;
  user?: string;
  identityFile?: string;
};

export type SshNativeTarget = SshNativeHop & {
  jumps?: SshNativeHop[];
  legacyAlgorithms?: boolean;
};

/**
 * A password or passphrase only ever travels webview to Rust, typed by the
 * user in a prompt. Nothing in this shape is persisted or read back.
 */
export type SshCredential =
  | { kind: "agent" }
  | { kind: "privateKey"; path: string; passphrase?: string }
  | { kind: "password"; secret: string };

export type HostKeyApproval =
  | { kind: "none" }
  | { kind: "approve"; keyBase64: string; remember?: boolean };

export type SshErrorCode =
  | "unreachable"
  | "host_key_unknown"
  | "host_key_changed"
  | "host_key_revoked"
  | "auth_failed"
  | "timeout"
  | "protocol"
  | "cancelled"
  | "config";

export type HostKeyPrompt = {
  host: string;
  port: number;
  keyType: string;
  keyBase64: string;
  fingerprint: string;
  changed: boolean;
};

export type SshNativeError = {
  code: SshErrorCode;
  message: string;
  /** Present only for the host key codes. */
  prompt?: HostKeyPrompt;
};

export type SshSessionInfo = {
  id: string;
  host: string;
  port: number;
  user: string;
  hops: number;
  consumers: number;
};

export type SftpHandleInfo = {
  handle: string;
  root: string;
};

export type NativeRemoteEntry = {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modifiedMs?: number;
  mode?: number;
};

export type NativeRemoteStat = {
  path: string;
  exists: boolean;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modifiedMs?: number;
  mode?: number;
};

/** The codes that mean the user has to look at a host key before continuing. */
export const HOST_KEY_CODES: readonly SshErrorCode[] = [
  "host_key_unknown",
  "host_key_changed",
  "host_key_revoked",
];
