export type WebProjectKind = "laravel" | "wordpress" | "php" | "static";

export type WebProjectEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
};

/**
 * Classifies a folder from its top-level entries so the integrated server can
 * be offered for a whole project, not only for an open HTML or PHP file. Node
 * projects are left out on purpose: their dev server is detected from the
 * terminal output instead.
 */
export function detectWebProject(
  entries: readonly WebProjectEntry[],
): WebProjectKind | null {
  const files = new Set<string>();
  const dirs = new Set<string>();
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    (entry.kind === "dir" ? dirs : files).add(name);
  }
  if (files.has("artisan") && dirs.has("public")) return "laravel";
  if (
    dirs.has("wp-content") ||
    files.has("wp-config.php") ||
    files.has("wp-load.php")
  ) {
    return "wordpress";
  }
  if (files.has("index.php") || files.has("composer.json")) return "php";
  if (files.has("index.html") || files.has("index.htm")) return "static";
  return null;
}

export function webProjectLabel(kind: WebProjectKind): string {
  switch (kind) {
    case "laravel":
      return "Laravel";
    case "wordpress":
      return "WordPress";
    case "php":
      return "PHP";
    default:
      return "HTML";
  }
}

/** A project folder this computer can serve: absolute and not a remote URI. */
export function isLocalProjectRoot(path: string | null | undefined): path is string {
  if (!path || path.startsWith("remote://")) return false;
  return /^(?:[A-Za-z]:[\\/]|[\\/])/.test(path) && !/[\x00-\x1f]/.test(path);
}
