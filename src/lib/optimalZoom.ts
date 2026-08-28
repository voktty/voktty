export type ScreenDimensions = {
  width: number;
  height: number;
  devicePixelRatio?: number;
};

/**
 * Calculates an optimal initial zoom level based on the screen's logical/physical resolution
 * and device pixel ratio so that on the first run, Voktty does not appear oversized or cramped.
 */
export function getOptimalInitialZoomLevel(
  customScreen?: ScreenDimensions | null,
): number {
  const screen =
    customScreen ??
    (typeof window !== "undefined" && window.screen
      ? {
          width: window.screen.width,
          height: window.screen.height,
          devicePixelRatio: window.devicePixelRatio || 1,
        }
      : null);

  if (!screen?.width || !screen.height) {
    return 1.0;
  }

  const { width, height } = screen;

  // Very compact displays (e.g. 768p, 720p, or 1080p scaled at 150% = 720 CSS px)
  if (height <= 768 || width <= 1280) {
    return 0.85;
  }

  // Common laptop displays (e.g. 1080p scaled at 125% = 864 CSS px, or 1440x900 / 2880x1800 @ 2x = 900 CSS px)
  if (height <= 920 || width <= 1440) {
    return 0.9;
  }

  // Standard 1080p displays (1920x1080 at 100% scaling, or 1440p at 125% = 1152 CSS px)
  if (height <= 1080) {
    return 0.95;
  }

  // High-resolution / large monitors (1440p, 4K at standard scaling)
  return 1.0;
}
