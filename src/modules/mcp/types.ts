import type { ToolEffect } from "@/modules/tools/capabilities";

export type McpAuthMode = "none" | "bearer" | "oauth";

export type McpStdioTransport = {
  kind: "stdio";
  executable: string;
  args: string[];
  cwd: string;
  authorizedRoot: string;
};

export type McpHttpTransport = {
  kind: "http";
  endpoint: string;
  allowPrivateNetwork: boolean;
};

export type McpServerConfig = {
  id: string;
  name: string;
  enabled: boolean;
  authMode: McpAuthMode;
  oauthClientId?: string;
  oauthScopes?: string[];
  automaticReadTools?: string[];
  transport: McpStdioTransport | McpHttpTransport;
};

export type McpConnectionPhase =
  | "disabled"
  | "disconnected"
  | "connecting"
  | "connected"
  | "authenticationRequired"
  | "error";

export type McpErrorKind =
  | "configuration"
  | "authentication"
  | "spawn"
  | "io"
  | "protocol"
  | "incompatibleVersion"
  | "resourceLimit"
  | "timeout"
  | "busy"
  | "cancelled"
  | "processExited"
  | "remote";

export type McpToolView = {
  name: string;
  namespacedName: string;
  title: string | null;
  description: string;
  effects: ToolEffect[];
};

export type McpNamedItemView = {
  name: string;
  title: string | null;
  description: string;
};

export type McpServerView = {
  id: string;
  phase: McpConnectionPhase;
  errorKind: McpErrorKind | null;
  protocolEra: "modern" | "legacy" | null;
  protocolVersion: string | null;
  serverName: string | null;
  serverVersion: string | null;
  capabilities: string[];
  tools: McpToolView[];
  resources: McpNamedItemView[];
  prompts: McpNamedItemView[];
  permissions: ToolEffect[];
  scope: string;
};

export type McpCredentialStatus = {
  bearer: boolean;
  oauth: boolean;
};

export type McpOAuthFlowStatus = {
  phase: "pending" | "completed" | "error" | "cancelled";
  errorKind: McpErrorKind | null;
};

export type McpExecutionLimits = {
  timeoutMs: number;
  inputBytes: number;
  outputBytes: number;
  concurrency: number;
  callsPerMinute: number;
};

export type McpRunTool = {
  name: string;
  namespacedName: string;
  serverId: string;
  title: string | null;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  effects: ToolEffect[];
  scope: string;
  requiresApproval: boolean;
};

export type McpToolSnapshot = {
  snapshotId: string;
  expiresAtMs: number;
  tools: McpRunTool[];
};

export type McpCapabilityDecision = {
  outcome: "allow" | "requireApproval" | "deny";
  reason: string;
  effectiveLimits: McpExecutionLimits | null;
};

export type McpApprovalReceipt = {
  id: string;
  expiresAtMs: number;
};

export type McpToolCallOutcome = {
  resultType: "complete" | "input_required";
  result: unknown;
};
