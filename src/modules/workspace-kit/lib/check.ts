import {
  compareMemoryArchiveFiles,
  type MemoryArchiveFileReport,
} from "@/modules/workspace-kit/lib/archiveFiles";
import {
  checkMemoryArchiveLinks,
  type MemoryArchiveLinkReport,
} from "@/modules/workspace-kit/lib/archiveLinks";
import {
  checkMemoryArchiveLogWithSources,
  type MemoryArchiveFragmentLogReport,
} from "@/modules/workspace-kit/lib/archiveLog";
import {
  checkMemoryArchiveTimeWithSources,
  type MemoryArchiveTimeReport,
} from "@/modules/workspace-kit/lib/archiveTime";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import {
  checkMemoryPlanIndex,
  type MemoryPlanIndexReport,
} from "@/modules/workspace-kit/lib/planIndex";
import {
  compareMemoryPreservation,
  snapshotMemoryPreservation,
  scalarCompare,
  type MemoryPreservationComparison,
} from "@/modules/workspace-kit/lib/preservation";
import {
  compareMemoryProtected,
  isMemoryProtectedPath,
  memoryProtectedPaths,
  type MemoryProtectedComparison,
  type MemoryProtectedSnapshot,
} from "@/modules/workspace-kit/lib/protected";

export type MemoryCheckIssue = Readonly<{
  code: string;
  subjects: readonly string[];
}>;
export type MemoryCheckReport = Readonly<{
  schema: 1;
  nowMs: number;
  afterDays: number;
  preservation: MemoryPreservationComparison;
  protected: MemoryProtectedComparison;
  index: MemoryPlanIndexReport;
  files: MemoryArchiveFileReport;
  time: MemoryArchiveTimeReport;
  log: MemoryArchiveFragmentLogReport;
  links: MemoryArchiveLinkReport;
  qualifiedAppends: readonly string[];
  issues: readonly MemoryCheckIssue[];
}>;
const encoder = new TextEncoder();

function captureProtected(
  input: MemoryProtectedSnapshot,
): MemoryProtectedSnapshot {
  if (input.files.length > 128) throw new Error("KIT_CHECK_LIMIT");
  if (input.schema !== 1) throw new Error("KIT_CHECK_PROTECTED_INVALID");
  const seen = new Set<string>();
  let bytes = 0;
  const files = input.files.map((file) => {
    if (!isMemoryProtectedPath(file.path) || seen.has(file.path))
      throw new Error("KIT_CHECK_PROTECTED_INVALID");
    seen.add(file.path);
    if (file.kind === "file") {
      if (
        typeof file.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes === null ||
        file.bytes < 0 ||
        file.bytes > 256 * 1024
      )
        throw new Error("KIT_CHECK_PROTECTED_INVALID");
      bytes += file.bytes;
    } else if (
      file.kind !== "absent" ||
      file.sha256 !== null ||
      file.bytes !== null
    )
      throw new Error("KIT_CHECK_PROTECTED_INVALID");
    return Object.freeze({ ...file });
  });
  if (bytes > 4 * 1024 * 1024) throw new Error("KIT_CHECK_LIMIT");
  if (memoryProtectedPaths().some((path) => !seen.has(path)))
    throw new Error("KIT_CHECK_PROTECTED_INVALID");
  return Object.freeze({ schema: 1, files: Object.freeze(files) });
}
function captureFacts(
  input: ReadonlyMap<string, KitPathFact>,
  protectedFiles: MemoryProtectedSnapshot,
) {
  if (input.size + protectedFiles.files.length > 128)
    throw new Error("KIT_CHECK_LIMIT");
  let bytes = 0;
  const facts = new Map(
    [...input].map(([path, fact]): [string, KitPathFact] => {
      if (fact.kind !== "file") return [path, { kind: fact.kind }];
      if (fact.text.length > 256 * 1024)
        throw new Error("KIT_MEMORY_TEXT_TOO_LARGE");
      const length = encoder.encode(fact.text).length;
      if (length > 256 * 1024) throw new Error("KIT_MEMORY_TEXT_TOO_LARGE");
      bytes += length;
      return [path, { kind: "file", text: fact.text }];
    }),
  );
  if (bytes > 4 * 1024 * 1024) throw new Error("KIT_PRESERVATION_BYTE_LIMIT");
  if (
    bytes + protectedFiles.files.reduce((sum, f) => sum + (f.bytes ?? 0), 0) >
    4 * 1024 * 1024
  )
    throw new Error("KIT_CHECK_LIMIT");
  return facts;
}

