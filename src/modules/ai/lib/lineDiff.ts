export type LineDiffKind = "context" | "add" | "remove";

export type LineDiffLine = {
  kind: LineDiffKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export type LineDiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: LineDiffLine[];
};

export function formatLineDiffHunkHeader(hunk: LineDiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

const MAX_LCS_CELLS = 4_000_000;

function fallbackOps(before: string[], after: string[]): LineDiffKind[] {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  return [
    ...Array<LineDiffKind>(prefix).fill("context"),
    ...Array<LineDiffKind>(before.length - prefix - suffix).fill("remove"),
    ...Array<LineDiffKind>(after.length - prefix - suffix).fill("add"),
    ...Array<LineDiffKind>(suffix).fill("context"),
  ];
}

function lcsOps(before: string[], after: string[]): LineDiffKind[] {
  if (before.length * after.length > MAX_LCS_CELLS) {
    return fallbackOps(before, after);
  }
  const width = after.length + 1;
  const table = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      const at = i * width + j;
      table[at] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const ops: LineDiffKind[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      ops.push("context");
      i++;
      j++;
    } else if (
      i < before.length &&
      (j >= after.length ||
        table[(i + 1) * width + j] >= table[i * width + j + 1])
    ) {
      ops.push("remove");
      i++;
    } else {
      ops.push("add");
      j++;
    }
  }
  return ops;
}

export function createLineDiff(
  original: string,
  proposed: string,
  contextLines = 3,
): { hunks: LineDiffHunk[]; stats: { added: number; removed: number } } {
  const before = original.split("\n");
  const after = proposed.split("\n");
  const kinds = lcsOps(before, after);
  const lines: LineDiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  for (const kind of kinds) {
    const text =
      kind === "add" ? (after[newIndex] ?? "") : (before[oldIndex] ?? "");
    lines.push({
      kind,
      text,
      oldLine: kind === "add" ? null : oldIndex + 1,
      newLine: kind === "remove" ? null : newIndex + 1,
    });
    if (kind !== "add") oldIndex++;
    if (kind !== "remove") newIndex++;
  }
  const changed = lines.flatMap((line, index) =>
    line.kind === "context" ? [] : [index],
  );
  if (changed.length === 0) {
    return { hunks: [], stats: { added: 0, removed: 0 } };
  }
  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changed) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(lines.length, index + contextLines + 1);
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous.end)
      previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }
  const hunks = ranges.map(({ start, end }) => {
    const hunkLines = lines.slice(start, end);
    const old = hunkLines.flatMap((line) =>
      line.oldLine === null ? [] : [line.oldLine],
    );
    const next = hunkLines.flatMap((line) =>
      line.newLine === null ? [] : [line.newLine],
    );
    return {
      oldStart: old[0] ?? 0,
      oldLines: old.length,
      newStart: next[0] ?? 0,
      newLines: next.length,
      lines: hunkLines,
    };
  });
  return {
    hunks,
    stats: {
      added: lines.filter((line) => line.kind === "add").length,
      removed: lines.filter((line) => line.kind === "remove").length,
    },
  };
}
