import { compareMemoryArchiveFiles } from "@/modules/workspace-kit/lib/archiveFiles";
import { handoffCreatedAtMs } from "@/modules/workspace-kit/lib/handoff";
import {
  scalarCompare,
  type MemoryPreservationSnapshot,
} from "@/modules/workspace-kit/lib/preservation";
import { isUnicodeScalarText } from "@/modules/workspace-kit/lib/validation";

export type MemoryArchiveLogReport = Readonly<{
  loggedMoves: readonly string[];
  missingMoves: readonly string[];
  missingSizes: readonly string[];
  invalidLines: readonly number[];
  unmatchedLines: readonly number[];
  duplicateLines: readonly number[];
  complete: boolean;
}>;
const encoder = new TextEncoder();

function size(raw: string): number | null | undefined {
  if (raw === "-") return null;
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) return undefined;
  const value = Number(raw);
  return value <= 256 * 1024 ? value : undefined;
}

function metadata(date: string, agent: string): boolean {
  return (
    date.length === 10 &&
    handoffCreatedAtMs(`${date}-0000-log.md`) !== null &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(agent)
  );
}

/** Appended raw TSV records, independent of Markdown rendering or approval. */
export async function checkMemoryArchiveLog(
  before: MemoryPreservationSnapshot,
  after: MemoryPreservationSnapshot,
  beforeLog: string,
  afterLog: string,
): Promise<MemoryArchiveLogReport> {
  for (const text of [beforeLog, afterLog]) {
    if (text.length > 256 * 1024 || encoder.encode(text).length > 256 * 1024)
      throw new Error("KIT_ARCHIVE_LOG_LIMIT");
    if (!isUnicodeScalarText(text)) throw new Error("KIT_ARCHIVE_LOG_CHANGED");
  }
  const matches = await Promise.all(
    [before, after].map(async (snapshot, index) => {
      const bytes = encoder.encode(index === 0 ? beforeLog : afterLog);
      const file = snapshot.files.find(
        (entry) => entry.path === "archive/LOG.md",
      );
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return file?.bytes === bytes.length && file.sha256 === sha256;
    }),
  );
  if (matches.some((match) => !match))
    throw new Error("KIT_ARCHIVE_LOG_CHANGED");
  const suffix = afterLog.slice(beforeLog.length);
  if (
    !afterLog.startsWith(beforeLog) ||
    (beforeLog &&
      !beforeLog.endsWith("\n") &&
      suffix &&
      !suffix.startsWith("\n") &&
      !suffix.startsWith("\r\n"))
  )
    throw new Error("KIT_ARCHIVE_LOG_NOT_APPEND_ONLY");
  const archive = compareMemoryArchiveFiles(before, after);
  const changed =
    before.files.some(
      (old) =>
        old.kind !== "record" &&
        !after.files.some(
          (now) =>
            now.path === old.path &&
            now.sha256 === old.sha256 &&
            now.bytes === old.bytes,
        ),
    ) ||
    after.files.some(
      (now) =>
        now.kind !== "record" &&
        !before.files.some((old) => old.path === now.path),
    );
  const moves = new Map(archive.moves.map((move) => [move.source, move]));
  const sizes = new Map<string, [number | null, number | null]>();
  for (const [index, snapshot] of [before, after].entries()) {
    for (const file of snapshot.files) {
      if (file.kind !== "live") continue;
      const pair = sizes.get(file.path) ?? [null, null];
      pair[index] = file.bytes;
      sizes.set(file.path, pair);
    }
  }
  const invalidLines: number[] = [];
  const unmatchedLines: number[] = [];
  const duplicateLines: number[] = [];
  const seenMoves = new Set<string>();
  const seenSizes = new Set<string>();
  let offset = 0;
  let records = 0;
  for (const [index, raw] of afterLog.split("\n").entries()) {
    const appended = offset >= beforeLog.length;
    offset += raw.length + 1;
    if (!appended || !raw.includes("VOKTTY-")) continue;
    if (++records > 1024) throw new Error("KIT_ARCHIVE_LOG_LIMIT");
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (encoder.encode(line).length > 16 * 1024 || line.includes("\r")) {
      invalidLines.push(index + 1);
      continue;
    }
    const fields = line.split("\t");
    if (fields.length < 3 || !metadata(fields[1], fields[2])) {
      invalidLines.push(index + 1);
      continue;
    }
    if (fields[0] === "VOKTTY-MOVE-1" && fields.length === 7) {
      const bytes = size(fields[5]);
      if (
        encoder.encode(fields[3]).length > 4096 ||
        encoder.encode(fields[4]).length > 4096 ||
        bytes === undefined ||
        bytes === null ||
        !/^[0-9a-f]{64}$/.test(fields[6])
      )
        invalidLines.push(index + 1);
      else if (seenMoves.has(fields[3])) duplicateLines.push(index + 1);
      else {
        seenMoves.add(fields[3]);
        const move = moves.get(fields[3]);
        if (
          !move ||
          move.target !== fields[4] ||
          move.bytes !== bytes ||
          move.sha256 !== fields[6]
        )
          unmatchedLines.push(index + 1);
      }
    } else if (fields[0] === "VOKTTY-SIZE-1" && fields.length === 6) {
      const previous = size(fields[4]);
      const current = size(fields[5]);
      if (
        encoder.encode(fields[3]).length > 4096 ||
        previous === undefined ||
        current === undefined
      )
        invalidLines.push(index + 1);
      else if (seenSizes.has(fields[3])) duplicateLines.push(index + 1);
      else {
        seenSizes.add(fields[3]);
        const pair = sizes.get(fields[3]);
        if (!pair || pair[0] !== previous || pair[1] !== current)
          unmatchedLines.push(index + 1);
      }
    } else invalidLines.push(index + 1);
  }
  const complete =
    !invalidLines.length && !unmatchedLines.length && !duplicateLines.length;
  if (!complete) {
    seenMoves.clear();
    seenSizes.clear();
  }
  const ordered = (paths: string[]) => Object.freeze(paths.sort(scalarCompare));
  return Object.freeze({
    loggedMoves: ordered(
      [...moves.keys()].filter((path) => seenMoves.has(path)),
    ),
    missingMoves: ordered(
      [...moves.keys()].filter((path) => !seenMoves.has(path)),
    ),
    missingSizes: ordered(
      changed || records > 0
        ? [...sizes.keys()].filter((path) => !seenSizes.has(path))
        : [],
    ),
    invalidLines: Object.freeze(invalidLines),
    unmatchedLines: Object.freeze(unmatchedLines),
    duplicateLines: Object.freeze(duplicateLines),
    complete,
  });
}
