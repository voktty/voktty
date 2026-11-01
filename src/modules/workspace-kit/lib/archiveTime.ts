import { compareMemoryArchiveFiles } from "@/modules/workspace-kit/lib/archiveFiles";
import { handoffCreatedAtMs } from "@/modules/workspace-kit/lib/handoff";
import type { MemoryPreservationSnapshot } from "@/modules/workspace-kit/lib/preservation";

export type MemoryArchiveTimeReport = Readonly<{
  qualifiedMoves: readonly string[];
  unknownDates: readonly string[];
  futureDates: readonly string[];
  tooRecent: readonly string[];
  wrongMonths: readonly string[];
}>;

/** Temporal evidence for observed whole-file moves, never archive authorization. */
export function checkMemoryArchiveTime(
  before: MemoryPreservationSnapshot,
  after: MemoryPreservationSnapshot,
  nowMs: number,
  afterDays: number,
): MemoryArchiveTimeReport {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    nowMs > 8640000000000000 ||
    !Number.isInteger(afterDays) ||
    afterDays < 1 ||
    afterDays > 36500
  )
    throw new Error("KIT_ARCHIVE_TIME_INVALID");
  const qualifiedMoves: string[] = [];
  const unknownDates: string[] = [];
  const futureDates: string[] = [];
  const tooRecent: string[] = [];
  const wrongMonths: string[] = [];
  for (const move of compareMemoryArchiveFiles(before, after).moves) {
    const name = move.source.split("/").pop() ?? "";
    const created = move.source.startsWith("continuity/handoffs/")
      ? handoffCreatedAtMs(name)
      : null;
    if (created === null) {
      unknownDates.push(move.source);
      continue;
    }
    const wrongMonth = move.target.split("/")[1] !== name.slice(0, 7);
    const future = created > nowMs;
    const recent = !future && nowMs - created <= afterDays * 86400000;
    if (wrongMonth) wrongMonths.push(move.source);
    if (future) futureDates.push(move.source);
    if (recent) tooRecent.push(move.source);
    if (!wrongMonth && !future && !recent) qualifiedMoves.push(move.source);
  }
  return Object.freeze({
    qualifiedMoves: Object.freeze(qualifiedMoves),
    unknownDates: Object.freeze(unknownDates),
    futureDates: Object.freeze(futureDates),
    tooRecent: Object.freeze(tooRecent),
    wrongMonths: Object.freeze(wrongMonths),
  });
}
