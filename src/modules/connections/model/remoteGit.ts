import type {
  GitBranches,
  GitChangedFile,
  GitDiffIndex,
} from "@/modules/harness/lib/fs";

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

function compareGitText(left: string, right: string): number {
  const leftPoints = Array.from(
    left,
    (character) => character.codePointAt(0) ?? 0,
  );
  const rightPoints = Array.from(
    right,
    (character) => character.codePointAt(0) ?? 0,
  );
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function compareGitBranches(
  left: GitBranches["branches"][number],
  right: GitBranches["branches"][number],
): number {
  return (
    Number(right.current) - Number(left.current) ||
    Number(left.remote !== null) - Number(right.remote !== null) ||
    compareGitText(asciiLowercase(left.name), asciiLowercase(right.name)) ||
    compareGitText(left.remote ?? "", right.remote ?? "")
  );
}

export function parseGitBranches(
  currentBranch: string | null,
  headSha: string | null,
  localRefsOutput: string,
  remoteRefsOutput: string,
): GitBranches {
  const current = currentBranch ?? headSha;
  const branches: GitBranches["branches"] = [];
  const localNames = new Set<string>();

  for (const record of localRefsOutput.split(/\r?\n/)) {
    const line = record.trim();
    if (!line) continue;
    const [name, headMarker = ""] = line.split("\t", 2);
    if (!name) continue;
    localNames.add(name);
    branches.push({ name, current: headMarker.trim() === "*", remote: null });
  }

  if (currentBranch && !localNames.has(currentBranch)) {
    localNames.add(currentBranch);
    branches.push({ name: currentBranch, current: true, remote: null });
  }

  for (const record of remoteRefsOutput.split(/\r?\n/)) {
    const full = record.trim();
    if (!full) continue;
    const separator = full.indexOf("/");
    if (separator <= 0 || separator === full.length - 1) continue;
    const remote = full.slice(0, separator);
    const name = full.slice(separator + 1);
    if (
      !name ||
      name === "HEAD" ||
      name.endsWith("/HEAD") ||
      localNames.has(name)
    ) {
      continue;
    }
    branches.push({ name, current: false, remote });
  }

  branches.sort(compareGitBranches);
  return {
    current,
    detached: currentBranch === null && headSha !== null,
    branches,
  };
}

type GitHistoryRef = { name: string; kind: "local" | "remote" | "tag" };

export type RemoteGitHistoryCommit = {
  sha: string;
  shortSha: string;
  parents: string[];
  author: string;
  timestamp: number;
  subject: string;
  refs: GitHistoryRef[];
  head: boolean;
};

const FULL_GIT_SHA = /^[0-9a-f]{40,64}$/i;

export function parseGitHistory(
  output: string,
  head: string,
  remoteNames: readonly string[],
): RemoteGitHistoryCommit[] {
  const remotes = new Set(remoteNames);
  return output.split("\x1e").flatMap((record) => {
    const normalized = record.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    if (!normalized) return [];
    const [sha, shortSha, parents, author, timestamp, decorations, subject] =
      normalized.split("\0");
    const seconds = Number(timestamp);
    if (
      !sha ||
      !FULL_GIT_SHA.test(sha) ||
      !/^\d+$/.test(timestamp ?? "") ||
      !Number.isSafeInteger(seconds) ||
      subject === undefined
    ) {
      return [];
    }
    const refs = (decorations ?? "")
      .split(",")
      .map((raw) => raw.trim())
      .filter(Boolean)
      .flatMap((raw): GitHistoryRef[] => {
        if (raw === "HEAD" || raw.endsWith("/HEAD")) return [];
        if (raw.startsWith("HEAD -> ")) {
          return [{ name: raw.slice("HEAD -> ".length), kind: "local" }];
        }
        if (raw.startsWith("tag: ")) {
          return [{ name: raw.slice("tag: ".length), kind: "tag" }];
        }
        return [
          {
            name: raw,
            kind: Array.from(remotes).some(
              (remote) => raw === remote || raw.startsWith(`${remote}/`),
            )
              ? "remote"
              : "local",
          },
        ];
      });
    return [
      {
        sha,
        shortSha: shortSha || sha.slice(0, 7),
        parents: parents ? parents.split(" ").filter(Boolean) : [],
        author: author ?? "",
        timestamp: seconds,
        subject,
        refs,
        head: sha === head,
      },
    ];
  });
}

export type RemoteGitCommitFile = {
  relative: string;
  status: "added" | "deleted" | "modified";
  additions: number;
  deletions: number;
};

export function parseGitCommitFiles(
  nameStatusOutput: string,
  numstatOutput: string,
): RemoteGitCommitFile[] {
  const counts = parseGitNumstat(numstatOutput);
  const fields = nameStatusOutput.split("\0");
  const files: RemoteGitCommitFile[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const code = fields[index];
    if (!code) continue;
    const path = fields[index + 1];
    if (!path) throw new Error("Git returned an incomplete commit file list.");
    if (!/^[ADMT]$/.test(code)) {
      throw new Error("Git returned an invalid commit file status.");
    }
    const relative = relativeGitPath(path);
    const count = counts.get(relative);
    files.push({
      relative,
      status: code === "A" ? "added" : code === "D" ? "deleted" : "modified",
      additions: count?.additions ?? 0,
      deletions: count?.deletions ?? 0,
    });
    if (files.length > MAX_GIT_STATUS_FILES) {
      throw new Error("The remote commit has too many files to display.");
    }
  }
  return files;
}
