import type { GitChangedFile, GitDiffIndex } from "@/modules/harness/lib/fs";

const MAX_GIT_STATUS_FILES = 20_000;

type GitStatus = Pick<
  GitDiffIndex,
  "branch" | "upstream" | "ahead" | "behind" | "files"
>;

function relativeGitPath(path: string): string {
  const normalized = path;
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.includes("\\") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Git returned a path outside the saved project.");
  }
  return parts.join("/");
}

function pathAfterFields(record: string, fieldCount: number): string {
  let offset = 0;
  for (let field = 0; field < fieldCount; field += 1) {
    while (record[offset] === " ") offset += 1;
    const separator = record.indexOf(" ", offset);
    if (separator < 0)
      throw new Error("Git returned an invalid status record.");
    offset = separator + 1;
  }
  const path = record.slice(offset);
  if (!path) throw new Error("Git returned an empty status path.");
  return relativeGitPath(path);
}

function gitStatusName(code: string): string {
  if (code === "??") return "untracked";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  return "modified";
}

export function parseGitPorcelainV2(output: string): GitStatus {
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: GitChangedFile[] = [];
  const records = output.split("\0");

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("# branch.head ")) {
      const value = record.slice("# branch.head ".length);
      branch = value && value !== "(detached)" ? value : null;
      continue;
    }
    if (record.startsWith("# branch.upstream ")) {
      upstream = record.slice("# branch.upstream ".length) || null;
      continue;
    }
    if (record.startsWith("# branch.ab ")) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }
    if (record.startsWith("# ")) continue;

    const kind = record[0];
    if (kind !== "?" && kind !== "1" && kind !== "2" && kind !== "u") {
      throw new Error("Git returned an invalid status record.");
    }
    const code = kind === "?" ? "??" : record.slice(2, 4);
    if (code.length !== 2)
      throw new Error("Git returned an invalid status code.");
    const relative =
      kind === "?"
        ? relativeGitPath(record.slice(2))
        : pathAfterFields(record, kind === "1" ? 8 : kind === "2" ? 9 : 10);
    if (kind === "2") index += 1;

    files.push({
      path: relative,
      relative,
      status: gitStatusName(code),
      additions: 0,
      deletions: 0,
      staged: code[0] !== "." && code !== "??",
      unstaged: code[1] !== "." || code === "??",
    });
    if (files.length > MAX_GIT_STATUS_FILES) {
      throw new Error(
        "The remote project has too many changed files to display.",
      );
    }
  }

  files.sort((left, right) => left.relative.localeCompare(right.relative));
  return { branch, upstream, ahead, behind, files };
}

export function parseGitNumstat(
  output: string,
): Map<string, { additions: number; deletions: number }> {
  const counts = new Map<string, { additions: number; deletions: number }>();
  const records = output.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      throw new Error("Git returned invalid change statistics.");
    }
    let path = record.slice(secondTab + 1);
    if (!path) {
      const previousPath = records[index + 1];
      const currentPath = records[index + 2];
      if (!previousPath || !currentPath) {
        throw new Error("Git returned an incomplete rename statistic.");
      }
      path = currentPath;
      index += 2;
    }
    const relative = relativeGitPath(path);
    const parseCount = (value: string) => (value === "-" ? 0 : Number(value));
    const additions = parseCount(record.slice(0, firstTab));
    const deletions = parseCount(record.slice(firstTab + 1, secondTab));
    if (
      !Number.isSafeInteger(additions) ||
      additions < 0 ||
      !Number.isSafeInteger(deletions) ||
      deletions < 0
    ) {
      throw new Error("Git returned invalid change counts.");
    }
    counts.set(relative, { additions, deletions });
  }
  return counts;
}
