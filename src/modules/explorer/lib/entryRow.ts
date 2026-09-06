/** Resolves a path to its row through the path index.
 *
 * The index and the row list are rebuilt together on every tree change, but an
 * event handler can still hold the pair from an earlier render, and a keystroke
 * arriving mid-update would then index past the end. Callers get null rather
 * than an undefined row they would go on to dereference. */
export function entryRowAt<Row extends { kind: string }>(
  rows: readonly Row[],
  entryIndexByPath: ReadonlyMap<string, number>,
  path: string | undefined,
): Row | null {
  if (path === undefined) return null;
  const index = entryIndexByPath.get(path);
  if (index === undefined) return null;
  const row = rows[index];
  return row !== undefined && row.kind === "entry" ? row : null;
}
