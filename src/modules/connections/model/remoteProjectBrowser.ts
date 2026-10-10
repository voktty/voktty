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
  const parentRelativePath = parentParts.length ? parentParts.join("/") : null;
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
