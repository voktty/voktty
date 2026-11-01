import { compareMemoryArchiveFiles } from "@/modules/workspace-kit/lib/archiveFiles";
import type { KitPathFact } from "@/modules/workspace-kit/lib/deployment";
import { handoffCreatedAtMs } from "@/modules/workspace-kit/lib/handoff";
import { visibleMemoryLines } from "@/modules/workspace-kit/lib/memory";
import {
  scalarCompare,
  snapshotMemoryPreservation,
  type MemoryPreservationSnapshot,
} from "@/modules/workspace-kit/lib/preservation";

export type MemoryArchiveFragment = Readonly<{
  source: string;
  line: number;
  target: string;
  bytes: number;
  sha256: string;
}>;
export type MemoryArchiveFragmentReport = Readonly<{
  fragments: readonly MemoryArchiveFragment[];
  missingFragments: readonly string[];
  unknownDates: readonly string[];
  futureDates: readonly string[];
  tooRecent: readonly string[];
  openFragments: readonly string[];
  ambiguousFragments: readonly string[];
  unverifiedSources: readonly string[];
  rewrittenArchives: readonly string[];
  unattributedArchives: readonly string[];
}>;
type Unit = {
  source: string;
  line: number;
  endLine: number;
  body: string;
  header: string;
  date: string | null;
};
const encoder = new TextEncoder();

