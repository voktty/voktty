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

export function closeRemoteWorkspace(sessionId: number): Promise<void> {
  return invoke("remote_close", { sessionId });
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
