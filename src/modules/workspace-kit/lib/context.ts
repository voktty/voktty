import { z } from "zod";
import schemaText from "@/../templates/workspace-kit/contracts/memory-context.schema.json?raw";
import header from "@/../templates/workspace-kit/contracts/memory-context-header.txt?raw";
import manifestText from "@/../templates/workspace-kit/manifest.json?raw";
import projectSeed from "@/../templates/workspace-kit/dot-voktty/PROJECT.md?raw";
import contextSeed from "@/../templates/workspace-kit/dot-voktty/CONTEXT.md?raw";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import { memoryProjectKey } from "@/modules/workspace-kit/lib/identity";
import {
  evaluateMemoryUse,
  type MemoryUseDecision,
} from "@/modules/workspace-kit/lib/policy";
import {
  makeIssue,
  parseDocumentWithinLimit,
  parseKitConfig,
} from "@/modules/workspace-kit/lib/validation";

const contract = JSON.parse(schemaText);
const contextSchema = z.fromJSONSchema(contract);
const instructionSchema = z.fromJSONSchema({
  $ref: "#/$defs/instructions",
  $defs: contract.$defs,
});
const manifest = JSON.parse(manifestText) as {
  version: string;
  files: { source: string; kind: string }[];
};
const encoder = new TextEncoder();
const MAX_PACKET_BYTES = 24 * 1024;
type Snapshot = {
  schema: 1;
  role: string | null;
  files: { path: string; fact: KitPathFact }[];
};
export type InstructionFingerprint = Readonly<{
  schema: 1;
  digest: string;
  role: string | null;
  files: readonly Readonly<{
    path: string;
    kind: "file" | "absent";
    sha256: string | null;
  }>[];
}>;
export type MemoryContextPacket = Readonly<{
  schema: 1;
  projectKey: string;
  instructionDigest: string;
  digest: string;
  bytes: number;
  contentState: "initial" | "available" | "unknown";
  text: string;
}>;
export type MemoryContextResult = Readonly<{
  schema: 1;
  decision: MemoryUseDecision;
  packet: MemoryContextPacket | null;
}>;

function fail(
  code: Parameters<typeof makeIssue>[0],
  path: (string | number)[] = [],
): never {
  throw new z.ZodError([makeIssue(code, path)]);
}

