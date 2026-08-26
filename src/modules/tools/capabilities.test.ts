import { describe, expect, it } from "vitest";
import {
  type ApprovalGrantReceipt,
  type CapabilityDecision,
  TOOL_POLICY_LIMITS,
  type ToolDescriptor,
} from "./capabilities";

const descriptor: ToolDescriptor = {
  identity: {
    origin: "mcp",
    sourceId: "files-server",
    name: "write_file",
    namespacedName: "mcp__files_server__write_file__0123456789abcdef",
  },
  description: "Write a file",
  effects: ["write"],
  scope: {
    workspaceId: "workspace-a",
    host: null,
    resource: null,
    sessionId: null,
    agentId: null,
  },
  limits: {
    timeoutMs: 30_000,
    inputBytes: 64 * 1024,
    outputBytes: 512 * 1024,
    concurrency: 4,
    callsPerMinute: 60,
  },
};

describe("tool capability DTOs", () => {
  it("mirrors the native policy budgets", () => {
    expect(TOOL_POLICY_LIMITS).toEqual({
      identityComponentBytes: 128,
      namespacedNameBytes: 128,
      descriptionBytes: 4096,
      schemaBytes: 262_144,
      annotationsBytes: 65_536,
      scopeComponentBytes: 1024,
      timeoutMs: 300_000,
      inputBytes: 65_536,
      outputBytes: 524_288,
      concurrency: 4,
      callsPerMinute: 60,
      grantTtlMs: 300_000,
    });
  });

  it("keeps approval data opaque in the webview", () => {
    const decision: CapabilityDecision = {
      outcome: "requireApproval",
      reason: "approvalRequired",
      effectiveLimits: descriptor.limits,
    };
    const grant: ApprovalGrantReceipt = {
      id: "opaque-native-id",
      expiresAtMs: 1234,
    };

    expect({ decision, grant }).toMatchObject({
      decision: { outcome: "requireApproval" },
      grant: { id: "opaque-native-id" },
    });
  });
});
