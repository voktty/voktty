import {
  parseRemotePath,
  remotePath,
} from "@/modules/connections/model/remoteProjects";

/**
 * Resolves a relative path against a base markdown document file path.
 */
export function resolveRelativeDocPath(
  baseDocPath: string,
  relativePath: string,
): string {
  if (!relativePath || !baseDocPath) return relativePath || "";

  if (/^(?:\\\\|\/\/)/.test(relativePath)) return relativePath;

  const remote = parseRemotePath(baseDocPath);
  if (remote && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(relativePath)) {
    return remotePath(
      remote.environmentId,
      resolveRelativeDocPath(remote.hostPath, relativePath),
    );
  }

  // If already absolute or URL with protocol (http, https, data, asset, mailto, etc.)
  if (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(relativePath) ||
    relativePath.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(relativePath)
  ) {
    return relativePath;
  }

  // Normalize baseDocPath slashes
  const normalizedBase = baseDocPath.replace(/\\/g, "/");
  const lastSlash = normalizedBase.lastIndexOf("/");
  const baseDir = lastSlash >= 0 ? normalizedBase.substring(0, lastSlash) : "";

  if (!baseDir) return relativePath;

  const parts = baseDir.split("/").filter(Boolean);
  const isWindowsDrive = /^[a-zA-Z]:/.test(normalizedBase);
  const isUnc = normalizedBase.startsWith("//");
  const rootDepth = isUnc ? 2 : isWindowsDrive ? 1 : 0;
  const prefix = isUnc
    ? "//"
    : isWindowsDrive
      ? ""
      : normalizedBase.startsWith("/")
        ? "/"
        : "";

  const relSegments = relativePath.replace(/\\/g, "/").split("/");

  for (const seg of relSegments) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      if (parts.length > rootDepth) {
        parts.pop();
      }
    } else {
      parts.push(seg);
    }
  }

  return prefix + parts.join("/");
}
