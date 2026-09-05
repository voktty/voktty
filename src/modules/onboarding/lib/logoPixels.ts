export type LogoCell = {
  col: number;
  row: number;
  color: string;
};

type Segment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
};

const VIEWBOX = 512;

// The same three strokes as `public/voktty.svg`: left V arm, right V arm,
// terminal cursor bar. Kept manually in sync with that file since this
// rasterizes its exact geometry rather than a hand-traced bitmap.
const SEGMENTS: Segment[] = [
  { x1: 148, y1: 168, x2: 256, y2: 352, width: 44, color: "#F8FAFC" },
  { x1: 256, y1: 352, x2: 364, y2: 168, width: 44, color: "#6366F1" },
  { x1: 290, y1: 364, x2: 350, y2: 364, width: 36, color: "#10B981" },
];

function distanceToSegment(px: number, py: number, seg: Segment): number {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const lengthSq = dx * dx + dy * dy;
  let t =
    lengthSq === 0 ? 0 : ((px - seg.x1) * dx + (py - seg.y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = seg.x1 + t * dx;
  const cy = seg.y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Rasterizes the Voktty logo strokes into a `grid` x `grid` cell silhouette
 * (GitHub-heatmap style "big pixels"), assigning each cell the color of the
 * nearest stroke that actually passes within its own width. Deterministic
 * and pure so the pixel-art onboarding mark always matches the real vector
 * logo at any resolution instead of drifting from a hand-traced bitmap.
 */
export function rasterizeLogoGrid(grid: number): LogoCell[] {
  const cellSize = VIEWBOX / grid;
  const cells: LogoCell[] = [];
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const cx = (col + 0.5) * cellSize;
      const cy = (row + 0.5) * cellSize;
      let bestColor: string | null = null;
      let bestDist = Infinity;
      for (const seg of SEGMENTS) {
        const dist = distanceToSegment(cx, cy, seg);
        const threshold = seg.width / 2 + cellSize * 0.35;
        if (dist <= threshold && dist < bestDist) {
          bestDist = dist;
          bestColor = seg.color;
        }
      }
      if (bestColor) cells.push({ col, row, color: bestColor });
    }
  }
  return cells;
}
