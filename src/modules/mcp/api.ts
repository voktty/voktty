import { invoke } from "@tauri-apps/api/core";
import type {
  McpCredentialStatus,
  McpApprovalReceipt,
  McpCapabilityDecision,
  McpOAuthFlowStatus,
  McpServerConfig,
  McpServerView,
  McpToolCallOutcome,
  McpToolSnapshot,
} from "./types";

export const mcpApi = {
  upsertServer: (config: McpServerConfig) =>
    invoke<McpServerView>("mcp_upsert_server", { config }),
  listServers: () => invoke<McpServerView[]>("mcp_list_servers"),
  connectServer: (serverId: string) =>
    invoke<McpServerView>("mcp_connect_server", { serverId }),
  disconnectServer: (serverId: string) =>
    invoke<McpServerView>("mcp_disconnect_server", { serverId }),
  restartServer: (serverId: string) =>
    invoke<McpServerView>("mcp_restart_server", { serverId }),
  removeServer: (serverId: string) => invoke<void>("mcp_remove_server", { serverId }),
  setBearerCredential: (serverId: string, token: string) =>
    invoke<McpCredentialStatus>("mcp_set_bearer_credential", { serverId, token }),
  credentialStatus: (serverId: string) =>
    invoke<McpCredentialStatus>("mcp_credential_status", { serverId }),
  revokeCredentials: (serverId: string) =>
    invoke<McpCredentialStatus>("mcp_revoke_credentials", { serverId }),
  beginOAuth: (serverId: string) =>
    invoke<{ authorizationUrl: string }>("mcp_begin_oauth", { serverId }),
  oauthFlowStatus: (serverId: string) =>
    invoke<McpOAuthFlowStatus>("mcp_oauth_flow_status", { serverId }),
  createToolSnapshot: () =>
    invoke<McpToolSnapshot>("mcp_create_tool_snapshot"),
  getToolSnapshot: (snapshotId: string) =>
    invoke<McpToolSnapshot>("mcp_get_tool_snapshot", { snapshotId }),
  decideToolCall: (
    snapshotId: string,
    toolName: string,
    toolCallId: string,
    argumentsValue: unknown,
  ) =>
    invoke<McpCapabilityDecision>("mcp_decide_tool_call", {
      snapshotId,
      toolName,
      toolCallId,
      arguments: argumentsValue,
    }),
  resolveToolApproval: (toolCallId: string, approved: boolean) =>
    invoke<McpApprovalReceipt | null>("mcp_resolve_tool_approval", {
      toolCallId,
      approved,
    }),
  callSnapshotTool: (
    snapshotId: string,
    toolName: string,
    toolCallId: string,
    argumentsValue: unknown,
  ) =>
    invoke<McpToolCallOutcome>("mcp_call_snapshot_tool", {
      snapshotId,
      toolName,
      toolCallId,
      arguments: argumentsValue,
    }),
  cancelToolCall: (toolCallId: string) =>
    invoke<void>("mcp_cancel_tool_call", { toolCallId }),
};
