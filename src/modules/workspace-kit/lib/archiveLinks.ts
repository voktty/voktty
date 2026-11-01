import { compareMemoryArchiveFiles } from "@/modules/workspace-kit/lib/archiveFiles";
import type { MemoryArchiveFragmentReport } from "@/modules/workspace-kit/lib/archiveFragments";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import { inspectMemoryLinks } from "@/modules/workspace-kit/lib/memoryLinks";
import {
  scalarCompare,
  snapshotMemoryPreservation,
  type MemoryPreservationSnapshot,
} from "@/modules/workspace-kit/lib/preservation";

export type MemoryArchiveLinkReport = Readonly<{
  linkedMoves: readonly string[];
  missingMoves: readonly string[];
  linkedFragments: readonly string[];
  missingFragments: readonly string[];
  unverifiedDocuments: readonly string[];
  missingDocuments: readonly string[];
  fragments: MemoryArchiveFragmentReport;
}>;

function capture(
  sources: ReadonlyMap<string, KitPathFact>,
): Map<string, KitPathFact> {
  if (sources.size > 128) throw new Error("KIT_PRESERVATION_FILE_LIMIT");
  return new Map(
    [...sources].map(([path, fact]) => [
      path,
      fact.kind === "file"
        ? { kind: "file", text: fact.text }
        : { kind: fact.kind },
    ]),
  );
}

/** Navigation evidence from bound sources; never an overall compaction verdict. */
export async function checkMemoryArchiveLinks(
  before: MemoryPreservationSnapshot,
  after: MemoryPreservationSnapshot,
  previousSources: ReadonlyMap<string, KitPathFact>,
  currentSources: ReadonlyMap<string, KitPathFact>,
  nowMs: number,
  afterDays: number,
): Promise<MemoryArchiveLinkReport> {
  const previous = capture(previousSources),
    current = capture(currentSources);
  if (before.files.length > 128 || after.files.length > 128)
    throw new Error("KIT_PRESERVATION_FILE_LIMIT");
  const expectedBefore = {
    ...before,
    files: before.files.map((file) => ({ ...file })),
  };
  const expectedAfter = {
    ...after,
    files: after.files.map((file) => ({ ...file })),
  };
  const [fragments, boundBefore, boundAfter] = await Promise.all([
    import("@/modules/workspace-kit/lib/archiveFragments").then(
      ({ checkMemoryArchiveFragments }) =>
        checkMemoryArchiveFragments(
          expectedBefore,
          expectedAfter,
          previous,
          current,
          nowMs,
          afterDays,
        ),
    ),
    snapshotMemoryPreservation(previous, true),
    snapshotMemoryPreservation(current, true),
  ]);
  const moves = compareMemoryArchiveFiles(boundBefore, boundAfter).moves;
  const owners = new Map<string, Set<string>>();
  const missingDocuments = new Set<string>(),
    unverifiedDocuments = new Set<string>();
  function hasLink(owner: string, target: string): boolean {
    let paths = owners.get(owner);
    if (!paths) {
      paths = new Set();
      const fact = current.get(owner);
      if (fact?.kind !== "file") missingDocuments.add(owner);
      else {
        const links = inspectMemoryLinks(fact.text, owner);
        if (!links.complete) unverifiedDocuments.add(owner);
        else paths = new Set(links.paths);
      }
      owners.set(owner, paths);
    }
    return paths.has(target);
  }
  const linkedMoves: string[] = [],
    missingMoves: string[] = [];
  for (const move of moves) {
    const owner = move.source.startsWith("plans/")
      ? "plans/INDEX.md"
      : "plans/TRACKING.md";
    (hasLink(owner, move.target) ? linkedMoves : missingMoves).push(
      move.source,
    );
  }
  const linkedFragments: string[] = [],
    missingFragments: string[] = [];
  for (const fragment of fragments.fragments) {
    (hasLink(fragment.source, fragment.target)
      ? linkedFragments
      : missingFragments
    ).push(`${fragment.source}#L${fragment.line}`);
  }
  const ordered = (values: Iterable<string>) =>
    Object.freeze([...values].sort(scalarCompare));
  return Object.freeze({
    linkedMoves: ordered(linkedMoves),
    missingMoves: ordered(missingMoves),
    linkedFragments: ordered(linkedFragments),
    missingFragments: ordered(missingFragments),
    missingDocuments: ordered(missingDocuments),
    unverifiedDocuments: ordered(unverifiedDocuments),
    fragments,
  });
}
