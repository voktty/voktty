import type { GitChangedFile } from "@/modules/ai/lib/native";

export type GitReviewCheckState = "checked" | "indeterminate" | "unchecked";

export type GitReviewEntry = {
  key: string;
  path: string;
  originalPath: string | null;
  statusCode: string;
  statusLabel: string;
  checkState: GitReviewCheckState;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

function normalizeStatusCode(status: string): string {
  const code = status.trim().toUpperCase();
  switch (code) {
    case "?":
      return "U";
    case "A":
      return "A";
    case "M":
      return "M";
    case "D":
      return "D";
    case "R":
    case "C":
      return "R";
    case "U":
      return "U";
    default:
      return code || "M";
  }
}

export function gitStatusCodeForMode(
  mode: "+" | "-",
  file: GitChangedFile,
): string {
  if (mode === "-" && file.untracked) return "U";
  const primary = mode === "+" ? file.indexStatus : file.worktreeStatus;
  const fallback = mode === "+" ? file.worktreeStatus : file.indexStatus;
  return normalizeStatusCode(primary !== " " ? primary : fallback);
}

export function buildGitReviewEntries(
  changedFiles: readonly GitChangedFile[],
): GitReviewEntry[] {
  const seen = new Set<string>();
  const entries: GitReviewEntry[] = [];

  for (const file of changedFiles) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    const checkState: GitReviewCheckState =
      file.staged && file.unstaged
        ? "indeterminate"
        : file.staged
          ? "checked"
          : "unchecked";
    entries.push({
      key: file.path,
      path: file.path,
      originalPath: file.originalPath,
      statusCode: file.unstaged
        ? gitStatusCodeForMode("-", file)
        : gitStatusCodeForMode("+", file),
      statusLabel: file.statusLabel,
      checkState,
      staged: file.staged,
      unstaged: file.unstaged,
      untracked: file.untracked,
    });
  }

  return entries;
}

function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("\\\\") ||
    path.startsWith("//") ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

function comparablePath(path: string): string {
  let normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")) {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

export function absoluteGitReviewPath(repoRoot: string, path: string): string {
  if (isAbsolutePath(path)) return comparablePath(path);
  const root = repoRoot.replace(/[\\/]+$/, "");
  const relative = path.replace(/^[\\/]+/, "");
  return comparablePath(`${root}/${relative}`);
}

export function sameGitReviewRepository(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

export function isGitReviewEntryDirty(
  repoRoot: string,
  entry: Pick<GitReviewEntry, "path" | "originalPath">,
  dirtyPaths: readonly string[],
): boolean {
  if (dirtyPaths.length === 0) return false;
  const candidates = new Set([
    absoluteGitReviewPath(repoRoot, entry.path),
    ...(entry.originalPath
      ? [absoluteGitReviewPath(repoRoot, entry.originalPath)]
      : []),
  ]);
  return dirtyPaths.some((path) => candidates.has(comparablePath(path)));
}

export function reconcileGitReviewPath(
  entries: readonly Pick<GitReviewEntry, "path">[],
  currentPath: string | null,
): string | null {
  if (!currentPath) return entries[0]?.path ?? null;
  const match = entries.find(
    (entry) =>
      entry.path === currentPath ||
      comparablePath(entry.path) === comparablePath(currentPath),
  );
  if (match) return match.path;
  return entries[0]?.path ?? null;
}
