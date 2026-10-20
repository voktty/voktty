import type {
  GitChangedFile,
  GitDiffContentResult,
  GitDiffResult,
  GitDiscardEntry,
  GitStatusSnapshot,
} from "./native";
import type {
  GitChangedFile as IndexFile,
  GitDiffIndex,
  GitFileDiff,
} from "@/modules/harness/lib/fs";

const STATUS_LETTER: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "?",
};

const STATUS_LABEL: Record<string, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
  untracked: "Untracked",
};

function letter(status: string): string {
  return STATUS_LETTER[status] ?? "M";
}

function changedFile(file: IndexFile): GitChangedFile {
  const untracked = file.status === "untracked";
  const code = letter(file.status);
  return {
    path: file.relative,
    originalPath: null,
    indexStatus: untracked ? "?" : file.staged ? code : " ",
    worktreeStatus: untracked ? "?" : file.unstaged ? code : " ",
    staged: file.staged,
    unstaged: file.unstaged,
    untracked,
    conflicted: false,
    statusLabel: STATUS_LABEL[file.status] ?? "Modified",
  };
}

/** The Source Control panel model, built from the project helper's change index. */
export function statusSnapshotFromIndex(
  repoRoot: string,
  index: GitDiffIndex,
): GitStatusSnapshot {
  return {
    repoRoot,
    branch: index.branch ?? "",
    upstream: index.upstream,
    ahead: index.ahead,
    behind: index.behind,
    isDetached: index.branch === null,
    truncated: false,
    changedFiles: index.files.map(changedFile),
  };
}

export function diffContentFromFileDiff(diff: GitFileDiff): GitDiffContentResult {
  return {
    originalContent: diff.original,
    modifiedContent: diff.current,
    isBinary: diff.binary,
    fallbackPatch: "",
    truncated: diff.tooLarge,
  };
}

export type RemoteGitPanelOps = {
  index: (cwd: string) => Promise<GitDiffIndex>;
  fileDiff: (cwd: string, relative: string, staged: boolean) => Promise<GitFileDiff>;
  patch: (cwd: string, relative: string | null, staged: boolean) => Promise<GitDiffResult>;
  stage: (cwd: string, relative: string) => Promise<void>;
  unstage: (cwd: string, relative: string) => Promise<void>;
  discard: (cwd: string, relative: string) => Promise<void>;
  stageContents: (cwd: string, relative: string, contents: string) => Promise<void>;
  init: (cwd: string) => Promise<void>;
};

const MAX_PATHS = 512;

function checkedPaths(paths: readonly string[]): readonly string[] {
  if (paths.length > MAX_PATHS) {
    throw new Error(`At most ${MAX_PATHS} files can be changed at once.`);
  }
  return paths;
}

/** Runs one change per file in order and stops at the first failure, so a
 * partial result is never reported as success. */
async function eachPath(
  paths: readonly string[],
  run: (path: string) => Promise<void>,
): Promise<void> {
  for (const path of checkedPaths(paths)) await run(path);
}

export function createRemoteGitPanel(ops: RemoteGitPanelOps) {
  return {
    status: async (repoRoot: string) =>
      statusSnapshotFromIndex(repoRoot, await ops.index(repoRoot)),
    diff: (repoRoot: string, path: string | null, staged: boolean) =>
      ops.patch(repoRoot, path, staged),
    diffContent: async (repoRoot: string, path: string, staged: boolean) =>
      diffContentFromFileDiff(await ops.fileDiff(repoRoot, path, staged)),
    stage: (repoRoot: string, paths: readonly string[]) =>
      eachPath(paths, (path) => ops.stage(repoRoot, path)),
    unstage: (repoRoot: string, paths: readonly string[]) =>
      eachPath(paths, (path) => ops.unstage(repoRoot, path)),
    discard: (repoRoot: string, entries: readonly GitDiscardEntry[]) =>
      eachPath(
        checkedPaths(entries.map((entry) => entry.path)),
        (path) => ops.discard(repoRoot, path),
      ),
    stageHunk: (repoRoot: string, path: string, contents: string) =>
      ops.stageContents(repoRoot, path, contents),
    init: (cwd: string) => ops.init(cwd),
  };
}