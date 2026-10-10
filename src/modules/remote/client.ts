import { releaseNativeHandlesForRemoteSession } from "@/modules/ssh-native/handles";
import type { SshConnectionConfig } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";

export type RemoteSshConnection = SshConnectionConfig;
export const REMOTE_PROTOCOL_VERSION = 2 as const;

export type RemoteSessionInfo = {
  session_id: number;
  architecture: string;
  workspace_root: string;
  helper_version: string;
  capabilities: string[];
};

export type RemoteTunnelInfo = {
  tunnelId: number;
  localPort: number;
  remotePort: number;
};

export type RemoteOpenCodeServiceAction =
  | "version"
  | "status"
  | "start"
  | "password";

export type RemoteRequest = {
  protocol: typeof REMOTE_PROTOCOL_VERSION;
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type RemoteResponse = {
  protocol: number;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};

export class RemoteRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "RemoteRequestError";
  }
}

let requestSequence = 0;

export function nextRemoteRequestId(): string {
  requestSequence += 1;
  return `voktty-${Date.now()}-${requestSequence}`;
}

export function openRemoteWorkspace(
  connection: RemoteSshConnection,
  workspaceRoot?: string,
): Promise<RemoteSessionInfo> {
  return invoke<RemoteSessionInfo>("remote_open", {
    connection,
    workspaceRoot,
  });
}

export function requestRemote(
  sessionId: number,
  request: RemoteRequest,
): Promise<RemoteResponse> {
  return invoke<RemoteResponse>("remote_request", {
    sessionId,
    request,
  });
}

export function openRemoteTunnel(
  sessionId: number,
  remotePort: number,
): Promise<RemoteTunnelInfo> {
  return invoke<RemoteTunnelInfo>("remote_tunnel_open", {
    sessionId,
    remotePort,
  });
}

export function closeRemoteTunnel(
  sessionId: number,
  tunnelId: number,
): Promise<void> {
  return invoke("remote_tunnel_close", { sessionId, tunnelId });
}

export async function closeRemoteWorkspace(sessionId: number): Promise<void> {
  await releaseNativeHandlesForRemoteSession(sessionId);
  await invoke("remote_close", { sessionId });
}

export async function requestRemoteResult<T>(
  sessionId: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await requestRemote(sessionId, {
    protocol: REMOTE_PROTOCOL_VERSION,
    id: nextRemoteRequestId(),
    method,
    params,
  });
  if (!response.ok) {
    const error = response.error;
    if (error) throw new RemoteRequestError(error.code, error.message);
    throw new Error("Remote request failed");
  }
  return response.result as T;
}

export async function runRemoteOpenCodeServiceAction(
  sessionId: number,
  action: RemoteOpenCodeServiceAction,
  cwd: string,
): Promise<string> {
  const result = await requestRemoteResult<{ stdout: unknown }>(
    sessionId,
    "opencode.service",
    { action, cwd },
  );
  if (!result || typeof result.stdout !== "string") {
    throw new Error("Remote OpenCode service returned invalid output");
  }
  return result.stdout;
}
