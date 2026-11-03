import type { WorkspaceEnv } from "@/modules/workspace/env";
import type { NativeMemoryPublication } from "@/modules/workspace-kit/lib/nativeMemory";

export type NativeMemoryRecoveryInput = Readonly<{
  destination: string;
  environment: WorkspaceEnv;
}>;
export type NativeMemoryRecoveryEntry = Readonly<{
  target: string;
  backup: string;
  text: string;
}>;
export type NativeMemoryRecoverySnapshot = Readonly<{
  schema: 1;
  root: string;
  entries: readonly NativeMemoryRecoveryEntry[];
}>;
const recoveryBrand = Symbol("native-memory-recovery");
export type NativeMemoryRecoveryReview = Readonly<{
  [recoveryBrand]: true;
  snapshot: NativeMemoryRecoverySnapshot;
}>;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const targets = new Set([".voktty/.gitignore", "AGENTS.md", "CLAUDE.md"]);
const encoder = new TextEncoder();
function invalid(): never {
  throw Object.assign(new Error("Memory recovery reply is unavailable"), {
    code: "unavailable",
  });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit) invalid();
  for (const char of value) {
    const point = char.codePointAt(0) ?? 0;
    if (point >= 0xd800 && point <= 0xdfff) invalid();
  }
  if (encoder.encode(value).length > limit) invalid();
  return value;
}

export function memoryRecoveryReview(value: unknown, revision: number) {
  const reply = record(value);
  if (
    reply.schema !== 1 ||
    reply.revision !== revision ||
    typeof reply.review !== "string" ||
    !uuid.test(reply.review) ||
    typeof reply.digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(reply.digest) ||
    !Array.isArray(reply.entries) ||
    reply.entries.length < 1 ||
    reply.entries.length > 3
  )
    invalid();
  const root = text(reply.root, 4096);
  if (!root || /[\x00-\x1f\x7f]/.test(root)) invalid();
  const seenTargets = new Set<string>();
  const seenBackups = new Set<string>();
  const seenIndices = new Set<string>();
  let transaction: string | null = null;
  const entries = reply.entries.map((value): NativeMemoryRecoveryEntry => {
    const entry = record(value);
    const target = text(entry.target, 256);
    const backup = text(entry.backup, 256);
    const original = text(entry.text, 256 * 1024);
    const prefix = target === ".voktty/.gitignore" ? ".voktty/" : "";
    const suffix = backup.startsWith(`${prefix}.voktty-migration-`)
      ? backup.slice(`${prefix}.voktty-migration-`.length)
      : "";
    const match = /^(.{36})-(0|[1-9][0-9]{0,2})$/.exec(suffix);
    if (
      !targets.has(target) ||
      seenTargets.has(target) ||
      seenBackups.has(backup) ||
      !match ||
      !uuid.test(match[1]) ||
      Number(match[2]) >= 128 ||
      seenIndices.has(match[2]) ||
      (transaction !== null && transaction !== match[1])
    )
      invalid();
    transaction = match[1];
    seenIndices.add(match[2]);
    seenTargets.add(target);
    seenBackups.add(backup);
    return Object.freeze({ target, backup, text: original });
  });
  const receipt: NativeMemoryRecoveryReview = Object.freeze({
    [recoveryBrand]: true as const,
    snapshot: Object.freeze({
      schema: 1 as const,
      root,
      entries: Object.freeze(entries),
    }),
  });
  return { token: reply.review, digest: reply.digest, receipt };
}

export function memoryRestorationReport(
  value: unknown,
  accepted: NativeMemoryRecoveryReview,
): NativeMemoryPublication {
  const reply = record(value);
  const entries = accepted.snapshot.entries;
  if (
    reply.schema !== 1 ||
    !Array.isArray(reply.created) ||
    !Array.isArray(reply.cleaned) ||
    !Array.isArray(reply.migrated) ||
    reply.migrated.length !== 0 ||
    !Array.isArray(reply.skipped) ||
    reply.skipped.length !== 0 ||
    reply.created.length !== entries.length ||
    reply.cleaned.length !== entries.length ||
    !entries.every(
      (entry, index) =>
        (reply.created as unknown[])[index] === entry.target &&
        (reply.cleaned as unknown[])[index] === entry.backup,
    )
  )
    invalid();
  return Object.freeze({
    schema: 1 as const,
    created: Object.freeze(entries.map((entry) => entry.target)),
    cleaned: Object.freeze(entries.map((entry) => entry.backup)),
    migrated: Object.freeze([]),
    skipped: Object.freeze([]),
  });
}
