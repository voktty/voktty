import type { WorkspaceEnv } from "@/modules/workspace/env";
import type {
  NativeMemoryPublication,
  NativeMemoryPreviewSnapshot,
} from "@/modules/workspace-kit/lib/nativeMemory";
import type { KitDeploymentEntry } from "@/modules/workspace-kit/lib/deployment";

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
  schema: 2;
  root: string;
  entries: readonly NativeMemoryRecoveryEntry[];
  deployment: Readonly<
    Pick<NativeMemoryPreviewSnapshot["deployment"], "entries" | "canPublish">
  >;
  cleanup: readonly Readonly<{ path: string; text: string }>[];
  publicationBlocker: string | null;
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
    reply.schema !== 2 ||
    reply.revision !== revision ||
    typeof reply.review !== "string" ||
    !uuid.test(reply.review) ||
    typeof reply.digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(reply.digest) ||
    !Array.isArray(reply.entries) ||
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
  const deployment = record(reply.deployment);
  if (
    !Array.isArray(deployment.entries) ||
    deployment.entries.length < 1 ||
    deployment.entries.length > 128 ||
    typeof deployment.canPublish !== "boolean"
  )
    invalid();
  const paths = new Set<string>();
  const reasons = new Set([
    "missing",
    "identical",
    "different",
    "unavailable",
    "root-link",
    "private-ignore",
    "missing-link-target",
  ]);
  const reserved =
    /^(?:state|mailbox|locks|sessions|tasks|tasks\.json|tools\.json|servers|shell-integration|proc|extensions|history\.json|trusted-roots\.json|\.initialization\.json)$/i;
  let bytes = entries.reduce(
    (total, entry) => total + encoder.encode(entry.text).length,
    0,
  );
  const plan = deployment.entries.map((value): KitDeploymentEntry => {
    const entry = record(value);
    const path = text(entry.path, 256);
    const parts = path.split("/");
    const action = entry.action;
    const reason = entry.reason;
    const expected =
      entry.expected === null ? null : text(entry.expected, 256 * 1024);
    const proposed = text(entry.proposed, 256 * 1024);
    if (
      (!targets.has(path) &&
        (parts.length < 2 ||
          parts[0] !== ".voktty" ||
          reserved.test(parts[1]))) ||
      parts.some(
        (part) =>
          !/^[A-Za-z0-9_.-]+$/.test(part) ||
          part === "." ||
          part === ".." ||
          part.toLowerCase().startsWith(".voktty-migration-"),
      ) ||
      paths.has(path.toLowerCase()) ||
      (action !== "create" &&
        action !== "skip" &&
        action !== "migrate" &&
        action !== "conflict") ||
      typeof reason !== "string" ||
      !reasons.has(reason) ||
      (action === "create" && (expected !== null || reason !== "missing")) ||
      (action === "skip" &&
        (expected !== proposed || reason !== "identical")) ||
      (action === "migrate" &&
        (!targets.has(path) || expected === null || expected === proposed))
    )
      invalid();
    paths.add(path.toLowerCase());
    bytes +=
      encoder.encode(proposed).length +
      (expected === null ? 0 : encoder.encode(expected).length);
    return Object.freeze({
      path,
      action,
      reason: reason as KitDeploymentEntry["reason"],
      expected,
      proposed,
    });
  });
  if (
    deployment.canPublish !==
      plan.every((entry) => entry.action !== "conflict") ||
    !Array.isArray(reply.cleanup) ||
    reply.cleanup.length > 6
  )
    invalid();
  const cleanup = reply.cleanup.map((value) => {
    const entry = record(value);
    const path = text(entry.path, 256);
    const content = text(entry.text, 256 * 1024);
    const match =
      /^(?:\.voktty\/)?\.voktty-migration-(.{36})-(0|[1-9][0-9]{0,2})$/.exec(
        path,
      );
    if (
      !match ||
      !uuid.test(match[1]) ||
      Number(match[2]) >= 128 ||
      (transaction !== null && transaction !== match[1])
    )
      invalid();
    transaction = match[1];
    bytes += encoder.encode(content).length;
    return Object.freeze({ path, text: content });
  });
  if (
    bytes > 4 * 1024 * 1024 ||
    (reply.publicationBlocker !== null &&
      (typeof reply.publicationBlocker !== "string" ||
        !/^[A-Za-z]{1,64}$/.test(reply.publicationBlocker)))
  )
    invalid();
  const receipt: NativeMemoryRecoveryReview = Object.freeze({
    [recoveryBrand]: true as const,
    snapshot: Object.freeze({
      schema: 2 as const,
      root,
      entries: Object.freeze(entries),
      deployment: Object.freeze({
        entries: Object.freeze(plan),
        canPublish: deployment.canPublish,
      }),
      cleanup: Object.freeze(cleanup),
      publicationBlocker: reply.publicationBlocker as string | null,
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
  const plan = accepted.snapshot.deployment.entries;
  const created = [
    ...entries.map((entry) => entry.target),
    ...plan
      .filter((entry) => entry.action === "create")
      .map((entry) => entry.path),
  ];
  const cleaned = [
    ...accepted.snapshot.cleanup.map((entry) => entry.path),
    ...entries.map((entry) => entry.backup),
    ".voktty/.initialization.json",
  ];
  const migrated = plan
    .filter((entry) => entry.action === "migrate")
    .map((entry) => entry.path);
  const skipped = plan
    .filter((entry) => entry.action === "skip")
    .map((entry) => entry.path);
  function matches(value: unknown, expected: readonly string[]): boolean {
    if (
      !Array.isArray(value) ||
      value.length !== expected.length ||
      !value.every((entry) => typeof entry === "string")
    )
      return false;
    const actual = [...value].sort();
    return [...expected]
      .sort()
      .every((entry, index) => entry === actual[index]);
  }
  if (
    reply.schema !== 1 ||
    !matches(reply.created, created) ||
    !matches(reply.cleaned, cleaned) ||
    !matches(reply.migrated, migrated) ||
    !matches(reply.skipped, skipped)
  )
    invalid();
  return Object.freeze({
    schema: 1 as const,
    created: Object.freeze([...(reply.created as string[])]),
    cleaned: Object.freeze([...(reply.cleaned as string[])]),
    migrated: Object.freeze([...(reply.migrated as string[])]),
    skipped: Object.freeze([...(reply.skipped as string[])]),
  });
}
