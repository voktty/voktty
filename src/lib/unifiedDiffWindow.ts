import {
  revealedFold,
  type FoldReveal,
  type UnifiedBlock,
  type UnifiedLine,
} from "./unifiedDiff";

export const UNIFIED_LINE_PX = 20;
export const UNIFIED_FOLD_PX = 32;
export const UNIFIED_HUNK_PX = 22;
export const UNIFIED_OVERSCAN_PX = 1200;

export type DiffViewRow =
  | { type: "line"; line: UnifiedLine; stage: boolean; height: number }
  | { type: "fold"; id: string; hidden: number; height: number };

export type RowWindow = {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
};

export function flattenVisibleRows(
  blocks: readonly UnifiedBlock[],
  revealFor: (foldId: string) => FoldReveal | undefined,
  canStageHunk = false,
): DiffViewRow[] {
  const rows: DiffViewRow[] = [];
  for (const block of blocks) {
    if (block.kind === "fold") {
      const split = revealedFold(block.lines.length, revealFor(block.id));
      pushLines(rows, block.lines.slice(0, split.head), false);
      if (split.hidden > 0) {
        rows.push({
          type: "fold",
          id: block.id,
          hidden: split.hidden,
          height: UNIFIED_FOLD_PX,
        });
      }
      if (split.tail > 0) {
        pushLines(
          rows,
          block.lines.slice(block.lines.length - split.tail),
          false,
        );
      }
      continue;
    }
    let staged = false;
    for (const line of block.lines) {
      const stage =
        canStageHunk &&
        !staged &&
        (line.kind === "add" || line.kind === "del") &&
        block.pos != null;
      if (stage) staged = true;
      rows.push({
        type: "line",
        line,
        stage,
        height: line.kind === "hunk" ? UNIFIED_HUNK_PX : UNIFIED_LINE_PX,
      });
    }
  }
  return rows;
}

export function rowsHeight(rows: readonly DiffViewRow[]): number {
  let height = 0;
  for (const row of rows) height += row.height;
  return height;
}

export function windowRows(
  rows: readonly DiffViewRow[],
  viewTop: number,
  viewBottom: number,
  overscan = UNIFIED_OVERSCAN_PX,
): RowWindow {
  const total = rowsHeight(rows);
  if (rows.length === 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  }
  const from = viewTop - overscan;
  const to = viewBottom + overscan;
  if (to <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: total };
  }
  if (from >= total) {
    return { start: rows.length, end: rows.length, padTop: total, padBottom: 0 };
  }

  let y = 0;
  let start = 0;
  let padTop = 0;
  let found = false;
  for (let index = 0; index < rows.length; index += 1) {
    const next = y + rows[index].height;
    if (next > from) {
      start = index;
      padTop = y;
      found = true;
      break;
    }
    y = next;
  }
  if (!found) {
    return { start: rows.length, end: rows.length, padTop: total, padBottom: 0 };
  }

  let end = rows.length;
  y = padTop;
  for (let index = start; index < rows.length; index += 1) {
    y += rows[index].height;
    if (y >= to) {
      end = index + 1;
      break;
    }
  }
  return {
    start,
    end,
    padTop,
    padBottom: total - padTop - rowsHeight(rows.slice(start, end)),
  };
}

function pushLines(
  rows: DiffViewRow[],
  lines: readonly UnifiedLine[],
  canStage: boolean,
) {
  let staged = false;
  for (const line of lines) {
    const stage = canStage && !staged && (line.kind === "add" || line.kind === "del");
    if (stage) staged = true;
    rows.push({
      type: "line",
      line,
      stage,
      height: line.kind === "hunk" ? UNIFIED_HUNK_PX : UNIFIED_LINE_PX,
    });
  }
}
