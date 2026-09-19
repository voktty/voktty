/**
 * Coercion for the working directory the app hands to its chrome.
 *
 * `activeCwd` is assembled from a terminal's OSC 7 reading, a harness session,
 * a persisted tab, an explorer root, a space root and a recents entry. Several
 * of those cross a boundary where the type is asserted rather than checked: a
 * persisted JSON document, a SQLite row, a CustomEvent detail. A non-string
 * getting through crashes whichever consumer calls a string method on it,
 * which is why `segmentsFromCwd` already guards the same way. Funnelling every
 * source through one coercion fixes the current consumers and the next one.
 */

export function coerceCwd(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() === "" ? null : value;
}

/** First candidate that is a usable path, in priority order. */
export function firstCwd(...candidates: readonly unknown[]): string | null {
  for (const candidate of candidates) {
    const cwd = coerceCwd(candidate);
    if (cwd !== null) return cwd;
  }
  return null;
}
