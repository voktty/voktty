import { fuzzyScore } from "@/modules/command-palette/lib/fuzzy";

export type QuickOpenMatch = {
  rel: string;
  name: string;
  directory: string;
  recent: boolean;
};

const DEFAULT_RESULT_LIMIT = 100;

function canonical(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function canonicalRoot(path: string): string {
  const normalized = canonical(path);
  return normalized === "/" ? normalized : normalized.replace(/\/$/, "");
}

function isCaseInsensitiveRoot(path: string): boolean {
  return /^[a-z]:(?:\/|$)/i.test(path) || path.startsWith("//");
}

export function quickOpenScope(root: string, workspaceKey: string): string {
  return `${workspaceKey}:${canonicalRoot(root)}`;
}

export function workspaceRelativePath(
  root: string,
  path: string,
): string | null {
  const normalizedRoot = canonicalRoot(root);
  const normalizedPath = canonical(path);
  const comparableRoot = isCaseInsensitiveRoot(normalizedRoot)
    ? normalizedRoot.toLocaleLowerCase("en-US")
    : normalizedRoot;
  const comparablePath = isCaseInsensitiveRoot(normalizedRoot)
    ? normalizedPath.toLocaleLowerCase("en-US")
    : normalizedPath;
  if (comparablePath === comparableRoot) return "";
  const prefix = normalizedRoot === "/" ? "/" : `${comparableRoot}/`;
  return comparablePath.startsWith(prefix)
    ? normalizedPath.slice(prefix.length)
    : null;
}

export function resolveQuickOpenPath(root: string, relative: string): string {
  const normalizedRoot = canonicalRoot(root);
  const normalizedRelative = canonical(relative).replace(/^\/+/, "");
  if (!normalizedRelative) return normalizedRoot;
  return normalizedRoot === "/"
    ? `/${normalizedRelative}`
    : `${normalizedRoot}/${normalizedRelative}`;
}

export function rankQuickOpenFiles(
  files: string[],
  query: string,
  recentFiles: string[],
  limit = DEFAULT_RESULT_LIMIT,
): QuickOpenMatch[] {
  const normalizedQuery = query.trim();
  const recentRank = new Map(
    recentFiles.map((path, index) => [
      canonical(path),
      recentFiles.length - index,
    ]),
  );
  const unique = [...new Set(files.map(canonical).filter(Boolean))];

  const ranked = unique.flatMap((rel) => {
    const slash = rel.lastIndexOf("/");
    const name = slash >= 0 ? rel.slice(slash + 1) : rel;
    const directory = slash >= 0 ? rel.slice(0, slash) : "";
    const recent = recentRank.has(rel);

    if (!normalizedQuery) {
      return [
        { rel, name, directory, recent, score: recentRank.get(rel) ?? 0 },
      ];
    }

    const pathScore = fuzzyScore(normalizedQuery, rel);
    const nameScore = fuzzyScore(normalizedQuery, name);
    if (pathScore === null && nameScore === null) return [];
    const score = Math.max(pathScore ?? 0, (nameScore ?? 0) + 24);
    return [{ rel, name, directory, recent, score }];
  });

  ranked.sort((left, right) => {
    if (!normalizedQuery) {
      return (
        Number(right.recent) - Number(left.recent) ||
        right.score - left.score ||
        left.rel.localeCompare(right.rel)
      );
    }
    return (
      right.score - left.score ||
      Number(right.recent) - Number(left.recent) ||
      left.rel.length - right.rel.length ||
      left.rel.localeCompare(right.rel)
    );
  });

  return ranked
    .slice(0, Math.max(1, limit))
    .map(({ score: _score, ...match }) => match);
}
