/**
 * Turning a selection of paths into one transfer request.
 *
 * A request has a single root plus names relative to it, so a batch that spans
 * several directories has to be reduced to the deepest directory that contains
 * all of it. Pure, and separate from the IPC so the grouping is testable.
 */

export type Grouped = {
  root: string;
  items: string[];
};

/** Local paths arrive with either separator on Windows; remote ones never do. */
function segments(path: string, local: boolean): string[] {
  const normalized = local ? path.replace(/\\/g, "/") : path;
  return normalized.split("/");
}

/**
 * The deepest directory containing every path, and each path's name under it.
 *
 * Falls back to the shared prefix when the selection spans directories, which
 * keeps the destination mirroring the source rather than flattening it.
 */
export function group(paths: string[], local: boolean): Grouped | undefined {
  const usable = paths.filter((path) => path.trim().length > 0);
  if (usable.length === 0) return undefined;

  const split = usable.map((path) => segments(path, local));
  let shared = split[0].slice(0, -1);

  for (const parts of split.slice(1)) {
    const parent = parts.slice(0, -1);
    let index = 0;
    while (index < shared.length && index < parent.length && shared[index] === parent[index]) {
      index += 1;
    }
    shared = shared.slice(0, index);
  }

  const root = shared.join("/") || "/";
  const prefix = root === "/" ? 1 : root.length + 1;
  return {
    root,
    items: split.map((parts) => parts.join("/").slice(prefix)),
  };
}

/** The last segment, for the label a toast shows. */
export function displayName(path: string, local: boolean): string {
  const parts = segments(path, local).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}
