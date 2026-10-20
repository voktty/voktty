export type RemoteDirectoryEntry = {
  name: string;
  kind: "directory" | "file" | "symlink";
};

export type RemoteDirectoryListing = {
  path: string;
  relativePath: string;
  parentRelativePath: string | null;
  entries: Array<{ name: string; path: string; relativePath: string }>;
};

export type RemoteProjectPathIssue = "required" | "absolute" | "control";

export function remoteProjectPathIssue(
  path: string,
): RemoteProjectPathIssue | undefined {
  const value = path.trim();
  if (!value) return "required";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "control";
  if (!value.startsWith("/")) return "absolute";
  return undefined;
}

export function normalizeRemoteProjectPath(path: string): string {
  const value = path.trim();
  if (remoteProjectPathIssue(value)) {
    throw new Error("Enter an absolute remote project path.");
  }
  return value.replace(/\/+$/, "") || "/";
}

export function normalizeRemoteDirectoryRelative(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    throw new Error("Remote browser paths must stay inside the opened folder.");
  }
  const parts = normalized.split("/").filter(Boolean);
  if (
    parts.some((part) => part === "." || part === ".." || part.includes("\0"))
  ) {
    throw new Error("Remote browser paths must stay inside the opened folder.");
  }
  return parts.join("/");
}

export function remoteDirectoryPath(root: string, relativePath = ""): string {
  if (!root.startsWith("/")) {
    throw new Error("The remote helper returned an invalid workspace root.");
  }
  const relative = normalizeRemoteDirectoryRelative(relativePath);
  const normalizedRoot = root.replace(/\/+$/, "") || "/";
  if (!relative) return normalizedRoot;
  return normalizedRoot === "/"
    ? `/${relative}`
    : `${normalizedRoot}/${relative}`;
}

export function remoteDirectoryListing(
  root: string,
  relativePath: string,
  entries: RemoteDirectoryEntry[],
): RemoteDirectoryListing {
  const relative = normalizeRemoteDirectoryRelative(relativePath);
  const parentParts = relative.split("/").filter(Boolean);
  parentParts.pop();
  // The root has no parent; a first-level folder returns to the root ("").
  const parentRelativePath = relative ? parentParts.join("/") : null;
  return {
    path: remoteDirectoryPath(root, relative),
    relativePath: relative,
    parentRelativePath,
    entries: entries
      .filter(
        (entry) =>
          entry.kind === "directory" &&
          entry.name !== "." &&
          entry.name !== ".." &&
          !entry.name.includes("/") &&
          !entry.name.includes("\\") &&
          !entry.name.includes("\0"),
      )
      .map((entry) => {
        const child = [relative, entry.name].filter(Boolean).join("/");
        return {
          name: entry.name,
          path: remoteDirectoryPath(root, child),
          relativePath: child,
        };
      }),
  };
}

/** Collapses `.`, `..` and repeated slashes without ever leaving the root. */
export function lexicalAbsolutePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.trim().split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** The path below the `/` browse root, as the helper expects it. */
export function absoluteToBrowseRelative(path: string): string {
  return lexicalAbsolutePath(path).slice(1);
}

const SAFE_USER = /^[A-Za-z0-9._-]+$/;

/**
 * Folders to try, in order, when opening the browser: the typed path and its
 * existing ancestors, the profile's initial folder, a guess at the user's
 * home, and finally the root, so it always shows something.
 */
export function browseStartCandidates(input: {
  typed?: string;
  initialDirectory?: string;
  user?: string;
}): string[] {
  const candidates: string[] = [];
  const add = (path: string) => {
    if (!candidates.includes(path)) candidates.push(path);
  };
  const chain = (value: string | undefined) => {
    if (!value || remoteProjectPathIssue(value)) return;
    let current = lexicalAbsolutePath(value);
    while (current !== "/") {
      add(current);
      current = lexicalAbsolutePath(`${current}/..`);
    }
  };
  chain(input.typed);
  chain(input.initialDirectory);
  const user = input.user?.trim();
  if (user && SAFE_USER.test(user)) add(user === "root" ? "/root" : `/home/${user}`);
  add("/");
  return candidates;
}