function boundedText(text: string): number {
  if (text.includes("\0")) fail("KIT_CONTEXT_TEXT_INVALID");
  const bytes = encoder.encode(text).length;
  if (bytes > 256 * 1024) fail("KIT_CONTEXT_TEXT_TOO_LARGE");
  return bytes;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function framed(fields: readonly string[]): Uint8Array<ArrayBuffer> {
  const domain = encoder.encode("voktty-memory-instructions-v1\0");
  const parts = fields.map((field) => encoder.encode(field));
  const bytes = new Uint8Array(
    domain.length + parts.reduce((sum, part) => sum + 4 + part.length, 0),
  );
  bytes.set(domain);
  const view = new DataView(bytes.buffer);
  let offset = domain.length;
  for (const part of parts) {
    view.setUint32(offset, part.length, false);
    bytes.set(part, offset + 4);
    offset += 4 + part.length;
  }
  return bytes;
}

async function fingerprint(
  snapshot: Snapshot,
): Promise<InstructionFingerprint> {
  const required = new Set(
    manifest.files
      .filter((file) => file.kind === "base")
      .map((file) => file.source.replace(/^dot-voktty\//, ".voktty/")),
  );
  if (snapshot.role) required.add(snapshot.role);
  const allowed = new Set([...required, "AGENTS.md", "CLAUDE.md"]);
  const seen = new Set<string>();
  let total = 0;
  for (const [index, { path, fact }] of snapshot.files.entries()) {
    if (!allowed.has(path) || seen.has(path))
      fail("KIT_INSTRUCTION_INVENTORY", ["files", index, "path"]);
    seen.add(path);
    if (fact.kind === "blocked" || (required.has(path) && fact.kind !== "file"))
      fail("KIT_INSTRUCTION_UNAVAILABLE", ["files", index]);
    if (fact.kind === "file") total += boundedText(fact.text);
  }
  if (seen.size !== allowed.size) fail("KIT_INSTRUCTION_INVENTORY", ["files"]);
  if (total > 1024 * 1024) fail("KIT_CONTEXT_TEXT_TOO_LARGE");
  const ordered = [...snapshot.files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const pending = await Promise.allSettled(
    ordered.map(async ({ path, fact }) =>
      Object.freeze({
        path,
        kind: fact.kind as "file" | "absent",
        sha256:
          fact.kind === "file" ? await sha256(encoder.encode(fact.text)) : null,
      }),
    ),
  );
  const files: InstructionFingerprint["files"][number][] = [];
  for (const result of pending) {
    if (result.status === "rejected") throw result.reason;
    files.push(result.value);
  }
  const fields = [
    snapshot.role ?? "",
    files.length.toString(),
    ...files.flatMap((file) => [file.path, file.kind, file.sha256 ?? ""]),
  ];
  return Object.freeze({
    schema: 1,
    role: snapshot.role,
    files: Object.freeze(files),
    digest: await sha256(framed(fields)),
  });
}

export async function instructionFingerprint(
  text: string,
): Promise<InstructionFingerprint> {
  const snapshot = instructionSchema.parse(
    parseDocumentWithinLimit(text, 2 * 1024 * 1024),
  ) as Snapshot;
  return fingerprint(snapshot);
}

function prefixForJson(text: string, limit: number): string {
  let bytes = 2;
  let end = 0;
  for (const scalar of text) {
    const code = scalar.codePointAt(0) ?? 0;
    const size =
      code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)
        ? 2
        : code < 32
          ? 6
          : encoder.encode(scalar).length;
    if (bytes + size > limit) break;
    bytes += size;
    end += scalar.length;
  }
  return text.slice(0, end);
}

export async function buildMemoryContext(
  text: string,
): Promise<MemoryContextResult> {
  const input = contextSchema.parse(
    parseDocumentWithinLimit(text, 4 * 1024 * 1024),
  ) as {
    identity: { canonicalRoot: string };
    use: Record<string, unknown>;
    config: Record<string, unknown>;
    instructions: Snapshot;
    project: KitPathFact;
    context: KitPathFact;
    activePlan: { path: string; kind: "file" | "absent" | "blocked" } | null;
  };
  let decision = evaluateMemoryUse(JSON.stringify(input.use));
  const result = (packet: MemoryContextPacket | null): MemoryContextResult =>
    Object.freeze({ schema: 1, decision, packet });
  if (
    !decision.contextAllowed &&
    decision.reason !== "KIT_MEMORY_INSTRUCTIONS_CHANGED"
  )
    return result(null);
  const projectKey = await memoryProjectKey(JSON.stringify(input.identity));
  if (projectKey !== input.use.projectKey)
    fail("KIT_CONTEXT_PROJECT_MISMATCH", ["identity"]);
  const config = parseKitConfig(JSON.stringify(input.config));
  const instructions = await fingerprint(input.instructions);
  decision = evaluateMemoryUse(
    JSON.stringify({ ...input.use, instructionDigest: instructions.digest }),
  );
  if (!decision.contextAllowed) return result(null);
  if (input.project.kind !== "file" || input.context.kind !== "file")
    fail("KIT_CONTEXT_DOCUMENT_UNAVAILABLE");
  boundedText(input.project.text);
  boundedText(input.context.text);
  const seed = (source: string) =>
    source.replace(
      /\{([a-z][a-z0-9_]*)\}/g,
      (match, key: string) =>
        config.values?.[key as keyof typeof config.values] ?? match,
    );
  const knownSeeds =
    config.values !== undefined && config.kitVersion === manifest.version;
  const contentState =
    !input.project.text.trim() ||
    !input.context.text.trim() ||
    (knownSeeds &&
      (input.project.text === seed(projectSeed) ||
        input.context.text === seed(contextSeed)))
      ? "initial"
      : knownSeeds
        ? "available"
        : "unknown";
  const facts = new Map(
    input.instructions.files.map((entry) => [entry.path, entry.fact]),
  );
  const sections: {
    path: string;
    mode: "pointer" | "full" | "excerpt";
    text: string | null;
  }[] = [
    { path: ".voktty/INIT.md", mode: "pointer", text: null },
    ...(instructions.role
      ? [{ path: instructions.role, mode: "pointer" as const, text: null }]
      : []),
    { path: ".voktty/PROJECT.md", mode: "pointer", text: null },
    { path: ".voktty/CONTEXT.md", mode: "pointer", text: null },
  ];
  const body = {
    schema: 1,
    projectKey,
    root: input.identity.canonicalRoot,
    project: config.project,
    language: config.language,
    instructionDigest: instructions.digest,
    role: instructions.role,
    contentState,
    pointers: [
      ".voktty/INDEX.md",
      ".voktty/RULES.md",
      ...(input.activePlan?.kind === "file" ? [input.activePlan.path] : []),
    ],
    warnings:
      input.activePlan && input.activePlan.kind !== "file"
        ? ["KIT_CONTEXT_PLAN_UNAVAILABLE"]
        : [],
    sections,
  };
  const serialize = () => header + JSON.stringify(body);
  if (encoder.encode(serialize()).length > MAX_PACKET_BYTES)
    fail("KIT_CONTEXT_BUDGET");
  for (const [index, section] of sections.entries()) {
    const fact =
      section.path === ".voktty/PROJECT.md"
        ? input.project
        : section.path === ".voktty/CONTEXT.md"
          ? input.context
          : facts.get(section.path);
    if (fact?.kind !== "file") fail("KIT_INSTRUCTION_UNAVAILABLE");
    const instruction =
      section.path !== ".voktty/PROJECT.md" &&
      section.path !== ".voktty/CONTEXT.md";
    const cap = instruction
      ? section.path === ".voktty/INIT.md"
        ? 12288
        : 4096
      : 3072;
    const currentBytes = encoder.encode(serialize()).length;
    if (currentBytes > MAX_PACKET_BYTES) fail("KIT_CONTEXT_BUDGET");
    const available = MAX_PACKET_BYTES - currentBytes + 4;
    const budget = Math.min(cap, available);
    if (encoder.encode(JSON.stringify(fact.text)).length <= budget)
      sections[index] = { path: section.path, mode: "full", text: fact.text };
    else if (!instruction && budget >= 2)
      sections[index] = {
        path: section.path,
        mode: "excerpt",
        text: prefixForJson(fact.text, budget),
      };
  }
  const packetText = serialize();
  const bytes = encoder.encode(packetText);
  if (bytes.length > MAX_PACKET_BYTES) fail("KIT_CONTEXT_BUDGET");
  const packet = Object.freeze({
    schema: 1 as const,
    projectKey,
    instructionDigest: instructions.digest,
    contentState,
    text: packetText,
    bytes: bytes.length,
    digest: await sha256(bytes),
  });
  return result(packet);
}
