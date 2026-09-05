import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { rasterizeLogoGrid } from "./lib/logoPixels";

const GRID = 18;

// Stable per-cell shimmer timing, computed once at module load (not per
// mount) so switching onboarding steps back and forth never reshuffles or
// restarts it. Negative delays start each cell mid-cycle so the silhouette
// is already "breathing" on first paint instead of fading up from blank.
const PIXELS = rasterizeLogoGrid(GRID).map((cell) => ({
  ...cell,
  duration: 2.6 + Math.random() * 1.8,
  delay: -(Math.random() * 4),
  floor: 0.24 + Math.random() * 0.16,
  peak: 0.78 + Math.random() * 0.22,
}));

type Props = {
  size?: number;
  className?: string;
};

type PixelStyle = CSSProperties & {
  "--voktty-pixel-floor"?: string;
  "--voktty-pixel-peak"?: string;
};

/**
 * Pixel-art replica of `public/voktty.svg`, GitHub-heatmap style: each cell
 * of the rasterized silhouette breathes between a floor and a peak opacity
 * on its own timer, so the mark keeps forming and un-forming without ever
 * fully vanishing. Pure CSS grid + `@keyframes` (see `.voktty-pixel` in
 * globals.css) — no canvas loop, no new dependency.
 */
export function VokttyAnimatedLogo({ size = 160, className }: Props) {
  const gapPx = Math.max(1, size * 0.008);

  return (
    <div
      className={cn("grid shrink-0", className)}
      style={{
        width: size,
        height: size,
        gridTemplateColumns: `repeat(${GRID}, 1fr)`,
        gridTemplateRows: `repeat(${GRID}, 1fr)`,
        gap: gapPx,
      }}
      role="img"
      aria-label="Voktty"
    >
      {PIXELS.map((pixel) => {
        const style: PixelStyle = {
          gridColumn: pixel.col + 1,
          gridRow: pixel.row + 1,
          backgroundColor: pixel.color,
          animationDuration: `${pixel.duration.toFixed(2)}s`,
          animationDelay: `${pixel.delay.toFixed(2)}s`,
          "--voktty-pixel-floor": pixel.floor.toFixed(2),
          "--voktty-pixel-peak": pixel.peak.toFixed(2),
        };
        return (
          <span
            key={`${pixel.col}-${pixel.row}`}
            className="voktty-pixel"
            style={style}
          />
        );
      })}
    </div>
  );
}