function units(
  source: string,
  text: string,
): { units: Unit[]; plain: boolean } {
  const visible = visibleMemoryLines(text);
  const raw = text.split("\n");
  const boundaries: {
    line: number;
    offset: number;
    level: number;
    candidate: boolean;
    header: string;
    date: string | null;
  }[] = [];
  let offset = 0;
  let plain = true;
  for (const [index, line] of visible.lines) {
    const original = raw[index].endsWith("\r")
      ? raw[index].slice(0, -1)
      : raw[index];
    const heading = /^(#{1,6})[ \t]+/.exec(line);
    const bullet = /^(?:[-+*]|[0-9]{1,9}[.)])[ \t]+/.exec(line);
    const stripped = line
      .replace(/\[([TDQ]-[1-9][0-9]*)( done)?\]/g, "")
      .replace(/^(?:#{1,6}|[-+*]|[0-9]{1,9}[.)])[ \t]+/, "");
    if (/[<>`*_[\]()\\~]/.test(stripped) || /^>/.test(line)) plain = false;
    if (heading || bullet) {
      if (boundaries.length === 1024)
        throw new Error("KIT_ARCHIVE_FRAGMENT_LIMIT");
      const dayMatch =
        source === "continuity/CHANGELOG.md"
          ? /^## ([0-9]{4}-[0-9]{2}-[0-9]{2})$/.exec(line)
          : null;
      const day = dayMatch?.[0] === line ? dayMatch : null;
      const closed = / · closed ([0-9]{4}-[0-9]{2}-[0-9]{2})$/.exec(line);
      const date =
        original === line &&
        (day?.[0] === line ||
          (closed &&
            line.endsWith(closed[0]) &&
            line.split(" · closed ").length === 2))
          ? (day?.[1] ?? closed?.[1] ?? null)
          : null;
      boundaries.push({
        line: index + 1,
        offset,
        level: heading?.[1].length ?? 0,
        candidate: Boolean(day) || /\[[TDQ]-[1-9][0-9]* done\]/.test(line),
        header: raw[index],
        date,
      });
    }
    offset += raw[index].length + 1;
  }
  const result: Unit[] = [];
  let occupiedUntil = 0;
  for (let i = 0; i < boundaries.length; i += 1) {
    const start = boundaries[i];
    if (!start.candidate || start.offset < occupiedUntil) continue;
    const end = boundaries
      .slice(i + 1)
      .find(
        (next) =>
          start.level === 0 || (next.level > 0 && next.level <= start.level),
      );
    occupiedUntil = end?.offset ?? text.length;
    result.push({
      source,
      line: start.line,
      endLine: (end?.line ?? raw.length + 1) - 1,
      body: text.slice(start.offset, occupiedUntil),
      header: start.header,
      date: start.date,
    });
  }
  if (
    source === "continuity/CHANGELOG.md" &&
    boundaries.some(
      (boundary) =>
        boundary.level >= 2 &&
        !result.some(
          (unit) => boundary.line >= unit.line && boundary.line <= unit.endLine,
        ),
    )
  )
    plain = false;
  return { units: result, plain: plain && visible.warnings().length === 0 };
}

function capture(
  documents: ReadonlyMap<string, KitPathFact>,
): Map<string, KitPathFact> {
  if (documents.size > 128) throw new Error("KIT_PRESERVATION_FILE_LIMIT");
  return new Map(
    [...documents].map(([path, fact]) => [
      path,
      fact.kind === "file"
        ? { kind: "file", text: fact.text }
        : { kind: fact.kind },
    ]),
  );
}

function matches(
  expected: MemoryPreservationSnapshot,
  actual: MemoryPreservationSnapshot,
): boolean {
  return (
    expected.files.length === actual.files.length &&
    expected.files.every((file, index) => {
      const now = actual.files[index];
      return (
        file.path === now.path &&
        file.sha256 === now.sha256 &&
        file.bytes === now.bytes
      );
    })
  );
}

/** Binds actual source bytes and credits only intact, uniquely attributed appended blocks. */
export async function checkMemoryArchiveFragments(
  before: MemoryPreservationSnapshot,
  after: MemoryPreservationSnapshot,
  previousSources: ReadonlyMap<string, KitPathFact>,
  currentSources: ReadonlyMap<string, KitPathFact>,
  nowMs: number,
  afterDays: number,
): Promise<MemoryArchiveFragmentReport> {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    nowMs > 8640000000000000 ||
    !Number.isInteger(afterDays) ||
    afterDays < 1 ||
    afterDays > 36500
  )
    throw new Error("KIT_ARCHIVE_TIME_INVALID");
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
  const previous = capture(previousSources);
  const current = capture(currentSources);
  const [boundBefore, boundAfter] = await Promise.all([
    snapshotMemoryPreservation(previous, true),
    snapshotMemoryPreservation(current, true),
  ]);
  if (
    !matches(expectedBefore, boundBefore) ||
    !matches(expectedAfter, boundAfter)
  )
    throw new Error("KIT_ARCHIVE_FRAGMENT_SOURCE_CHANGED");
  const text = (facts: ReadonlyMap<string, KitPathFact>, path: string) => {
    const fact = facts.get(path);
    return fact?.kind === "file" ? fact.text : "";
  };
  const whole = compareMemoryArchiveFiles(boundBefore, boundAfter).moves;
  const missingFragments = new Set<string>();
  const unknownDates = new Set<string>();
  const futureDates = new Set<string>();
  const tooRecent = new Set<string>();
  const openFragments = new Set<string>();
  const ambiguousFragments = new Set<string>();
  const unverifiedSources = new Set<string>();
  const rewrittenArchives = new Set<string>();
  const unattributedArchives = new Set<string>();
  const candidates = new Map<string, Map<string, Unit[]>>();
  let budget = 64 * 1024 * 1024;
  let count = 0;
  const key = (unit: Unit) => `${unit.source}#L${unit.line}`;
  for (const file of boundBefore.files) {
    if (file.kind !== "live" || whole.some((move) => move.source === file.path))
      continue;
    const old = text(previous, file.path);
    const now = text(current, file.path);
    if (old === now) continue;
    const extracted = units(file.path, old);
    if (
      !extracted.plain ||
      file.items.some(
        (item) =>
          item.state === "done" &&
          !extracted.units.some(
            (unit) => item.line >= unit.line && item.line <= unit.endLine,
          ),
      )
    ) {
      if (
        file.items.some((item) => item.state === "done") ||
        file.path === "continuity/CHANGELOG.md"
      )
        unverifiedSources.add(file.path);
      continue;
    }
    if (file.path === "continuity/CHANGELOG.md" && extracted.units.length === 0)
      unverifiedSources.add(file.path);
    const seenHeaders = new Set<string>();
    const nowBytes =
      boundAfter.files.find((currentFile) => currentFile.path === file.path)
        ?.bytes ?? 0;
    for (const unit of extracted.units) {
      count += 1;
      budget -= nowBytes;
      if (count > 256 || budget < 0)
        throw new Error("KIT_ARCHIVE_FRAGMENT_LIMIT");
      if (seenHeaders.has(unit.header)) unverifiedSources.add(file.path);
      seenHeaders.add(unit.header);
    }
    if (unverifiedSources.has(file.path)) continue;
    for (const unit of extracted.units) {
      if (now.includes(unit.body)) continue;
      const id = key(unit);
      if (
        file.items.some(
          (item) =>
            item.state === "open" &&
            item.line >= unit.line &&
            item.line <= unit.endLine,
        )
      ) {
        openFragments.add(id);
        continue;
      }
      const day = unit.date
        ? handoffCreatedAtMs(`${unit.date}-0000-fragment.md`)
        : null;
      if (day === null) {
        unknownDates.add(id);
        continue;
      }
      if (day > nowMs) {
        futureDates.add(id);
        continue;
      }
      if (nowMs - (day + 86400000 - 1) <= afterDays * 86400000) {
        tooRecent.add(id);
        continue;
      }
      const target = `archive/${unit.date?.slice(0, 7)}/${file.path.split("/").pop()}`;
      const entries = candidates.get(target) ?? new Map<string, Unit[]>();
      entries.set(unit.header, [...(entries.get(unit.header) ?? []), unit]);
      candidates.set(target, entries);
      missingFragments.add(id);
    }
  }
  for (const entries of candidates.values())
    for (const group of entries.values())
      if (group.length > 1)
        for (const unit of group) ambiguousFragments.add(key(unit));
  const credited: { unit: Unit; target: string }[] = [];
  for (const file of boundAfter.files) {
    if (
      file.kind !== "archive" ||
      whole.some((move) => move.target === file.path)
    )
      continue;
    const existed = boundBefore.files.some((old) => old.path === file.path);
    const old = text(previous, file.path);
    const now = text(current, file.path);
    if (existed && old === now) continue;
    if (!now.startsWith(old)) {
      rewrittenArchives.add(file.path);
      continue;
    }
    let suffix = now.slice(old.length);
    if (old && !old.endsWith("\n") && suffix) {
      if (suffix.startsWith("\r\n")) suffix = suffix.slice(2);
      else if (suffix.startsWith("\n")) suffix = suffix.slice(1);
      else {
        rewrittenArchives.add(file.path);
        continue;
      }
    }
    const selected: Unit[] = [];
    const used = new Set<string>();
    let qualified = suffix.length > 0;
    while (suffix) {
      const end = suffix.indexOf("\n");
      const header = end < 0 ? suffix : suffix.slice(0, end);
      const group = candidates.get(file.path)?.get(header);
      const unit = group?.length === 1 ? group[0] : undefined;
      if (!unit || used.has(key(unit)) || !suffix.startsWith(unit.body)) {
        qualified = false;
        break;
      }
      selected.push(unit);
      used.add(key(unit));
      suffix = suffix.slice(unit.body.length);
      if (suffix && !unit.body.endsWith("\n")) {
        if (suffix.startsWith("\r\n")) suffix = suffix.slice(2);
        else if (suffix.startsWith("\n")) suffix = suffix.slice(1);
        else {
          qualified = false;
          break;
        }
        if (!suffix) qualified = false;
      }
    }
    if (!qualified) unattributedArchives.add(file.path);
    else
      for (const unit of selected) {
        credited.push({ unit, target: file.path });
        missingFragments.delete(key(unit));
      }
  }
  const fragments = await Promise.all(
    credited.map(async ({ unit, target }) => {
      const bytes = encoder.encode(unit.body);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Object.freeze({
        source: unit.source,
        line: unit.line,
        target,
        bytes: bytes.length,
        sha256: [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
      });
    }),
  );
  const ordered = (values: Set<string>) =>
    Object.freeze([...values].sort(scalarCompare));
  return Object.freeze({
    fragments: Object.freeze(
      fragments.sort(
        (a, b) => scalarCompare(a.source, b.source) || a.line - b.line,
      ),
    ),
    missingFragments: ordered(missingFragments),
    unknownDates: ordered(unknownDates),
    futureDates: ordered(futureDates),
    tooRecent: ordered(tooRecent),
    openFragments: ordered(openFragments),
    ambiguousFragments: ordered(ambiguousFragments),
    unverifiedSources: ordered(unverifiedSources),
    rewrittenArchives: ordered(rewrittenArchives),
    unattributedArchives: ordered(unattributedArchives),
  });
}
