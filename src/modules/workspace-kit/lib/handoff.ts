import { isUnicodeScalarText } from "@/modules/workspace-kit/lib/validation";

/** Uses the portable UTC filename rather than filesystem timestamps. */
export function handoffCreatedAtMs(name: string): number | null {
  if (
    name.length > 256 ||
    new TextEncoder().encode(name).byteLength > 256 ||
    !isUnicodeScalarText(name) ||
    /[\p{Cc}/\\]/u.test(name)
  )
    return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})-(.+)\.md$/su.exec(
    name,
  );
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  if (year < 1970) return null;
  const value = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(value);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute
    ? value
    : null;
}
