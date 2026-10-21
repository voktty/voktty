const REMOTE_ENVIRONMENT = /^remote:\/\/[^/]+/;

export function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized) return normalized;

  // `remote://<environment>/` is the top of another machine; never step above it.
  const remote = REMOTE_ENVIRONMENT.exec(normalized);
  if (remote) {
    const root = `${remote[0]}/`;
    const below = normalized.slice(remote[0].length).replace(/^\/+|\/+$/g, "");
    if (!below.includes("/")) return root;
    return `${remote[0]}/${below.slice(0, below.lastIndexOf("/"))}`;
  }

  const trimmed =
    normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  if (!trimmed && normalized.startsWith("/")) return "/";
  if (trimmed === "/" || /^[A-Za-z]:\/?$/.test(trimmed)) return normalized;

  if (trimmed.startsWith("//")) {
    const segments = trimmed.slice(2).split("/").filter(Boolean);
    if (segments.length <= 2) return trimmed;
  }

  const separator = trimmed.lastIndexOf("/");
  if (separator < 0) return trimmed;
  if (separator === 0) return "/";

  const parent = trimmed.slice(0, separator);
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}/`;
  return parent;
}
