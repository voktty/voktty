import type { GitBranches, GitDiffIndex } from "@/modules/harness/lib/fs";
import { invokeWorkspace } from "@/modules/harness/lib/fs";
import { t } from "@/modules/i18n";
import type {
  GitBranchEntry,
  GitBranchListResult,
  GitCommitFileChange,
  GitDiffContentResult,
  GitHistoryMetadata,
  GitLogEntry,
  GitPushResult,
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

function remoteGitCommand<T>(
  command: string,
  cwd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return invokeWorkspace<T>(command, { cwd, ...args });
}

function mapRemoteBranchEntries(branches: GitBranches): GitBranchEntry[] {
  if (
    !branches ||
    !Array.isArray(branches.branches) ||
    typeof branches.detached !== "boolean" ||
    !(branches.current === null || typeof branches.current === "string")
  ) {
    throw new Error("The remote helper returned invalid Git branches.");
  }
  return branches.branches.flatMap((branch) => {
    if (
      !branch ||
      typeof branch.name !== "string" ||
      !branch.name ||
      typeof branch.current !== "boolean" ||
      !(branch.remote === null || typeof branch.remote === "string")
    ) {
      throw new Error("The remote helper returned invalid Git branches.");
    }
    if (branch.remote !== null) return [];
    return [
      {
        name: branch.name,
        kind: "local",
        worktreePath: null,
        isHead: branch.current,
        isDetached: branch.current && branches.detached,
      },
    ];
  });
}

export function mapRemoteGitHistoryMetadata(
  repoRoot: string,
  index: GitDiffIndex,
  branches: GitBranches,
): GitHistoryMetadata {
  if (
    !index ||
    !Array.isArray(index.files) ||
    !(index.branch === null || typeof index.branch === "string") ||
    !(index.upstream === null || typeof index.upstream === "string") ||
    !Number.isSafeInteger(index.ahead) ||
    index.ahead < 0 ||
    !Number.isSafeInteger(index.behind) ||
    index.behind < 0
  ) {
    throw new Error("The remote helper returned invalid Git status metadata.");
  }
  if (
    !branches ||
    !Array.isArray(branches.branches) ||
    typeof branches.detached !== "boolean" ||
    !(branches.current === null || typeof branches.current === "string")
  ) {
    throw new Error("The remote helper returned invalid Git branches.");
  }
  const branch = branches.detached
    ? "HEAD"
    : (index.branch ?? branches.current ?? "");
  const changedFiles = index.files.map((file) => {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.relative !== "string" ||
      typeof file.status !== "string" ||
      typeof file.staged !== "boolean" ||
      typeof file.unstaged !== "boolean"
    ) {
      throw new Error("The remote helper returned invalid Git status files.");
    }
    const relative = relativeCommitPath(repoRoot, file.path);
    if (relative !== file.relative) {
      throw new Error("The remote helper returned a path outside the project.");
    }
    const code =
      file.status === "added"
        ? "A"
        : file.status === "deleted"
          ? "D"
          : file.status === "untracked"
            ? "?"
            : file.status === "modified"
              ? "M"
              : null;
    if (!code) {
      throw new Error("The remote helper returned an invalid Git status.");
    }
    return {
      path: file.path,
      originalPath: null,
      indexStatus:
        file.unstaged && file.status === "untracked"
          ? "?"
          : file.staged
            ? code
            : ".",
      worktreeStatus: file.unstaged ? code : ".",
      staged: file.staged,
      unstaged: file.unstaged,
      untracked: file.status === "untracked",
      conflicted: false,
      statusLabel:
        file.status === "untracked"
          ? "Untracked"
          : file.status.charAt(0).toUpperCase() + file.status.slice(1),
    };
  });
  const repo: GitRepoInfo = {
    repoRoot,
    branch,
    upstream: index.upstream,
    isDetached: branches.detached,
  };
  return {
    branches: mapRemoteBranchEntries(branches),
    repo,
    status: {
      repoRoot,
      branch,
      upstream: index.upstream,
      ahead: index.ahead,
      behind: index.behind,
      isDetached: branches.detached,
      truncated: false,
      changedFiles,
    },
  };
}

export async function loadRemoteGitHistoryMetadata(
  repoRoot: string,
): Promise<GitHistoryMetadata> {
  const [index, branches] = await Promise.all([
    remoteGitCommand<GitDiffIndex>("git_diff_index", repoRoot),
    remoteGitCommand<GitBranches>("git_branches", repoRoot),
  ]);
  return mapRemoteGitHistoryMetadata(repoRoot, index, branches);
}

export async function loadRemoteGitBranches(
  repoRoot: string,
): Promise<GitBranchListResult> {
  const branches = await remoteGitCommand<GitBranches>(
    "git_branches",
    repoRoot,
  );
  return { branches: mapRemoteBranchEntries(branches) };
}

export async function loadRemoteGitRemoteUrl(
  repoRoot: string,
  name?: string,
): Promise<string | null> {
  const url = await remoteGitCommand<unknown>("git_remote_url", repoRoot, {
    name: name ?? null,
  });
  if (url !== null && typeof url !== "string") {
    throw new Error("The remote helper returned an invalid Git remote URL.");
  }
  return url;
}

export function loadRemoteGitFetch(repoRoot: string): Promise<void> {
  return remoteGitCommand<void>("git_fetch", repoRoot);
}

export function loadRemoteGitPull(repoRoot: string): Promise<void> {
  return remoteGitCommand<void>("git_pull", repoRoot);
}

export async function loadRemoteGitPush(
  repoRoot: string,
): Promise<GitPushResult> {
  const result = await remoteGitCommand<unknown>("git_push", repoRoot);
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    !(
      (typeof (result as GitPushResult).remote === "string" ||
        (result as GitPushResult).remote === null) &&
      (typeof (result as GitPushResult).branch === "string" ||
        (result as GitPushResult).branch === null) &&
      typeof (result as GitPushResult).pushed === "boolean"
    )
  ) {
    throw new Error("The remote helper returned an invalid Git push result.");
  }
  return result as GitPushResult;
}

export async function loadRemoteGitCheckout(
  repoRoot: string,
  branch: string,
): Promise<void> {
  await remoteGitCommand<string>("git_checkout", repoRoot, { name: branch });
}

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
