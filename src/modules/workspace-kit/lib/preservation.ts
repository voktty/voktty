import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import {
  inspectMemoryPlanText,
  inspectMemoryText,
  type MemoryText,
} from "@/modules/workspace-kit/lib/memory";
import { isUnicodeScalarText } from "@/modules/workspace-kit/lib/validation";

const encoder = new TextEncoder();
export type MemoryPreservationFile = Readonly<{
  path: string;
  kind: "live" | "history" | "archive" | "record";
  sha256: string;
  bytes: number;
  items: MemoryText["ids"];
  planState: MemoryText["planState"] | null;
}>;
export type MemoryPreservationSnapshot = Readonly<{
  schema: 1;
  files: readonly MemoryPreservationFile[];
}>;
export type MemoryPreservationComparison = Readonly<{
  missingLiveItems: readonly string[];
  missingItems: readonly string[];
  missingLivePlans: readonly string[];
}>;

function kind(path: string): MemoryPreservationFile["kind"] | null {
  if (
    path.length > 4096 ||
    !isUnicodeScalarText(path) ||
    encoder.encode(path).length > 4096 ||
    /[\p{Cc}\\:%?#]/u.test(path)
  )
    return null;
  const parts = path.split("/");
  if (
    parts.length > 64 ||
    parts.some((part) => !part || part === "." || part === "..") ||
    !path.endsWith(".md")
  )
    return null;
  if (
    [
      "PROJECT.md",
      "CONTEXT.md",
      "plans/INDEX.md",
      "plans/TRACKING.md",
      "continuity/CHANGELOG.md",
    ].includes(path)
  )
    return "live";
  if (path === "archive/LOG.md") return "record";
  if (
    parts.length === 2 &&
    ["plans", "domains"].includes(parts[0]) &&
    !["README.md", "_TEMPLATE.md"].includes(parts[1])
  )
    return "live";
  if (
    parts.length === 3 &&
    parts[0] === "continuity" &&
    parts[1] === "handoffs" &&
    parts[2] !== "README.md"
  )
    return "history";
  if (
    parts.length >= 3 &&
    parts[0] === "archive" &&
    /^(?:[2-9][0-9]{3}|19[7-9][0-9])-(?:0[1-9]|1[0-2])$/.test(parts[1])
  )
    return "archive";
  return null;
}

function scalarCompare(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const difference =
      (a[i].codePointAt(0) ?? -1) - (b[i].codePointAt(0) ?? -1);
    if (difference) return difference;
  }
  return a.length - b.length;
}

/** The native reader must establish completeness and supply actual bytes. */
export async function snapshotMemoryPreservation(
  documents: ReadonlyMap<string, KitPathFact>,
  inventoryComplete: boolean,
): Promise<MemoryPreservationSnapshot> {
  if (!inventoryComplete) throw new Error("KIT_PRESERVATION_INCOMPLETE");
  if (documents.size > 128) throw new Error("KIT_PRESERVATION_FILE_LIMIT");
  for (const required of [
    "PROJECT.md",
    "CONTEXT.md",
    "plans/INDEX.md",
    "plans/TRACKING.md",
    "continuity/CHANGELOG.md",
    "archive/LOG.md",
  ]) {
    if (!documents.has(required))
      throw new Error("KIT_PRESERVATION_INCOMPLETE");
  }
  let total = 0;
  let occurrences = 0;
  const captured = [...documents]
    .sort(([a], [b]) => scalarCompare(a, b))
    .map(([path, fact]) => {
      const fileKind = kind(path);
      if (!fileKind) throw new Error("KIT_PRESERVATION_PATH_INVALID");
      if (fact.kind !== "file") throw new Error("KIT_PRESERVATION_INCOMPLETE");
      if (fact.text.length > 4 * 1024 * 1024)
        throw new Error("KIT_PRESERVATION_BYTE_LIMIT");
      const bytes = encoder.encode(fact.text);
      total += bytes.length;
      if (total > 4 * 1024 * 1024)
        throw new Error("KIT_PRESERVATION_BYTE_LIMIT");
      const plan =
        fileKind === "live" &&
        path.startsWith("plans/") &&
        !["plans/INDEX.md", "plans/TRACKING.md"].includes(path);
      const inspected = plan
        ? inspectMemoryPlanText(fact.text)
        : inspectMemoryText(fact.text);
      if (!inspected.complete)
        throw new Error("KIT_PRESERVATION_TEXT_INCOMPLETE");
      occurrences += inspected.ids.length;
      if (
        occurrences > 8192 ||
        inspected.ids.some((item) => item.id.length > 64)
      )
        throw new Error("KIT_PRESERVATION_ITEM_LIMIT");
      return {
        path,
        kind: fileKind,
        bytes,
        items: inspected.ids,
        planState: plan ? inspected.planState : null,
      };
    });
  const files = await Promise.all(
    captured.map(async (file) => {
      const digest = await crypto.subtle.digest("SHA-256", file.bytes);
      const sha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return Object.freeze({ ...file, bytes: file.bytes.length, sha256 });
    }),
  );
  return Object.freeze({ schema: 1, files: Object.freeze(files) });
}

/** Syntactic item/plan preservation, without index, archive-byte or LOG checks. */
export function compareMemoryPreservation(
  before: MemoryPreservationSnapshot,
  after: MemoryPreservationSnapshot,
): MemoryPreservationComparison {
  const live = new Set(
    after.files
      .filter((file) => file.kind === "live")
      .flatMap((file) => file.items.map((item) => item.id)),
  );
  const all = new Set(
    after.files
      .filter((file) => file.kind === "live" || file.kind === "archive")
      .flatMap((file) => file.items.map((item) => item.id)),
  );
  const missingLiveItems = new Set<string>();
  const missingItems = new Set<string>();
  const missingLivePlans = new Set<string>();
  for (const file of before.files) {
    if (file.kind === "live" || file.kind === "archive") {
      for (const item of file.items) {
        if (file.kind === "live" && item.state === "open" && !live.has(item.id))
          missingLiveItems.add(item.id);
        if (!all.has(item.id)) missingItems.add(item.id);
      }
    }
    if (
      file.planState !== null &&
      file.planState !== "closed" &&
      !after.files.some(
        (current) => current.path === file.path && current.kind === "live",
      )
    )
      missingLivePlans.add(file.path);
  }
  return Object.freeze({
    missingLiveItems: Object.freeze([...missingLiveItems].sort(scalarCompare)),
    missingItems: Object.freeze([...missingItems].sort(scalarCompare)),
    missingLivePlans: Object.freeze([...missingLivePlans].sort(scalarCompare)),
  });
}
