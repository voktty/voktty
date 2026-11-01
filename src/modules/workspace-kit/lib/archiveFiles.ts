import {
  scalarCompare,
  type MemoryPreservationFile,
  type MemoryPreservationSnapshot,
} from "@/modules/workspace-kit/lib/preservation";

export type MemoryArchiveMove = Readonly<{
  source: string;
  target: string;
  sha256: string;
  bytes: number;
}>;

export type MemoryArchiveFileReport = Readonly<{
  moves: readonly MemoryArchiveMove[];
  missingMovedFiles: readonly string[];
  ambiguousFiles: readonly string[];
  ineligibleRemovedFiles: readonly string[];
  changedHandoffs: readonly string[];
  missingArchives: readonly string[];
  changedArchives: readonly string[];
  unattributedArchives: readonly string[];
}>;

function sameBytes(
  left: MemoryPreservationFile,
  right: MemoryPreservationFile,
) {
  return left.bytes === right.bytes && left.sha256 === right.sha256;
}

/** Whole-file movement evidence only, without age, LOG or item-fragment checks. */
export function compareMemoryArchiveFiles(
  before: MemoryPreservationSnapshot,
  after: MemoryPreservationSnapshot,
): MemoryArchiveFileReport {
  const previous = new Map(before.files.map((file) => [file.path, file]));
  const current = new Map(after.files.map((file) => [file.path, file]));
  const newArchives = after.files.filter(
    (file) => file.kind === "archive" && !previous.has(file.path),
  );
  const missingMovedFiles: string[] = [];
  const ambiguousFiles: string[] = [];
  const ineligibleRemovedFiles: string[] = [];
  const changedHandoffs: string[] = [];
  const missingArchives: string[] = [];
  const changedArchives: string[] = [];
  const moves: MemoryArchiveMove[] = [];
  const candidates: {
    source: MemoryPreservationFile;
    targets: MemoryPreservationFile[];
  }[] = [];
  const owners = new Map<string, number>();
  for (const file of before.files) {
    const now = current.get(file.path);
    if (now) {
      if (!sameBytes(file, now)) {
        if (file.kind === "archive") changedArchives.push(file.path);
        if (file.kind === "history") changedHandoffs.push(file.path);
      }
      continue;
    }
    if (file.kind === "archive") {
      missingArchives.push(file.path);
      continue;
    }
    const eligible =
      file.kind === "history" ||
      (file.planState === "closed" &&
        file.items.every((item) => item.state !== "open"));
    if (!eligible) {
      ineligibleRemovedFiles.push(file.path);
      continue;
    }
    const targets = newArchives.filter((target) => {
      const parts = target.path.split("/");
      return (
        parts.length === 3 &&
        parts[2] === file.path.split("/").pop() &&
        sameBytes(file, target)
      );
    });
    for (const target of targets)
      owners.set(target.path, (owners.get(target.path) ?? 0) + 1);
    candidates.push({ source: file, targets });
  }
  const attributed = new Set<string>();
  for (const { source, targets } of candidates) {
    if (targets.length === 0) missingMovedFiles.push(source.path);
    else if (targets.length !== 1 || owners.get(targets[0].path) !== 1)
      ambiguousFiles.push(source.path);
    else {
      attributed.add(targets[0].path);
      moves.push(
        Object.freeze({
          source: source.path,
          target: targets[0].path,
          sha256: source.sha256,
          bytes: source.bytes,
        }),
      );
    }
  }
  const ordered = (paths: string[]) => Object.freeze(paths.sort(scalarCompare));
  return Object.freeze({
    moves: Object.freeze(
      moves.sort((a, b) => scalarCompare(a.source, b.source)),
    ),
    missingMovedFiles: ordered(missingMovedFiles),
    ambiguousFiles: ordered(ambiguousFiles),
    ineligibleRemovedFiles: ordered(ineligibleRemovedFiles),
    changedHandoffs: ordered(changedHandoffs),
    missingArchives: ordered(missingArchives),
    changedArchives: ordered(changedArchives),
    unattributedArchives: ordered(
      newArchives
        .filter((file) => !attributed.has(file.path))
        .map((file) => file.path),
    ),
  });
}
