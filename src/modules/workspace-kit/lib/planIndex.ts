import { inspectMemoryLinks } from "@/modules/workspace-kit/lib/memoryLinks";
import {
  scalarCompare,
  type MemoryPreservationSnapshot,
} from "@/modules/workspace-kit/lib/preservation";
import { isUnicodeScalarText } from "@/modules/workspace-kit/lib/validation";
const encoder = new TextEncoder();
export type MemoryPlanIndexReport = Readonly<{
  linkedPlans: readonly string[];
  missingPlans: readonly string[];
  unavailablePlanLinks: readonly string[];
  unverifiedLines: readonly number[];
  complete: boolean;
}>;

/** Qualified inline links only; this report cannot approve compaction. */
export async function checkMemoryPlanIndex(
  snapshot: MemoryPreservationSnapshot,
  text: string,
): Promise<MemoryPlanIndexReport> {
  if (text.length > 256 * 1024) throw new Error("KIT_MEMORY_TEXT_TOO_LARGE");
  const bytes = encoder.encode(text);
  if (bytes.length > 256 * 1024) throw new Error("KIT_MEMORY_TEXT_TOO_LARGE");
  if (!isUnicodeScalarText(text)) throw new Error("KIT_MEMORY_TEXT_INVALID");
  const index = snapshot.files.find((file) => file.path === "plans/INDEX.md");
  if (!index) throw new Error("KIT_PRESERVATION_INCOMPLETE");
  const expected = index.sha256;
  const plans = new Set(
    snapshot.files
      .filter((file) => file.planState !== null)
      .map((file) => file.path),
  );
  const nonclosed = snapshot.files
    .filter((file) => file.planState !== null && file.planState !== "closed")
    .map((file) => file.path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== expected) throw new Error("KIT_PLAN_INDEX_CHANGED");
  const qualified = inspectMemoryLinks(
    text,
    "plans/INDEX.md",
    "KIT_PLAN_INDEX_LIMIT",
  );
  const linked = new Set<string>(),
    unavailable = new Set<string>();
  for (const path of qualified.paths) {
    if (
      path.startsWith("plans/") &&
      path.endsWith(".md") &&
      ![
        "plans/INDEX.md",
        "plans/TRACKING.md",
        "plans/README.md",
        "plans/_TEMPLATE.md",
      ].includes(path)
    )
      (plans.has(path) ? linked : unavailable).add(path);
  }
  return Object.freeze({
    linkedPlans: Object.freeze([...linked].sort(scalarCompare)),
    missingPlans: Object.freeze(nonclosed.filter((path) => !linked.has(path))),
    unavailablePlanLinks: Object.freeze([...unavailable].sort(scalarCompare)),
    unverifiedLines: qualified.unverifiedLines,
    complete: qualified.complete,
  });
}
