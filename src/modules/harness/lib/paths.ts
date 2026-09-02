/** Display path with home collapsed to `~`. */
export function prettyCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/, "") || "/";
  if (trimmed === "~") return "~";

  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const isWindowsUsers =
      parts.length >= 2 && /^[a-zA-Z]:$/.test(parts[0]) && parts[1] === "Users";
    const isUnixUsers = parts[0] === "Users" || parts[0] === "home";
    if (isWindowsUsers) {
      const rest = parts.slice(3).join("/");
      return rest ? `~/${rest}` : "~";
    }
    if (isUnixUsers) {
      const rest = parts.slice(2).join("/");
      return rest ? `~/${rest}` : "~";
    }
  }
  return trimmed;
}

export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "") || "/";
  const i = trimmed.lastIndexOf("/");
  if (i <= 0) return "/";
  return trimmed.slice(0, i);
}

export function rebasePath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
  return path;
}

export function isEqualOrInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function joinPath(parent: string, relative: string): string {
  const base = parent.replace(/\/+$/, "") || "/";
  const parts = relative.split(/[/\\]/).filter((part) => part && part !== ".");
  let out = base;
  for (const part of parts) {
    if (part === "..") {
      out = parentPath(out);
      continue;
    }
    out = out === "/" ? `/${part}` : `${out}/${part}`;
  }
  return out;
}

/** Absolute path for a workspace file href, or `undefined` if it is not a local file. */
export function resolveWorkspacePath(
  href: string,
  cwd?: string,
): string | undefined {
  let value = href.trim();
  if (!value || /^(https?:|mailto:|tel:)/i.test(value)) return undefined;

  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(value.slice("file://".length));
    } catch {
      value = value.slice("file://".length);
    }
  }

  value = value.replace(/\\/g, "/").replace(/(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/, "");
  if (!value || value === "." || value.startsWith("#") || value.startsWith("?") || value.includes("://")) {
    return undefined;
  }
  if (!looksLikeFilePath(value)) return undefined;

  if (/^[A-Za-z]:\//.test(value)) return value;
  if (value.startsWith("/")) {
    return /^\/[A-Za-z]:\//.test(value) ? value.slice(1) : value;
  }
  if (!cwd || cwd === "~") return undefined;
  return joinPath(cwd, value);
}

function looksLikeFilePath(value: string): boolean {
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) return true;
  if (value.includes("/")) return true;
  return /\.[A-Za-z][A-Za-z0-9+]{0,11}$/.test(value);
}

export function prettyParent(path: string): string {
  return prettyCwd(parentPath(path));
}

/** Path relative to cwd when it lives under the project, otherwise unchanged. */
export function displayPath(path: string, cwd?: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = cwd?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (base && base !== "~") {
    if (normalized.toLowerCase() === base.toLowerCase()) {
      return normalized.split("/").filter(Boolean).pop() || normalized;
    }
    const prefix = `${base}/`;
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      return normalized.slice(prefix.length);
    }
  }
  return normalized;
}

/** Folder name for tab labels — `~` when the cwd is home. */
export function projectName(cwd: string): string {
  if (!cwd || prettyCwd(cwd) === "~") return "~";
  const trimmed = cwd.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}
