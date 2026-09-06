// Parses git's own conflict-marker format so a conflicted file's content can
// be split into plain segments and per-hunk choices, without needing a real
// 3-way merge engine — git already resolved everything it could; what's left
// is exactly what these markers delimit.
//
//   <<<<<<< HEAD
//   ours
//   ||||||| merged common ancestors   (only with diff3-style conflict markers)
//   base
//   =======
//   theirs
//   >>>>>>> branch-name

const OURS_START = "<<<<<<<";
const BASE_START = "|||||||";
const SPLIT = "=======";
const THEIRS_END = ">>>>>>>";

export type ConflictHunk = {
  /** 0-indexed line where the `<<<<<<<` marker sits. */
  startLine: number;
  /** 0-indexed line where the `>>>>>>>` marker sits (inclusive). */
  endLine: number;
  oursLabel: string;
  theirsLabel: string;
  oursLines: string[];
  /** Only present for diff3-style conflict markers (`merge.conflictstyle = diff3`). */
  baseLines: string[] | null;
  theirsLines: string[];
};

export type ParsedConflicts = {
  lines: string[];
  hunks: ConflictHunk[];
};

export function parseConflictMarkers(text: string): ParsedConflicts {
  const lines = text.split("\n");
  const hunks: ConflictHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith(OURS_START)) {
      i++;
      continue;
    }
    const startLine = i;
    const oursLabel = lines[i].slice(OURS_START.length).trim();
    let cursor = i + 1;

    const oursLines: string[] = [];
    while (
      cursor < lines.length &&
      !lines[cursor].startsWith(BASE_START) &&
      !lines[cursor].startsWith(SPLIT)
    ) {
      oursLines.push(lines[cursor]);
      cursor++;
    }

    let baseLines: string[] | null = null;
    if (cursor < lines.length && lines[cursor].startsWith(BASE_START)) {
      baseLines = [];
      cursor++;
      while (cursor < lines.length && !lines[cursor].startsWith(SPLIT)) {
        baseLines.push(lines[cursor]);
        cursor++;
      }
    }

    if (cursor >= lines.length || !lines[cursor].startsWith(SPLIT)) {
      // Not a real conflict block (e.g. a "=======" heading underline that
      // happened to follow a "<<<<<<<" line unrelated to a real conflict).
      i = startLine + 1;
      continue;
    }
    cursor++; // skip the "=======" line itself

    const theirsLines: string[] = [];
    while (cursor < lines.length && !lines[cursor].startsWith(THEIRS_END)) {
      theirsLines.push(lines[cursor]);
      cursor++;
    }
    if (cursor >= lines.length) {
      // Never closed - malformed, treat as plain text instead of a hunk.
      i = startLine + 1;
      continue;
    }

    const endLine = cursor;
    const theirsLabel = lines[cursor].slice(THEIRS_END.length).trim();
    hunks.push({
      startLine,
      endLine,
      oursLabel,
      theirsLabel,
      oursLines,
      baseLines,
      theirsLines,
    });
    i = endLine + 1;
  }
  return { lines, hunks };
}

export function hasConflictMarkers(text: string): boolean {
  return parseConflictMarkers(text).hunks.length > 0;
}

export type ConflictResolution = "ours" | "theirs" | "both" | "base";

/**
 * Rebuilds the file by replacing every hunk's marker block with the chosen
 * side. Hunks with no entry in `resolutions` default to "ours" — the same
 * side git already left the file resolving to when it opens.
 */
export function applyConflictResolutions(
  parsed: ParsedConflicts,
  resolutions: ReadonlyMap<number, ConflictResolution>,
): string {
  const out: string[] = [];
  let cursor = 0;
  for (let h = 0; h < parsed.hunks.length; h++) {
    const hunk = parsed.hunks[h];
    out.push(...parsed.lines.slice(cursor, hunk.startLine));
    const resolution = resolutions.get(h) ?? "ours";
    if (resolution === "theirs") {
      out.push(...hunk.theirsLines);
    } else if (resolution === "both") {
      out.push(...hunk.oursLines, ...hunk.theirsLines);
    } else if (resolution === "base" && hunk.baseLines !== null) {
      out.push(...hunk.baseLines);
    } else {
      out.push(...hunk.oursLines);
    }
    cursor = hunk.endLine + 1;
  }
  out.push(...parsed.lines.slice(cursor));
  return out.join("\n");
}
