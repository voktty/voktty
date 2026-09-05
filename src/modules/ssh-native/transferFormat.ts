/**
 * Turning transfer figures into what the panel shows.
 *
 * Pure and locale-independent: the unit words come from i18n, these only pick
 * the unit and the number.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export type Sized = {
  value: number;
  unit: (typeof UNITS)[number];
};

/**
 * Pick the largest unit that keeps the number above one, so a transfer never
 * reads as "0.00 MB" while it is clearly moving.
 */
export function sizeOf(bytes: number): Sized {
  if (!Number.isFinite(bytes) || bytes <= 0) return { value: 0, unit: "B" };

  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < UNITS.length - 1) {
    value /= 1024;
    index += 1;
  }
  return { value, unit: UNITS[index] };
}

/** Bytes use no decimals; larger units use one, which is enough to see movement. */
export function formatSize(bytes: number): string {
  const { value, unit } = sizeOf(bytes);
  return unit === "B" ? `${Math.round(value)} ${unit}` : `${value.toFixed(1)} ${unit}`;
}

export function formatSpeed(bytesPerSecond: number | undefined): string | undefined {
  if (bytesPerSecond === undefined || bytesPerSecond <= 0) return undefined;
  return `${formatSize(bytesPerSecond)}/s`;
}

/**
 * Rounded to a unit the user can read. Anything past an hour is reported in
 * hours rather than a precise figure that will be wrong within seconds.
 */
export function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/**
 * Completion as a whole percentage.
 *
 * A job with nothing to move is complete, not stuck at zero: a folder of empty
 * files still finished.
 */
export function percentDone(bytesDone: number, bytesTotal: number): number {
  if (bytesTotal <= 0) return 100;
  const ratio = (bytesDone / bytesTotal) * 100;
  return Math.max(0, Math.min(100, Math.round(ratio)));
}
