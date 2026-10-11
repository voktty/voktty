import { invokeWorkspace } from "@/modules/harness/lib/fs";
import { t } from "@/modules/i18n";
import type {
  GitCommitFileChange,
  GitDiffContentResult,
  GitLogEntry,
  GitRepoInfo,
} from "./native";

type RemoteHistoryRef = { name: string; kind: "local" | "remote" | "tag" };

type RemoteHistoryCommit = {
  sha: string;
  shortSha: string;
  parents: string[];
  author: string;
  timestamp: number;
  subject: string;
  refs?: RemoteHistoryRef[];
  head: boolean;
};

type RemoteGitHistory = {
  repoRoot?: string;
  head: string | null;
  commits: RemoteHistoryCommit[];
};

type RemoteCommitFile = {
  path: string;
  relative: string;
  status: "added" | "deleted" | "modified";
  additions: number;
  deletions: number;
  binary?: boolean;
};

type RemoteCommitFileDiff = {
  original: string;
  current: string;
  binary: boolean;
  tooLarge: boolean;
};

export type RemoteGitLogOptions = {
  limit?: number;
  beforeSha?: string;
  allRefs?: boolean;
  skip?: number;
};

const REMOTE_PROFILE_PREFIX = "remote://voktty-ssh-";
const REMOTE_HISTORY_LIMIT = 500;

async function fetchRemoteGitHistory(
  cwd: string,
  limit: number,
  allRefs = false,
): Promise<RemoteGitHistory> {
  return invokeWorkspace<RemoteGitHistory>("git_history", {
    cwd,
    limit,
    ...(allRefs ? { allRefs: true } : {}),
  });
}

export function isDirectSshProfilePath(path: string): boolean {
  return path.replace(/\\/g, "/").startsWith(REMOTE_PROFILE_PREFIX);
}

function currentBranchHistory(
  history: RemoteGitHistory,
): RemoteHistoryCommit[] {
  if (!history.head) return [];
  const bySha = new Map(history.commits.map((commit) => [commit.sha, commit]));
  const reachable = new Set<string>();
  const pending = [history.head];
  while (pending.length > 0) {
    const sha = pending.pop();
    if (!sha || reachable.has(sha)) continue;
    reachable.add(sha);
    const commit = bySha.get(sha);
    if (commit) pending.push(...commit.parents);
  }
  return history.commits.filter((commit) => reachable.has(commit.sha));
}

export function mapRemoteGitLogPage(
  history: RemoteGitHistory,
  options: RemoteGitLogOptions = {},
): GitLogEntry[] {
  const commits = options.allRefs
    ? history.commits
    : currentBranchHistory(history);
  let offset = Math.max(0, options.skip ?? 0);
  if (options.beforeSha) {
    const cursor = commits.findIndex(
      (commit) => commit.sha === options.beforeSha,
    );
    if (cursor < 0) return [];
    offset = cursor + 1;
  }
  const limit = Math.min(200, Math.max(1, options.limit ?? 30));
  return commits.slice(offset, offset + limit).map((commit) => ({
    sha: commit.sha,
    shortSha: commit.shortSha,
    author: commit.author,
    authorEmail: "",
    timestampSecs: commit.timestamp,
    parents: commit.parents,
    subject: commit.subject,
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
  }));
}

export async function loadRemoteGitLog(
  repoRoot: string,
  options: RemoteGitLogOptions = {},
): Promise<GitLogEntry[]> {
  const history = await fetchRemoteGitHistory(
    repoRoot,
    REMOTE_HISTORY_LIMIT,
    options.allRefs,
  );
  return mapRemoteGitLogPage(history, options);
}

function parentRemotePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  return separator > REMOTE_PROFILE_PREFIX.length
    ? normalized.slice(0, separator)
    : path;
}

export async function resolveRemoteGitRepo(
  path: string,
): Promise<GitRepoInfo | null> {
  const parent = parentRemotePath(path);
  const candidates = parent === path ? [path] : [parent, path];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const history = await fetchRemoteGitHistory(candidate, 1);
      if (!history.repoRoot) continue;
      const head = history.commits.find((commit) => commit.head);
      const branch =
        head?.refs?.find((ref) => ref.kind === "local")?.name ?? "";
      return {
        repoRoot: history.repoRoot,
        branch,
        upstream: null,
        isDetached: history.head !== null && !branch,
      };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

function statusDetails(status: RemoteCommitFile["status"]): {
  code: string;
  label: string;
} {
  switch (status) {
    case "added":
      return { code: "A", label: t("gitHistory.status.added") };
    case "deleted":
      return { code: "D", label: t("gitHistory.status.deleted") };
    case "modified":
      return { code: "M", label: t("gitHistory.status.modified") };
    default:
      throw new Error(
        "The remote helper returned an invalid commit file status.",
      );
  }
}

export function mapRemoteCommitFiles(
  repoRoot: string,
  files: RemoteCommitFile[],
): GitCommitFileChange[] {
  return files.map((file) => {
    if (
      !file ||
      typeof file.path !== "string" ||
      !file.path ||
      typeof file.relative !== "string" ||
      !file.relative ||
      !Number.isSafeInteger(file.additions) ||
      file.additions < 0 ||
      !Number.isSafeInteger(file.deletions) ||
      file.deletions < 0
    ) {
      throw new Error(
        "The remote helper returned invalid commit file metadata.",
      );
    }
    const relative = relativeCommitPath(repoRoot, file.path);
    if (relative !== file.relative || typeof file.binary !== "boolean") {
      throw new Error(
        "The remote helper returned a commit file outside the saved project.",
      );
    }
    const status = statusDetails(file.status);
    return {
      path: file.path,
      originalPath: null,
      status: status.code,
      statusLabel: status.label,
      added: file.additions,
      removed: file.deletions,
      isBinary: file.binary === true,
    };
  });
}

export function relativeCommitPath(repoRoot: string, path: string): string {
  const root = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = path.replace(/\\/g, "/");
  const relative = normalizedPath.startsWith(`${root}/`)
    ? normalizedPath.slice(root.length + 1)
    : normalizedPath;
  const parts = relative.split("/");
  if (
    !relative ||
    relative.startsWith("/") ||
    /^[A-Za-z]:/.test(relative) ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Commit file path must stay inside the remote project.");
  }
  return relative;
}

export async function loadRemoteGitCommitFiles(
  repoRoot: string,
  sha: string,
): Promise<GitCommitFileChange[]> {
  const files = await invokeWorkspace<RemoteCommitFile[]>("git_commit_files", {
    cwd: repoRoot,
    sha,
  });
  return mapRemoteCommitFiles(repoRoot, files);
}

export async function loadRemoteGitCommitFileDiff(
  repoRoot: string,
  sha: string,
  path: string,
): Promise<GitDiffContentResult> {
  const diff = await invokeWorkspace<RemoteCommitFileDiff>(
    "git_commit_file_diff",
    {
      cwd: repoRoot,
      sha,
      relative: relativeCommitPath(repoRoot, path),
    },
  );
  if (
    !diff ||
    typeof diff.original !== "string" ||
    typeof diff.current !== "string" ||
    typeof diff.binary !== "boolean" ||
    typeof diff.tooLarge !== "boolean"
  ) {
    throw new Error("The remote helper returned an invalid commit diff.");
  }
  return {
    originalContent: diff.original,
    modifiedContent: diff.current,
    isBinary: diff.binary,
    fallbackPatch: "",
    truncated: diff.tooLarge,
  };
}
