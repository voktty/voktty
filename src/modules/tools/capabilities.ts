/**
 * Presentation DTOs for the authoritative Rust tool capability policy.
 *
 * These types describe native decisions. They must never be used to create
 * trust or approval in the webview.
 */

export const TOOL_POLICY_LIMITS = {
  identityComponentBytes: 128,
  namespacedNameBytes: 128,
  descriptionBytes: 4 * 1024,
  schemaBytes: 256 * 1024,
  annotationsBytes: 64 * 1024,
  scopeComponentBytes: 1024,
  timeoutMs: 5 * 60 * 1000,
  inputBytes: 64 * 1024,
  outputBytes: 512 * 1024,
  concurrency: 4,
  callsPerMinute: 60,
  grantTtlMs: 5 * 60 * 1000,
} as const;

export type ToolOrigin = "builtin" | "extension" | "mcp";

export type ToolEffect =
  | "read"
  | "write"
  | "process"
  | "network"
  | "secret"
  | "publish"
  | "delete";

export interface ToolIdentity {
  origin: ToolOrigin;
  sourceId: string;
  name: string;
  namespacedName: string;
}

export interface CapabilityScope {
  workspaceId: string | null;
  host: string | null;
  resource: string | null;
  sessionId: string | null;
  agentId: string | null;
}

export interface ExecutionLimits {
  timeoutMs: number;
  inputBytes: number;
  outputBytes: number;
  concurrency: number;
  callsPerMinute: number;
}

export interface ToolDescriptor {
  identity: ToolIdentity;
  description: string;
  effects: ToolEffect[];
  scope: CapabilityScope;
  limits: ExecutionLimits;
}

export type ExecutionMode = "automatic" | "approvalRequired" | "deny";

export interface ToolRule {
  descriptor: ToolDescriptor;
  mode: ExecutionMode;
}

export interface CapabilityRequest {
  identity: ToolIdentity;
  effects: ToolEffect[];
  scope: CapabilityScope;
  limits: ExecutionLimits;
}

export type DecisionOutcome = "allow" | "requireApproval" | "deny";

export type DecisionReason =
  | "ruleAllows"
  | "approvalRequired"
  | "ruleDenied"
  | "unknownTool"
  | "invalidRequest"
  | "effectMismatch"
  | "scopeMismatch"
  | "limitEscalation";

export interface CapabilityDecision {
  outcome: DecisionOutcome;
  reason: DecisionReason;
  effectiveLimits: ExecutionLimits | null;
}

export interface ApprovalGrantReceipt {
  id: string;
  expiresAtMs: number;
}

export interface UntrustedToolAnnotations {
  readOnlyHint: boolean | null;
  destructiveHint: boolean | null;
  idempotentHint: boolean | null;
  openWorldHint: boolean | null;
}

export interface UntrustedToolMetadata {
  description: string;
  inputSchemaBytes: number;
  outputSchemaBytes: number | null;
  annotationsBytes: number;
}
