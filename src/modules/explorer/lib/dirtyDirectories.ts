import { parentPath } from "./path";

/**
 * Picks which loaded directories a batch of filesystem changes invalidates.
 *
 * Rust coalesces watcher events over a quiet gap and a one-second ceiling, so
 * a single batch during a build or an install can carry thousands of paths.
 * Comparing every path against every loaded directory, normalizing the
 * directory again inside the inner loop, made this quadratic on the main
 * thread once per second. Normalizing the directories once and looking each
 * path up makes it linear in the sum instead of the product.
 */

function normalize(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
}

export function selectDirtyDirectories(
  changedPaths: readonly string[],
  loadedDirectories: readonly string[],
): string[] {
  if (changedPaths.length === 0 || loadedDirectories.length === 0) return [];

  // One directory can appear under several spellings (drive-letter case on
  // Windows), and all of them need relisting, so the index keeps every key
  // that shares a normalized form.
  const byNormalized = new Map<string, string[]>();
  for (const directory of loadedDirectories) {
    const key = normalize(directory);
    const existing = byNormalized.get(key);
    if (existing) existing.push(directory);
    else byNormalized.set(key, [directory]);
  }

  const dirty = new Set<string>();
  for (const path of changedPaths) {
    // The directory holding the changed entry, and the entry itself when it
    // is a directory whose own listing is open.
    for (const candidate of [normalize(parentPath(path)), normalize(path)]) {
      const matches = byNormalized.get(candidate);
      if (!matches) continue;
      for (const match of matches) dirty.add(match);
    }
  }
  return [...dirty];
}
