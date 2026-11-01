import {
  compareMemoryArchiveFiles,
  type MemoryArchiveMove,
} from "@/modules/workspace-kit/lib/archiveFiles";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import { handoffCreatedAtMs } from "@/modules/workspace-kit/lib/handoff";
import { visibleMemoryLines } from "@/modules/workspace-kit/lib/memory";
import type { MemoryPreservationSnapshot } from "@/modules/workspace-kit/lib/preservation";
import { isUnicodeScalarText } from "@/modules/workspace-kit/lib/validation";

export type MemoryArchiveTimeReport = Readonly<{
  qualifiedMoves: readonly string[];
  unknownDates: readonly string[];
  futureDates: readonly string[];
  tooRecent: readonly string[];
  wrongMonths: readonly string[];
}>;

type ArchiveDate = { firstMs: number; lastMs: number; month: string };

function validateTime(nowMs: number, afterDays: number) {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    nowMs > 8640000000000000 ||
    !Number.isInteger(afterDays) ||
    afterDays < 1 ||
    afterDays > 36500
  )
    throw new Error("KIT_ARCHIVE_TIME_INVALID");
}

function archiveTimeReport(
  moves: readonly MemoryArchiveMove[],
  nowMs: number,
  afterDays: number,
  planDates: ReadonlyMap<string, ArchiveDate>,
): MemoryArchiveTimeReport {
  const qualifiedMoves: string[] = [];
  const unknownDates: string[] = [];
  const futureDates: string[] = [];
  const tooRecent: string[] = [];
  const wrongMonths: string[] = [];
  for (const move of moves) {
    const name = move.source.split("/").pop() ?? "";
    const created = move.source.startsWith("continuity/handoffs/")
      ? handoffCreatedAtMs(name)
      : null;
    const date =
      created === null
        ? planDates.get(move.source)
        : { firstMs: created, lastMs: created, month: name.slice(0, 7) };
    if (!date) {
      unknownDates.push(move.source);
      continue;
    }
    const wrongMonth = move.target.split("/")[1] !== date.month;
    const future = date.firstMs > nowMs;
    const recent = !future && nowMs - date.lastMs <= afterDays * 86400000;
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

function planClosedDate(text: string): ArchiveDate | null {
  const visible = visibleMemoryLines(text);
  const raw = text.split("\n");
  let header = true;
  let unknown = false;
  let fields = 0;
  let date: ArchiveDate | null = null;
  for (const [index, line] of visible.lines) {
    if (/^ {0,3}#{2,6}[ \t]+/.test(line)) header = false;
    if (!header || !line.trim()) continue;
    if (/^#[ \t]+/.test(line)) {
      const original = raw[index].endsWith("\r")
        ? raw[index].slice(0, -1)
        : raw[index];
      if (original !== line || /[<>`*_[\]()\\~#]/.test(line.slice(1)))
        unknown = true;
      continue;
    }
    if (/^(?:[ \t>]|[-+*][ \t]|[0-9]+[.)][ \t]|[-=]+[ \t]*$)/.test(line))
      unknown = true;
    if (!/State[ \t]*:/.test(line)) {
      if (/[<>`*_[\]()\\~#]/.test(line)) unknown = true;
      continue;
    }
    fields += 1;
    const original = raw[index].endsWith("\r")
      ? raw[index].slice(0, -1)
      : raw[index];
    const match =
      /^(?:Date:[ \t]+([0-9]{4}-[0-9]{2}-[0-9]{2})[ \t]+·[ \t]+)?State:[ \t]+(?:closed|\*\*closed\*\*)[ \t]+([0-9]{4}-[0-9]{2}-[0-9]{2})[ \t]*$/.exec(
        line,
      );
    const firstMs = match
      ? handoffCreatedAtMs(`${match[2]}-0000-plan.md`)
      : null;
    if (
      original !== line ||
      !match ||
      match[0] !== line ||
      firstMs === null ||
      (match[1] && handoffCreatedAtMs(`${match[1]}-0000-plan.md`) === null)
    ) {
      unknown = true;
      continue;
    }
    date = {
      firstMs,
      lastMs: firstMs + 86400000 - 1,
      month: match[2].slice(0, 7),
    };
  }
  return !unknown && fields === 1 && visible.warnings().length === 0
    ? date
    : null;
}

/** Temporal evidence for observed whole-file moves, never archive authorization. */
export function checkMemoryArchiveTime(
  before: MemoryPreservationSnapshot,
  after: MemoryPreservationSnapshot,
  nowMs: number,
  afterDays: number,
): MemoryArchiveTimeReport {
  validateTime(nowMs, afterDays);
  return archiveTimeReport(
    compareMemoryArchiveFiles(before, after).moves,
    nowMs,
    afterDays,
    new Map(),
  );
}

/** Qualifies plan closure dates only after binding original source bytes. */
export async function checkMemoryArchiveTimeWithSources(
  before: MemoryPreservationSnapshot,
  after: MemoryPreservationSnapshot,
  previousSources: ReadonlyMap<string, KitPathFact>,
  nowMs: number,
  afterDays: number,
): Promise<MemoryArchiveTimeReport> {
  validateTime(nowMs, afterDays);
  if (previousSources.size > 128)
    throw new Error("KIT_ARCHIVE_TIME_SOURCE_LIMIT");
  const moves = compareMemoryArchiveFiles(before, after).moves;
  const encoder = new TextEncoder();
  let total = 0;
  const captured = moves
    .filter((move) => move.source.startsWith("plans/"))
    .flatMap((move) => {
      const fact = previousSources.get(move.source);
      if (fact?.kind !== "file") return [];
      const text = fact.text;
      if (text.length > 256 * 1024)
        throw new Error("KIT_ARCHIVE_TIME_SOURCE_LIMIT");
      const bytes = encoder.encode(text);
      total += bytes.length;
      if (bytes.length > 256 * 1024 || total > 4 * 1024 * 1024)
        throw new Error("KIT_ARCHIVE_TIME_SOURCE_LIMIT");
      if (!isUnicodeScalarText(text))
        throw new Error("KIT_ARCHIVE_TIME_SOURCE_CHANGED");
      return [
        {
          source: move.source,
          bytes,
          sha256: move.sha256,
          expectedBytes: move.bytes,
          date: planClosedDate(text),
        },
      ];
    });
  const dates = await Promise.all(
    captured.map(async (source) => {
      const digest = await crypto.subtle.digest("SHA-256", source.bytes);
      const hash = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      if (
        source.bytes.length !== source.expectedBytes ||
        hash !== source.sha256
      )
        throw new Error("KIT_ARCHIVE_TIME_SOURCE_CHANGED");
      return [source.source, source.date] as const;
    }),
  );
  const planDates = new Map<string, ArchiveDate>();
  for (const [path, date] of dates) if (date) planDates.set(path, date);
  return archiveTimeReport(moves, nowMs, afterDays, planDates);
}
