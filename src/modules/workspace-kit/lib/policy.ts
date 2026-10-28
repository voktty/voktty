import { z } from "zod";
import schemaText from "@/../templates/workspace-kit/contracts/memory-use.schema.json?raw";
import {
  makeIssue,
  parseDocument,
} from "@/modules/workspace-kit/lib/validation";

const schema = z.fromJSONSchema(JSON.parse(schemaText));

export type MemoryUsePolicy = "manual" | "always" | "never";
export type MemoryUseDecision = Readonly<{
  schema: 1;
  policy: MemoryUsePolicy;
  contextAllowed: boolean;
  captureAllowed: boolean;
  reason:
    | "KIT_MEMORY_READY"
    | "KIT_MEMORY_ABSENT"
    | "KIT_MEMORY_INVALID"
    | "KIT_MEMORY_AMBIGUOUS"
    | "KIT_MEMORY_INCOMPLETE"
    | "KIT_MEMORY_POLICY_NEVER"
    | "KIT_MEMORY_SESSION_DISABLED"
    | "KIT_MEMORY_CONSENT_REQUIRED"
    | "KIT_MEMORY_TRUST_REQUIRED"
    | "KIT_MEMORY_INSTRUCTIONS_CHANGED"
    | "KIT_MEMORY_CONTEXT_UNSUPPORTED";
}>;

type MemoryUseFacts = {
  schema: 1;
  projectKey: string;
  sessionId: string;
  kitState: "ready" | "absent" | "invalid" | "ambiguous" | "incomplete";
  instructionDigest: string | null;
  localPolicy: {
    projectKey: string;
    mode: MemoryUsePolicy | "ask";
  } | null;
  trust: { projectKey: string; instructionDigest: string } | null;
  session: {
    projectKey: string;
    sessionId: string;
    context: "enabled" | "disabled";
    captures: boolean;
  } | null;
  capabilities: { context: boolean; capture: boolean };
};

export function evaluateMemoryUse(text: string): MemoryUseDecision {
  if (
    text.length > 16 * 1024 ||
    new TextEncoder().encode(text).length > 16 * 1024
  )
    throw new z.ZodError([makeIssue("KIT_DOCUMENT_TOO_LARGE", [])]);
  const facts = schema.parse(parseDocument(text)) as MemoryUseFacts;
  if (facts.kitState === "ready" && facts.instructionDigest === null)
    throw new z.ZodError([
      makeIssue("KIT_MEMORY_DIGEST_REQUIRED", ["instructionDigest"]),
    ]);
  const local =
    facts.localPolicy?.projectKey === facts.projectKey
      ? facts.localPolicy.mode
      : "manual";
  const policy = local === "ask" ? "manual" : local;
  const session =
    facts.session?.projectKey === facts.projectKey &&
    facts.session.sessionId === facts.sessionId
      ? facts.session
      : null;
  const deny = (reason: MemoryUseDecision["reason"]): MemoryUseDecision =>
    Object.freeze({
      schema: 1,
      policy,
      contextAllowed: false,
      captureAllowed: false,
      reason,
    });
  if (facts.kitState !== "ready") {
    const reasons = {
      absent: "KIT_MEMORY_ABSENT",
      invalid: "KIT_MEMORY_INVALID",
      ambiguous: "KIT_MEMORY_AMBIGUOUS",
      incomplete: "KIT_MEMORY_INCOMPLETE",
    } as const;
    return deny(reasons[facts.kitState]);
  }
  if (policy === "never") return deny("KIT_MEMORY_POLICY_NEVER");
  if (session?.context === "disabled")
    return deny("KIT_MEMORY_SESSION_DISABLED");
  if (session?.context !== "enabled" && policy !== "always")
    return deny("KIT_MEMORY_CONSENT_REQUIRED");
  if (facts.trust?.projectKey !== facts.projectKey)
    return deny("KIT_MEMORY_TRUST_REQUIRED");
  if (facts.trust.instructionDigest !== facts.instructionDigest)
    return deny("KIT_MEMORY_INSTRUCTIONS_CHANGED");
  if (!facts.capabilities.context)
    return deny("KIT_MEMORY_CONTEXT_UNSUPPORTED");
  return Object.freeze({
    schema: 1,
    policy,
    contextAllowed: true,
    captureAllowed: session?.captures === true && facts.capabilities.capture,
    reason: "KIT_MEMORY_READY",
  });
}