/** Source-bound composition, without native ownership, writer coordination or approval. */
export async function checkMemoryPreservation(
  previousSources: ReadonlyMap<string, KitPathFact>,
  currentSources: ReadonlyMap<string, KitPathFact>,
  previousProtected: MemoryProtectedSnapshot,
  currentProtected: MemoryProtectedSnapshot,
  nowMs: number,
  afterDays: number,
): Promise<MemoryCheckReport> {
  const oldProtected = captureProtected(previousProtected),
    newProtected = captureProtected(currentProtected);
  const previous = captureFacts(previousSources, oldProtected),
    current = captureFacts(currentSources, newProtected);
  const protection = compareMemoryProtected(oldProtected, newProtected);
  const [before, after] = await Promise.all([
    snapshotMemoryPreservation(previous, true),
    snapshotMemoryPreservation(current, true),
  ]);
  const preservation = compareMemoryPreservation(before, after);
  const indexText = current.get("plans/INDEX.md");
  if (indexText?.kind !== "file")
    throw new Error("KIT_PRESERVATION_INCOMPLETE");
  const files = compareMemoryArchiveFiles(before, after);
  const [index, time, log, links] = await Promise.all([
    checkMemoryPlanIndex(after, indexText.text),
    checkMemoryArchiveTimeWithSources(
      before,
      after,
      previous,
      nowMs,
      afterDays,
    ),
    checkMemoryArchiveLogWithSources(
      before,
      after,
      previous,
      current,
      nowMs,
      afterDays,
    ),
    checkMemoryArchiveLinks(before, after, previous, current, nowMs, afterDays),
  ]);
  const qualifiedAppends = new Set(
    log.fragments.fragments.map((fragment) => fragment.target),
  );
  const issues: MemoryCheckIssue[] = [];
  function add(code: string, subjects: readonly string[]) {
    if (subjects.length)
      issues.push(
        Object.freeze({ code, subjects: Object.freeze([...subjects]) }),
      );
  }
  for (const [code, subjects] of [
    ["PRESERVATION_MISSING_LIVE_ITEMS", preservation.missingLiveItems],
    ["PRESERVATION_MISSING_ITEMS", preservation.missingItems],
    ["PRESERVATION_MISSING_LIVE_PLANS", preservation.missingLivePlans],
    ["PROTECTED_CHANGED_FILES", protection.changedFiles],
    ["PROTECTED_ADDED_FILES", protection.addedFiles],
    ["PROTECTED_REMOVED_FILES", protection.removedFiles],
    ["INDEX_MISSING_PLANS", index.missingPlans],
    ["INDEX_UNAVAILABLE_PLAN_LINKS", index.unavailablePlanLinks],
    ["ARCHIVE_MISSING_MOVED_FILES", files.missingMovedFiles],
    ["ARCHIVE_AMBIGUOUS_FILES", files.ambiguousFiles],
    ["ARCHIVE_INELIGIBLE_REMOVALS", files.ineligibleRemovedFiles],
    ["ARCHIVE_CHANGED_HANDOFFS", files.changedHandoffs],
    ["ARCHIVE_MISSING_ARCHIVES", files.missingArchives],
    ["ARCHIVE_UNKNOWN_DATES", time.unknownDates],
    ["ARCHIVE_FUTURE_DATES", time.futureDates],
    ["ARCHIVE_TOO_RECENT", time.tooRecent],
    ["ARCHIVE_WRONG_MONTHS", time.wrongMonths],
    ["LOG_MISSING_MOVES", log.log.missingMoves],
    ["LOG_MISSING_SIZES", log.log.missingSizes],
    ["LOG_MISSING_FRAGMENTS", log.missingFragments],
    ["LINKS_MISSING_MOVES", links.missingMoves],
    ["LINKS_MISSING_FRAGMENTS", links.missingFragments],
    ["LINKS_UNVERIFIED_DOCUMENTS", links.unverifiedDocuments],
    ["LINKS_MISSING_DOCUMENTS", links.missingDocuments],
  ] as const)
    add(code, subjects);
  const lineKeys = (path: string, values: readonly number[]) =>
    values.map((n) => `${path}#L${n}`);
  if (!index.complete) add("INDEX_INCOMPLETE", ["plans/INDEX.md"]);
  add(
    "INDEX_UNVERIFIED_LINES",
    lineKeys("plans/INDEX.md", index.unverifiedLines),
  );
  if (!log.log.complete) add("LOG_INCOMPLETE", ["archive/LOG.md"]);
  for (const [code, values] of [
    ["LOG_INVALID_LINES", log.log.invalidLines],
    ["LOG_UNMATCHED_LINES", log.log.unmatchedLines],
    ["LOG_DUPLICATE_LINES", log.log.duplicateLines],
  ] as const)
    add(code, lineKeys("archive/LOG.md", values));
  const fragments = log.fragments;
  for (const [code, subjects] of [
    ["FRAGMENT_MISSING", fragments.missingFragments],
    ["FRAGMENT_UNKNOWN_DATES", fragments.unknownDates],
    ["FRAGMENT_FUTURE_DATES", fragments.futureDates],
    ["FRAGMENT_TOO_RECENT", fragments.tooRecent],
    ["FRAGMENT_OPEN", fragments.openFragments],
    ["FRAGMENT_AMBIGUOUS", fragments.ambiguousFragments],
    ["FRAGMENT_UNVERIFIED_SOURCES", fragments.unverifiedSources],
    ["FRAGMENT_REWRITTEN_ARCHIVES", fragments.rewrittenArchives],
    ["FRAGMENT_UNATTRIBUTED_ARCHIVES", fragments.unattributedArchives],
  ] as const)
    add(code, subjects);
  add(
    "ARCHIVE_CHANGED_ARCHIVES",
    files.changedArchives.filter((path) => !qualifiedAppends.has(path)),
  );
  add(
    "ARCHIVE_UNATTRIBUTED_ARCHIVES",
    files.unattributedArchives.filter((path) => !qualifiedAppends.has(path)),
  );
  return Object.freeze({
    schema: 1,
    nowMs,
    afterDays,
    preservation,
    protected: protection,
    index,
    files,
    time,
    log,
    links,
    qualifiedAppends: Object.freeze([...qualifiedAppends].sort(scalarCompare)),
    issues: Object.freeze(issues),
  });
}
