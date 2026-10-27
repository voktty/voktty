import {
  type GitBranches,
  type GitChangedFile,
  type GitDiffIndex,
  type GitFileDiff,
  isCheckoutBlockedByChanges,
  setRemoteCommandRunner,
} from "@/modules/harness/lib/fs";
import {
  RemoteRequestError,
  requestRemoteResult,
} from "@/modules/remote/client";
import { remoteSessions } from "@/modules/remote/sessionManager";
import { assertProjectFileSourceCurrent } from "@/modules/remote/projectFileSource";
import type { RemoteProject } from "@/modules/connections/model/remoteProjects";
import type { SshConnection } from "@/modules/ssh/types";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { invoke } from "@tauri-apps/api/core";
import {
  type GithubBranchStatus,
  type ProfileGit,
  type ProfileGithub,
  profileCreatePullRequest,
  profilePullRequestStatus,
  profileRangeContext,
} from "./remoteProfileGitPr";
import { remoteMachineFor, remoteRequest } from "./connections";
import {
  parseGitBranches,
  parseGitCommitFiles,
  parseGitHistory,
  parseGitNumstat,
  parseGitPorcelainV2,
} from "./remoteGit";
import {
  parseRemotePath,
  remotePath,
  remoteProjectForPath,
} from "./remoteProjects";
import {
  findSshProfile,
  remoteSshConnectionForProfile,
} from "./remoteSshProfiles";

/** File commands a connected machine answers exactly as this computer does. */
const HOST_COMMANDS = new Set([
  "list_dir",
  "list_project_files",
  "read_text_file",
  "read_binary_file",
  "read_file_preview",
  "write_text_file",
  "stat_files",
  "create_path",
  "rename_path",
  "delete_path",
  "copy_path",
  "move_path",
  "git_diff_index",
  "git_diff_files",
  "git_diff_stats",
  "git_file_diff",
  "git_stage_contents",
  "git_stage_file",
  "git_unstage_file",
  "git_discard_file",
  "git_discard_all",
  "git_stage_all",
  "git_unstage_all",
  "git_commit",
  "harness_git_commit",
  "harness_git_push",
  "git_head_message",
  "git_push",
  "git_fetch",
  "git_pull",
  "git_sync",
  "git_pr_status",
  "git_pr_create",
  "git_history",
  "git_commit_files",
  "git_commit_file_diff",
  "git_show_commit",
  "git_staged_context",
  "git_range_context",
  "git_branches",
  "git_remote_url",
  "git_tag_list",
  "git_tag_create",
  "git_tag_delete",
  "git_tag_push",
  "git_branch_from_commit",
  "git_cherry_pick_commit",
  "git_revert_commit",
  "git_compare_branches",
  "git_operation_status",
  "git_operation_abort",
  "git_operation_continue",
  "git_checkout",
  "git_create_branch",
  "git_stash",
  "git_worktrees",
  "search_project",
]);
/** Arguments that hold paths; everything else is passed through untouched. */
const PATH_ARGS = ["path", "cwd", "parent", "from", "destParent", "paths"];
/** Commands whose string result is a path. */
const PATH_RESULTS = new Set([
  "create_path",
  "rename_path",
  "copy_path",
  "move_path",
]);
/** Commands whose result entries carry a `path`. */
const ENTRY_RESULTS = new Set(["list_dir", "list_project_files", "stat_files"]);

const PROFILE_HELPER_COMMANDS = new Set([
  "list_dir",
  "list_project_files",
  "read_text_file",
  "read_binary_file",
  "read_file_preview",
  "write_text_file",
  "stat_files",
  "create_path",
  "rename_path",
  "delete_path",
  "copy_path",
  "move_path",
  "search_project",
  "git_diff_index",
  "git_diff_files",
  "git_diff_stats",
  "git_file_diff",
  "git_stage_contents",
  "git_stage_file",
  "git_unstage_file",
  "git_discard_file",
  "git_discard_all",
  "git_stage_all",
  "git_unstage_all",
  "git_commit",
  "harness_git_commit",
  "git_push",
  "git_fetch",
  "harness_git_push",
  "git_pull",
  "git_sync",
  "git_branches",
  "git_remote_url",
  "git_checkout",
  "git_create_branch",
  "git_stash",
  "git_staged_context",
  "git_history",
  "git_commit_files",
  "git_commit_file_diff",
  "git_show_commit",
  "git_tag_list",
  "git_tag_create",
  "git_tag_delete",
  "git_tag_push",
  "git_branch_from_commit",
  "git_cherry_pick_commit",
  "git_revert_commit",
  "git_compare_branches",
  "git_operation_status",
  "git_operation_abort",
  "git_operation_continue",
  "git_stash_list",
  "git_stash_save",
  "git_stash_apply",
  "git_stash_pop",
  "git_stash_drop",
  "git_range_context",
  "git_pr_status",
  "git_pr_create",
  "git_init",
  "git_patch",
]);

/** Commands the legacy Host answers that a saved SSH profile does not. Worktrees
 * go through `harness/lib/worktrees.ts`; `git_head_message` has no caller. */
export function profileUnsupportedHostCommands(): string[] {
  return [...HOST_COMMANDS].filter((c) => !PROFILE_HELPER_COMMANDS.has(c)).sort();
}

const HELPER_FS = {
  listDir: "fs.readDir",
  readFile: "fs.readFile",
  readFilePreview: "fs.readFilePreview",
  countTextLines: "fs.countTextLines",
  readBinaryFile: "fs.readBinaryFile",
  writeFile: "fs.writeFile",
  stat: "fs.stat",
  createFile: "fs.createFile",
  createDir: "fs.createDir",
  rename: "fs.rename",
  copy: "fs.copy",
  delete: "fs.delete",
} as const;

type RemotePathReference = {
  value: string;
  environmentId: string;
  hostPath: string;
};

type HelperDirectoryEntry = {
  name: string;
  kind: "directory" | "file" | "symlink";
  size: number;
  mtime: number;
  isSymlink?: boolean;
};

const PROJECT_WALK_SKIPS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".jj",
  "node_modules",
  "bower_components",
  ".pnpm-store",
  ".yarn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".vite",
  ".turbo",
  ".parcel-cache",
  ".angular",
  ".vercel",
  ".netlify",
  ".output",
  ".cache",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".nox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".ipynb_checkpoints",
  ".eggs",
  ".gradle",
  "obj",
  "vendor",
  "_build",
  "deps",
  ".dart_tool",
  "dist-newstyle",
  ".stack-work",
  ".build",
  "zig-cache",
  "zig-out",
  "cmake-build-debug",
  "cmake-build-release",
  ".idea",
  "coverage",
  ".nyc_output",
  ".terraform",
]);

const UNAVAILABLE = "This isn’t available for projects on another machine yet.";
const OUTDATED =
  "Update Terax Host in Connections settings to use this project’s files.";

const PROFILE_UNAVAILABLE =
  "This operation is not available for native SSH projects yet.";
const HELPER_GIT_EXEC = "git.execWorkspace";
const HELPER_GIT_EXEC_WORKSPACE_INPUT = "git.execWorkspaceInput";
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_REMOTE_LINE_COUNT_FILES = 20_000;
const MAX_REMOTE_LINE_COUNT_PATH_BYTES = 4 * 1024 * 1024;
const MAX_PROJECT_FILES = 20_000;
const MAX_GIT_DIFF_BYTES = 1024 * 1024;
const MAX_GIT_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_GIT_COMMIT_MESSAGE_BYTES = 16 * 1024;
const MAX_GIT_REF_BYTES = 1024;
const MAX_GIT_TAGS = 20_000;
const MAX_GIT_STASHES = 20_000;
const MAX_GIT_COMPARE_COMMITS = 20_000;
const MAX_GIT_COMPARE_FILES = 20_000;
const GIT_MUTATION_TIMEOUT_SECS = 30;
const GIT_NETWORK_TIMEOUT_SECS = 180;
const REMOTE_GIT_COMMIT_SHA = /^[0-9a-f]{4,64}$/i;
const GIT_COMPARE_LOG_FORMAT = "%H%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%s";

type HelperGitOutput = {
  stdout: string;
  stdoutBytes: Uint8Array;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

function pathReferences(args: Record<string, unknown>): RemotePathReference[] {
  const values: string[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (typeof value === "string") {
      values.push(value);
    }
  };
  for (const key of PATH_ARGS) collect(args[key]);
  const options = args.options;
  if (options && typeof options === "object" && !Array.isArray(options)) {
    collect((options as Record<string, unknown>).cwd);
  }
  return values.map((value) => {
    const parsed = parseRemotePath(value);
    if (!parsed) {
      throw new Error("Files can only be copied or moved within one machine.");
    }
    return { value, ...parsed };
  });
}

function normalizeRemoteAbsolute(path: string): string {
  const value = path.replace(/\\/g, "/");
  if (!value.startsWith("/")) {
    throw new Error("The native SSH helper requires a POSIX project path.");
  }
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      throw new Error("Remote paths cannot leave their saved project root.");
    }
    parts.push(part);
  }
  return parts.length > 0 ? `/${parts.join("/")}` : "/";
}

function relativeToRemoteRoot(root: string, path: string): string {
  const normalizedRoot = normalizeRemoteAbsolute(root);
  const normalizedPath = normalizeRemoteAbsolute(path);
  if (normalizedPath === normalizedRoot) return ".";
  const prefix = normalizedRoot === "/" ? "/" : `${normalizedRoot}/`;
  if (!normalizedPath.startsWith(prefix)) {
    throw new Error("Remote paths cannot leave their saved project root.");
  }
  return normalizedPath.slice(prefix.length);
}

function joinRemotePath(root: string, relative: string): string {
  const normalizedRoot = normalizeRemoteAbsolute(root);
  const normalizedRelative =
    relative === "." ? "" : relative.replace(/^\/+/, "");
  return normalizedRelative
    ? `${normalizedRoot === "/" ? "" : normalizedRoot}/${normalizedRelative}`
    : normalizedRoot;
}

function joinRelativePath(...parts: string[]): string {
  const joined = parts
    .filter((part) => part && part !== ".")
    .join("/")
    .replace(/\/{2,}/g, "/");
  return joined || ".";
}

function relativeNameParts(name: string): string[] {
  const normalized = name.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error("The new name must stay inside the saved project.");
  }
  const parts = normalized.split("/").filter(Boolean);
  if (
    parts.length === 0 ||
    parts.some((part) => part === "." || part === ".." || part.length > 255)
  ) {
    throw new Error("The new name is not valid.");
  }
  return parts;
}

function helperRelativePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("The remote helper returned an invalid search path.");
  }
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    parts.length === 0 ||
    parts.some((part) => part === "." || part === ".." || part.length > 255)
  ) {
    throw new Error(
      "The remote helper returned a search path outside the project.",
    );
  }
  return parts.join("/");
}

function searchPatterns(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== "string") {
    throw new Error("The project search patterns are invalid.");
  }
  return value
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The remote command requires ${key}.`);
  }
  return value;
}

async function helperStat(sessionId: number, path: string) {
  return requestRemoteResult<{
    size: number;
    mtime: number;
    kind: "file" | "dir";
  }>(sessionId, HELPER_FS.stat, { path });
}

function decodeBase64Text(value: string): { text: string; bytes: Uint8Array } {
  let binary: string;
  try {
    binary = globalThis.atob(value);
  } catch {
    throw new Error("The remote helper returned invalid Git output.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { text: new TextDecoder().decode(bytes), bytes };
}

function decodeGitMetadata(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The remote helper returned invalid Git metadata.");
  }
}

async function runHelperGit(
  sessionId: number,
  cwd: string,
  args: string[],
  maxOutputBytes = MAX_GIT_OUTPUT_BYTES,
  allowFailure = false,
  allowTruncated = false,
  stdin?: string,
  timeoutSecs = 10,
): Promise<HelperGitOutput> {
  const raw = await requestRemoteResult<unknown>(
    sessionId,
    stdin === undefined ? HELPER_GIT_EXEC : HELPER_GIT_EXEC_WORKSPACE_INPUT,
    {
      cwd,
      args,
      timeoutSecs,
      maxOutputBytes,
      ...(stdin === undefined ? {} : { stdin }),
    },
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("The remote helper returned an invalid Git result.");
  }
  const result = raw as Record<string, unknown>;
  if (
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string" ||
    !(
      result.exitCode === null ||
      (typeof result.exitCode === "number" &&
        Number.isSafeInteger(result.exitCode))
    ) ||
    typeof result.timedOut !== "boolean" ||
    typeof result.stdoutTruncated !== "boolean" ||
    typeof result.stderrTruncated !== "boolean"
  ) {
    throw new Error("The remote helper returned an invalid Git result.");
  }
  if (result.timedOut) throw new Error("Remote Git operation timed out.");
  if (!allowTruncated && (result.stdoutTruncated || result.stderrTruncated)) {
    throw new Error("Remote Git output exceeded its size limit.");
  }
  const decoded = decodeBase64Text(result.stdout);
  const parsed: HelperGitOutput = {
    stdout: decoded.text,
    stdoutBytes: decoded.bytes,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timedOut: false,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  };
  if (!allowFailure && parsed.exitCode !== 0) {
    throw new Error("Remote Git operation failed.");
  }
  return parsed;
}

function emptyGitIndex(): GitDiffIndex {
  return {
    branch: null,
    files: [],
    additions: 0,
    deletions: 0,
    remote: null,
    upstream: null,
    defaultBranch: null,
    ahead: 0,
    behind: 0,
    aheadOfDefault: 0,
  };
}

async function nativeProfileGitIndex(
  sessionId: number,
  environmentId: string,
  root: string,
  cwd: string,
  supportsUntrackedLineCounts: boolean,
): Promise<GitDiffIndex> {
  const status = await nativeProfileGitStatus(sessionId, cwd);
  if (!status) return emptyGitIndex();
  const numstatOutput = await runHelperGit(
    sessionId,
    cwd,
    ["diff", "--no-ext-diff", "--no-textconv", "--numstat", "-z", "HEAD", "--"],
    MAX_GIT_OUTPUT_BYTES,
    true,
  );
  const counts =
    numstatOutput.exitCode === 0
      ? parseGitNumstat(decodeGitMetadata(numstatOutput.stdoutBytes))
      : new Map();
  const filesNeedingLineCounts = status.files.filter(
    (file) =>
      file.status === "untracked" ||
      (file.status === "added" &&
        counts.get(file.relative)?.additions === undefined),
  );
  const lineCounts = new Map<string, number>();
  const lineCountRequests: {
    file: (typeof filesNeedingLineCounts)[number];
    path: string;
  }[] = [];
  if (supportsUntrackedLineCounts) {
    const encoder = new TextEncoder();
    let pathBytes = 0;
    for (const file of filesNeedingLineCounts) {
      if (lineCountRequests.length >= MAX_REMOTE_LINE_COUNT_FILES) break;
      const path = joinRelativePath(cwd, file.relative);
      const nextPathBytes = encoder.encode(path).byteLength;
      if (nextPathBytes > MAX_REMOTE_LINE_COUNT_PATH_BYTES - pathBytes) break;
      pathBytes += nextPathBytes;
      lineCountRequests.push({ file, path });
    }
  }
  if (lineCountRequests.length > 0) {
    const result = await requestRemoteResult<unknown>(
      sessionId,
      HELPER_FS.countTextLines,
      {
        paths: lineCountRequests.map(({ path }) => path),
      },
    );
    const values =
      result && typeof result === "object" && !Array.isArray(result)
        ? (result as { lineCounts?: unknown }).lineCounts
        : undefined;
    if (
      !Array.isArray(values) ||
      values.length !== lineCountRequests.length ||
      values.some(
        (value) =>
          typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > 1024 * 1024,
      )
    ) {
      throw new Error("The remote helper returned invalid line counts.");
    }
    lineCountRequests.forEach(({ file }, index) => {
      lineCounts.set(file.relative, values[index] as number);
    });
  }
  const files: GitChangedFile[] = status.files.map((file) => {
    const count = counts.get(file.relative);
    return {
      ...file,
      path: remotePath(
        environmentId,
        joinRemotePath(root, joinRelativePath(cwd, file.relative)),
      ),
      additions: count?.additions ?? lineCounts.get(file.relative) ?? 0,
      deletions: count?.deletions ?? 0,
    };
  });
  const [remoteOutput, defaultOutput] = await Promise.all([
    runHelperGit(sessionId, cwd, ["remote"], 64 * 1024, true),
    runHelperGit(
      sessionId,
      cwd,
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      64 * 1024,
      true,
    ),
  ]);
  const remote = remoteOutput.stdout.split(/\r?\n/).includes("origin")
    ? "origin"
    : null;
  let defaultRef =
    defaultOutput.exitCode === 0 ? defaultOutput.stdout.trim() : "";
  if (!defaultRef.startsWith("origin/") && remote) {
    for (const branch of ["main", "master"]) {
      const candidate = `origin/${branch}`;
      const result = await runHelperGit(
        sessionId,
        cwd,
        ["rev-parse", "--verify", `refs/remotes/${candidate}`],
        64 * 1024,
        true,
      );
      if (result.exitCode === 0) {
        defaultRef = candidate;
        break;
      }
    }
  }
  const defaultBranch = defaultRef.startsWith("origin/")
    ? defaultRef.slice("origin/".length) || null
    : null;
  let aheadOfDefault = 0;
  if (defaultBranch) {
    const aheadOutput = await runHelperGit(
      sessionId,
      cwd,
      ["rev-list", "--count", `${defaultRef}..HEAD`],
      64 * 1024,
      true,
    );
    const count = Number(aheadOutput.stdout.trim());
    if (
      aheadOutput.exitCode === 0 &&
      Number.isSafeInteger(count) &&
      count >= 0
    ) {
      aheadOfDefault = count;
    }
  }
  return {
    branch: status.branch,
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    remote,
    upstream: status.upstream,
    defaultBranch,
    ahead: status.ahead,
    behind: status.behind,
    aheadOfDefault,
  };
}

async function nativeProfileGitStatus(
  sessionId: number,
  cwd: string,
): Promise<ReturnType<typeof parseGitPorcelainV2> | null> {
  const statusOutput = await runHelperGit(
    sessionId,
    cwd,
    [
      "status",
      "--porcelain=v2",
      "--branch",
      "--ahead-behind",
      "--untracked-files=all",
      "-z",
    ],
    MAX_GIT_OUTPUT_BYTES,
    true,
  );
  if (statusOutput.exitCode !== 0) {
    if (/not a git repository/i.test(statusOutput.stderr)) return null;
    throw new Error("Could not read Git changes on the remote project.");
  }
  return parseGitPorcelainV2(decodeGitMetadata(statusOutput.stdoutBytes));
}

async function nativeProfileGitStagedContext(
  sessionId: number,
  root: string,
  cwd: string,
): Promise<{ branch: string | null; summary: string; patch: string }> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const stagedSummary = await runHelperGit(
    sessionId,
    cwd,
    ["diff", "--cached", "--stat", "--", "."],
    MAX_GIT_OUTPUT_BYTES,
    true,
  );
  const stagedPatch = await runHelperGit(
    sessionId,
    cwd,
    ["diff", "--cached", "--no-ext-diff", "--", "."],
    MAX_GIT_OUTPUT_BYTES,
    true,
  );
  let summary = stagedSummary.stdout;
  let patch = stagedPatch.stdout;

  if (!summary.trim() && !patch.trim()) {
    summary = (
      await runHelperGit(
        sessionId,
        cwd,
        ["diff", "HEAD", "--stat", "--", "."],
        MAX_GIT_OUTPUT_BYTES,
        true,
      )
    ).stdout;
    patch = (
      await runHelperGit(
        sessionId,
        cwd,
        ["diff", "HEAD", "--no-ext-diff", "--", "."],
        MAX_GIT_OUTPUT_BYTES,
        true,
      )
    ).stdout;
    const untracked = await runHelperGit(
      sessionId,
      cwd,
      ["ls-files", "--others", "--exclude-standard"],
      MAX_GIT_OUTPUT_BYTES,
      true,
    );
    if (untracked.stdout.trim()) {
      if (summary.trim()) summary += "\n";
      summary += `Untracked files:\n${untracked.stdout.trim()}`;
    }
  }

  if (!summary.trim() && !patch.trim()) {
    throw new Error("No changes to summarize");
  }

  const branch = await runHelperGit(
    sessionId,
    cwd,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    64 * 1024,
    true,
  );
  if (branch.exitCode === 0 && branch.stdout.trim()) {
    return { branch: branch.stdout.trim(), summary, patch };
  }
  const head = await runHelperGit(
    sessionId,
    cwd,
    ["rev-parse", "--short", "HEAD"],
    64 * 1024,
    true,
  );
  return {
    branch: head.exitCode === 0 ? head.stdout.trim() || null : null,
    summary,
    patch,
  };
}

async function assertProfileGitRoot(
  sessionId: number,
  root: string,
  cwd: string,
): Promise<string> {
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["rev-parse", "--show-toplevel"],
    64 * 1024,
    true,
  );
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error("No Git repository is available in the saved project.");
  }
  const repositoryRoot = normalizeRemoteAbsolute(result.stdout.trim());
  const projectRoot = normalizeRemoteAbsolute(root);
  if (
    repositoryRoot !== projectRoot &&
    !repositoryRoot.startsWith(projectRoot === "/" ? "/" : `${projectRoot}/`)
  ) {
    throw new Error("The Git repository root is outside the saved project.");
  }
  return repositoryRoot;
}

async function nativeProfileGitCommitSha(
  sessionId: number,
  cwd: string,
  value: unknown,
): Promise<string> {
  if (typeof value !== "string" || !REMOTE_GIT_COMMIT_SHA.test(value)) {
    throw new Error("Invalid commit");
  }
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["rev-parse", "--verify", `${value}^{commit}`],
    64 * 1024,
    true,
  );
  const sha = result.stdout.trim();
  if (result.exitCode !== 0 || !/^[0-9a-f]{40,64}$/i.test(sha)) {
    throw new Error("Unknown commit");
  }
  return sha;
}

async function nativeProfileGitHistory(
  sessionId: number,
  environmentId: string,
  root: string,
  cwd: string,
  limitValue: unknown,
  allRefsValue: unknown,
): Promise<{
  repoRoot?: string;
  head: string | null;
  commits: ReturnType<typeof parseGitHistory>;
}> {
  if (!(await nativeProfileGitIsWorkTree(sessionId, cwd))) {
    return { head: null, commits: [] };
  }
  const repositoryRoot = await assertProfileGitRoot(sessionId, root, cwd);
  const remoteRepositoryRoot = remotePath(environmentId, repositoryRoot);
  const limit = Number.isSafeInteger(limitValue)
    ? Math.min(500, Math.max(1, Number(limitValue)))
    : 200;
  const [headOutput, remoteNames] = await Promise.all([
    runHelperGit(
      sessionId,
      cwd,
      ["rev-parse", "--verify", "HEAD"],
      64 * 1024,
      true,
    ),
    nativeProfileGitRemoteNames(sessionId, cwd),
  ]);
  const head = headOutput.stdout.trim();
  if (headOutput.exitCode !== 0 || !/^[0-9a-f]{40,64}$/i.test(head)) {
    return { repoRoot: remoteRepositoryRoot, head: null, commits: [] };
  }

  const refs = allRefsValue === true ? ["--all"] : ["HEAD"];

  const output = await runHelperGit(
    sessionId,
    cwd,
    [
      "log",
      "--topo-order",
      "--decorate=short",
      `--max-count=${limit}`,
      "--format=%H%x00%h%x00%P%x00%an%x00%at%x00%D%x00%s%x1e",
      ...refs,
    ],
    MAX_GIT_OUTPUT_BYTES,
    false,
    false,
    undefined,
    30,
  );
  return {
    repoRoot: remoteRepositoryRoot,
    head,
    commits: parseGitHistory(
      decodeGitMetadata(output.stdoutBytes),
      head,
      remoteNames,
    ).slice(0, limit),
  };
}

async function nativeProfileGitCommitFiles(
  sessionId: number,
  environmentId: string,
  root: string,
  cwd: string,
  shaValue: unknown,
) {
  const repositoryRoot = await assertProfileGitRoot(sessionId, root, cwd);
  const sha = await nativeProfileGitCommitSha(sessionId, cwd, shaValue);
  const [names, stats] = await Promise.all([
    runHelperGit(
      sessionId,
      cwd,
      [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--no-renames",
        "--name-status",
        "-r",
        "-z",
        sha,
      ],
      MAX_GIT_OUTPUT_BYTES,
      false,
      false,
      undefined,
      30,
    ),
    runHelperGit(
      sessionId,
      cwd,
      [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--no-renames",
        "--numstat",
        "-r",
        "-z",
        sha,
      ],
      MAX_GIT_OUTPUT_BYTES,
      false,
      false,
      undefined,
      30,
    ),
  ]);
  const repositoryRelative = relativeToRemoteRoot(root, repositoryRoot);
  return parseGitCommitFiles(
    decodeGitMetadata(names.stdoutBytes),
    decodeGitMetadata(stats.stdoutBytes),
  ).map((file) => ({
    path: remotePath(
      environmentId,
      joinRemotePath(root, joinRelativePath(repositoryRelative, file.relative)),
    ),
    ...file,
    staged: false,
    unstaged: false,
  }));
}

async function nativeProfileGitCommitFileDiff(
  sessionId: number,
  environmentId: string,
  root: string,
  cwd: string,
  shaValue: unknown,
  pathValue: unknown,
) {
  const relative = helperRelativePath(pathValue);
  const repositoryRoot = await assertProfileGitRoot(sessionId, root, cwd);
  const sha = await nativeProfileGitCommitSha(sessionId, cwd, shaValue);
  const parentOutput = await runHelperGit(
    sessionId,
    cwd,
    ["rev-parse", "--verify", `${sha}^`],
    64 * 1024,
    true,
  );
  const parent = parentOutput.stdout.trim();
  const readBlob = async (ref: string) => {
    const output = await runHelperGit(
      sessionId,
      cwd,
      ["show", "--no-ext-diff", "--no-textconv", `${ref}:${relative}`],
      MAX_GIT_DIFF_BYTES,
      true,
      true,
    );
    return {
      exists: output.exitCode === 0,
      bytes: output.stdoutBytes,
      tooLarge:
        output.stdoutTruncated ||
        output.stdoutBytes.byteLength > MAX_GIT_DIFF_BYTES,
    };
  };
  const [original, current] = await Promise.all([
    parent && /^[0-9a-f]{40,64}$/i.test(parent)
      ? readBlob(parent)
      : Promise.resolve({
          exists: false,
          bytes: new Uint8Array(),
          tooLarge: false,
        }),
    readBlob(sha),
  ]);
  if (!original.exists && !current.exists) {
    throw new Error("The commit does not contain this file.");
  }
  const binary = original.bytes.includes(0) || current.bytes.includes(0);
  const tooLarge = original.tooLarge || current.tooLarge;
  const repositoryRelative = relativeToRemoteRoot(root, repositoryRoot);
  return {
    path: remotePath(
      environmentId,
      joinRemotePath(root, joinRelativePath(repositoryRelative, relative)),
    ),
    relative,
    status: !original.exists
      ? "added"
      : !current.exists
        ? "deleted"
        : "modified",
    original:
      binary || tooLarge ? "" : new TextDecoder().decode(original.bytes),
    current: binary || tooLarge ? "" : new TextDecoder().decode(current.bytes),
    binary,
    tooLarge,
  };
}

async function nativeProfileGitCommit(
  sessionId: number,
  root: string,
  cwd: string,
  value: unknown,
  pathsValue: unknown,
  returnResult: boolean,
): Promise<{ commitSha: string; summary: string } | undefined> {
  const message = requireString({ message: value }, "message").trim();
  if (!message) throw new Error("Commit message cannot be empty");
  let selectedPaths: string[] | null = null;
  if (pathsValue !== undefined && pathsValue !== null) {
    if (!Array.isArray(pathsValue)) {
      throw new Error("The selected Git commit paths are invalid.");
    }
    if (pathsValue.length === 0 || pathsValue.length > 256) {
      throw new Error("Select between 1 and 256 changed files to commit.");
    }
    const inputPathBytes = pathsValue.reduce((total, path) => {
      if (typeof path !== "string" || path.length > 64 * 1024) {
        throw new Error("The selected Git commit paths are invalid.");
      }
      return total + new TextEncoder().encode(path).byteLength;
    }, 0);
    if (inputPathBytes > 64 * 1024) {
      throw new Error("Selected Git commit paths are too large.");
    }
    selectedPaths = pathsValue.map(helperRelativePath);
  }
  const messageLimit = selectedPaths ? 4096 : MAX_GIT_COMMIT_MESSAGE_BYTES;
  if (
    message.length > messageLimit ||
    new TextEncoder().encode(message).byteLength > messageLimit
  ) {
    throw new Error("Commit message is too large");
  }
  const repositoryRoot = await assertProfileGitRoot(sessionId, root, cwd);

  let commitArgs = ["commit", "--cleanup=strip", "-m", message];
  if (selectedPaths) {
    const repositoryPaths = selectedPaths.map((path) =>
      relativeToRemoteRoot(repositoryRoot, joinRemotePath(root, path)),
    );
    if (repositoryPaths.length === 0 || repositoryPaths.length > 256) {
      throw new Error("Select between 1 and 256 changed files to commit.");
    }
    const uniquePaths = [...new Set(repositoryPaths)];
    const pathBytes = uniquePaths.reduce(
      (total, path) => total + new TextEncoder().encode(path).byteLength,
      0,
    );
    if (pathBytes > 64 * 1024) {
      throw new Error("Selected Git commit paths are too large.");
    }
    const status = await nativeProfileGitStatus(sessionId, cwd);
    if (!status) throw new Error("No Git repository is available.");
    const selectedFiles = uniquePaths.map((path) => {
      const file = status.files.find((entry) => entry.relative === path);
      if (!file) throw new Error("A selected path is not a changed file.");
      return file;
    });
    const untracked = selectedFiles
      .filter((file) => file.status === "untracked")
      .map((file) => file.relative);
    if (untracked.length > 0) {
      const add = await runHelperGit(
        sessionId,
        cwd,
        ["add", "--", ...untracked.map((path) => `:(literal)${path}`)],
        64 * 1024,
        true,
      );
      if (add.exitCode !== 0) {
        throw new Error(
          add.stderr.trim() || add.stdout.trim() || "Remote Git add failed.",
        );
      }
    }
    commitArgs = [
      "commit",
      "--only",
      "-m",
      message,
      "--",
      ...uniquePaths.map((path) => `:(literal)${path}`),
    ];
  }

  const commit = await runHelperGit(
    sessionId,
    cwd,
    commitArgs,
    64 * 1024,
    true,
    true,
    undefined,
    120,
  );
  if (commit.exitCode !== 0) {
    throw new Error(
      commit.stderr.trim() ||
        commit.stdout.trim() ||
        "Remote Git commit failed.",
    );
  }
  if (!returnResult) return undefined;
  const details = await runHelperGit(
    sessionId,
    cwd,
    ["show", "-s", "--format=%H%x00%s", "HEAD"],
    64 * 1024,
  );
  const [commitSha, ...subject] = decodeGitMetadata(details.stdoutBytes).split(
    "\0",
  );
  if (!commitSha || !/^[0-9a-f]{40,64}$/i.test(commitSha)) {
    throw new Error("Could not resolve the new remote Git commit.");
  }
  return { commitSha, summary: subject.join("\0").trim() };
}

async function nativeProfileGitShowCommit(
  sessionId: number,
  root: string,
  cwd: string,
  shaValue: unknown,
): Promise<{ diffText: string; truncated: boolean }> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const sha = await nativeProfileGitCommitSha(sessionId, cwd, shaValue);
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["show", "--no-color", "--no-ext-diff", "--patch-with-stat", sha, "--"],
    MAX_GIT_OUTPUT_BYTES,
    false,
    true,
  );
  return {
    diffText: result.stdout,
    truncated: result.stdoutTruncated || result.stderrTruncated,
  };
}

async function nativeProfileGitTagName(
  sessionId: number,
  cwd: string,
  value: unknown,
): Promise<string> {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_GIT_REF_BYTES ||
    value.startsWith("-") ||
    value.includes("..") ||
    /\s/.test(value) ||
    new TextEncoder().encode(value).byteLength > MAX_GIT_REF_BYTES
  ) {
    throw new Error("The Git tag name is invalid.");
  }
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["check-ref-format", `refs/tags/${value}`],
    64 * 1024,
    true,
  );
  if (result.exitCode !== 0) throw new Error("The Git tag name is invalid.");
  return value;
}

async function nativeProfileGitTagList(
  sessionId: number,
  root: string,
  cwd: string,
): Promise<
  Array<{
    name: string;
    sha: string;
    annotated: boolean;
    message: string | null;
    timestampSecs: number;
  }>
> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const format =
    "%(refname:short)%00%(objectname)%00%(*objectname)%00%(objecttype)%00%(creatordate:unix)%00%(contents:subject)";
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["tag", "--sort=-creatordate", `--format=${format}`],
    MAX_GIT_OUTPUT_BYTES,
  );
  const lines = decodeGitMetadata(result.stdoutBytes)
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length > MAX_GIT_TAGS) {
    throw new Error("The remote Git repository has too many tags to display.");
  }
  return lines.map((line) => {
    const [name, directSha, peeledSha, objectType, rawTimestamp, rawMessage] =
      line.split("\0");
    const annotated = objectType === "tag";
    const sha = annotated && peeledSha ? peeledSha : directSha;
    if (
      !name ||
      !sha ||
      !/^[0-9a-f]{40,64}$/i.test(sha) ||
      rawTimestamp === undefined ||
      rawMessage === undefined
    ) {
      throw new Error("The remote helper returned invalid Git tags.");
    }
    const timestamp = Number(rawTimestamp);
    return {
      name,
      sha,
      annotated,
      message: annotated && rawMessage.trim() ? rawMessage.trim() : null,
      timestampSecs: Number.isSafeInteger(timestamp) ? timestamp : 0,
    };
  });
}

async function nativeProfileGitTagCreate(
  sessionId: number,
  root: string,
  cwd: string,
  nameValue: unknown,
  targetShaValue: unknown,
  messageValue: unknown,
): Promise<void> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const name = await nativeProfileGitTagName(sessionId, cwd, nameValue);
  let targetSha: string | null = null;
  if (targetShaValue !== undefined && targetShaValue !== null) {
    targetSha = await nativeProfileGitCommitSha(sessionId, cwd, targetShaValue);
  }
  if (
    messageValue !== undefined &&
    messageValue !== null &&
    typeof messageValue !== "string"
  ) {
    throw new Error("The Git tag message is invalid.");
  }
  const message = typeof messageValue === "string" ? messageValue : "";
  if (
    message.length > MAX_GIT_COMMIT_MESSAGE_BYTES ||
    new TextEncoder().encode(message).byteLength > MAX_GIT_COMMIT_MESSAGE_BYTES
  ) {
    throw new Error("The Git tag message is too large.");
  }
  const args = ["tag"];
  if (message) args.push("-a");
  args.push(name);
  if (message) args.push("-m", message);
  if (targetSha) args.push(targetSha);
  await runHelperGit(sessionId, cwd, args, 64 * 1024, false);
}

async function nativeProfileGitTagDelete(
  sessionId: number,
  root: string,
  cwd: string,
  nameValue: unknown,
): Promise<void> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const name = await nativeProfileGitTagName(sessionId, cwd, nameValue);
  await runHelperGit(sessionId, cwd, ["tag", "-d", name], 64 * 1024, false);
}

async function nativeProfileGitTagPush(
  sessionId: number,
  root: string,
  cwd: string,
  nameValue: unknown,
  remoteValue: unknown,
): Promise<void> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const name = await nativeProfileGitTagName(sessionId, cwd, nameValue);
  const remote =
    remoteValue === undefined || remoteValue === null || remoteValue === ""
      ? "origin"
      : typeof remoteValue === "string"
        ? remoteValue
        : "";
  if (!remote || remote.length > 64 || !/^[A-Za-z0-9_.-]+$/.test(remote)) {
    throw new Error("The Git remote name is invalid.");
  }
  await runHelperGit(
    sessionId,
    cwd,
    ["push", remote, name],
    64 * 1024,
    false,
    true,
    undefined,
    GIT_NETWORK_TIMEOUT_SECS,
  );
}

function parseNativeProfileGitLog(output: string) {
  const entries = output.split(/\r?\n/).flatMap((line) => {
    if (!line) return [];
    const fields = line.split("\x1f");
    const [sha, author, authorEmail, rawTimestamp, rawParents] = fields;
    if (!sha || !/^[0-9a-f]{40,64}$/i.test(sha) || fields.length < 6) {
      return [];
    }
    const parsedTimestamp = Number(rawTimestamp);
    const subject = fields.slice(5).join("\x1f");
    return [
      {
        sha,
        shortSha: sha.slice(0, 7),
        author: author ?? "",
        authorEmail: authorEmail ?? "",
        timestampSecs: Number.isSafeInteger(parsedTimestamp)
          ? parsedTimestamp
          : 0,
        parents: (rawParents ?? "").split(/\s+/).filter(Boolean),
        subject,
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      },
    ];
  });
  if (entries.length > MAX_GIT_COMPARE_COMMITS) {
    throw new Error("The remote Git comparison has too many commits.");
  }
  return entries;
}

function parseNativeProfileGitCompareFiles(
  nameStatusOutput: string,
  numstatOutput: string,
) {
  const nameStatus = nameStatusOutput.split("\0").filter(Boolean);
  const numstat = numstatOutput.split("\0").filter(Boolean);
  const stats = new Map<
    string,
    { added: number; removed: number; isBinary: boolean }
  >();

  for (let index = 0; index < numstat.length;) {
    const record = numstat[index++];
    if (!record) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      throw new Error("The remote helper returned invalid Git change counts.");
    }
    const rawAdded = record.slice(0, firstTab);
    const rawRemoved = record.slice(firstTab + 1, secondTab);
    let path = record.slice(secondTab + 1);
    if (!path) {
      index += 1;
      path = numstat[index++] ?? "";
    }
    const relative = helperRelativePath(path);
    const isBinary = rawAdded === "-" && rawRemoved === "-";
    const added = rawAdded === "-" ? 0 : Number(rawAdded);
    const removed = rawRemoved === "-" ? 0 : Number(rawRemoved);
    if (
      !Number.isSafeInteger(added) ||
      added < 0 ||
      !Number.isSafeInteger(removed) ||
      removed < 0
    ) {
      throw new Error("The remote helper returned invalid Git change counts.");
    }
    stats.set(relative, { added, removed, isBinary });
  }

  const files = [];
  for (let index = 0; index < nameStatus.length;) {
    const statusToken = nameStatus[index++];
    if (!statusToken) continue;
    const status = statusToken[0];
    const originalPath =
      status === "R" || status === "C" ? nameStatus[index++] : undefined;
    const path = nameStatus[index++];
    if (!path || (originalPath !== undefined && !originalPath)) {
      throw new Error(
        "The remote helper returned an incomplete Git file list.",
      );
    }
    const relative = helperRelativePath(path);
    const originalRelative =
      originalPath === undefined ? null : helperRelativePath(originalPath);
    const count = stats.get(relative);
    const statusLabel =
      status === "A"
        ? "Added"
        : status === "D"
          ? "Deleted"
          : status === "M"
            ? "Modified"
            : status === "R"
              ? "Renamed"
              : status === "C"
                ? "Copied"
                : status === "T"
                  ? "Type changed"
                  : status === "U"
                    ? "Unmerged"
                    : `Status ${status}`;
    files.push({
      path: relative,
      originalPath: originalRelative,
      status,
      statusLabel,
      added: count?.added ?? 0,
      removed: count?.removed ?? 0,
      isBinary: count?.isBinary ?? false,
    });
    if (files.length > MAX_GIT_COMPARE_FILES) {
      throw new Error("The remote Git comparison has too many files.");
    }
  }
  return files;
}

async function nativeProfileGitLogRange(
  sessionId: number,
  cwd: string,
  range: string,
) {
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["log", "--no-color", `--format=${GIT_COMPARE_LOG_FORMAT}`, range],
    MAX_GIT_OUTPUT_BYTES,
    false,
    false,
    undefined,
    GIT_MUTATION_TIMEOUT_SECS,
  );
  return parseNativeProfileGitLog(decodeGitMetadata(result.stdoutBytes));
}

async function nativeProfileGitCompareBranches(
  sessionId: number,
  root: string,
  cwd: string,
  baseValue: unknown,
  compareValue: unknown,
) {
  await assertProfileGitRoot(sessionId, root, cwd);
  const base = await nativeProfileGitBranchName(sessionId, cwd, baseValue);
  const compare = await nativeProfileGitBranchName(
    sessionId,
    cwd,
    compareValue,
  );
  const ahead = await nativeProfileGitLogRange(
    sessionId,
    cwd,
    `${base}..${compare}`,
  );
  const behind = await nativeProfileGitLogRange(
    sessionId,
    cwd,
    `${compare}..${base}`,
  );
  const diffArgs = ["diff", "--no-commit-id", "-r", "-z"];
  const nameStatusResult = await runHelperGit(
    sessionId,
    cwd,
    [...diffArgs, "--name-status", `${base}...${compare}`],
    MAX_GIT_OUTPUT_BYTES,
    false,
    false,
    undefined,
    GIT_MUTATION_TIMEOUT_SECS,
  );
  const numstatResult = await runHelperGit(
    sessionId,
    cwd,
    [...diffArgs, "--numstat", `${base}...${compare}`],
    MAX_GIT_OUTPUT_BYTES,
    false,
    false,
    undefined,
    GIT_MUTATION_TIMEOUT_SECS,
  );
  const files = parseNativeProfileGitCompareFiles(
    decodeGitMetadata(nameStatusResult.stdoutBytes),
    decodeGitMetadata(numstatResult.stdoutBytes),
  );
  return { ahead, behind, files };
}

async function nativeProfileGitRemoteName(
  sessionId: number,
  cwd: string,
): Promise<string> {
  const names = await nativeProfileGitRemoteNames(sessionId, cwd);
  const remote = names.includes("origin") ? "origin" : names[0];
  if (!remote) throw new Error("No Git remote to push to");
  return remote;
}

async function nativeProfileGitRemoteUrl(
  sessionId: number,
  root: string,
  cwd: string,
  value: unknown,
): Promise<string | null> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const name =
    value === undefined || value === null
      ? "origin"
      : typeof value === "string"
        ? value
        : "";
  if (!name || name.length > 64 || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    return null;
  }
  const remotes = await nativeProfileGitRemoteNames(sessionId, cwd);
  if (!remotes.includes(name)) return null;
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["config", "--get", `remote.${name}.url`],
    64 * 1024,
    true,
  );
  if (result.exitCode !== 0) return null;
  const url = result.stdout.split(/\r?\n/, 1)[0]?.trim();
  return url || null;
}

async function nativeProfileGitHasUpstream(
  sessionId: number,
  cwd: string,
): Promise<boolean> {
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["rev-parse", "--abbrev-ref", "@{upstream}"],
    64 * 1024,
    true,
  );
  return result.exitCode === 0 && Boolean(result.stdout.trim());
}

async function nativeProfileGitUpstream(
  sessionId: number,
  cwd: string,
): Promise<string | null> {
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["rev-parse", "--abbrev-ref", "@{upstream}"],
    64 * 1024,
    true,
  );
  const upstream = result.exitCode === 0 ? result.stdout.trim() : "";
  return upstream || null;
}

function splitNativeProfileGitUpstream(
  upstream: string,
  remotes: string[],
): { remote: string | null; branch: string | null } {
  const remote = [...remotes]
    .sort((left, right) => right.length - left.length)
    .find((name) => upstream.startsWith(`${name}/`));
  if (remote) {
    return { remote, branch: upstream.slice(remote.length + 1) || null };
  }
  const separator = upstream.indexOf("/");
  return separator > 0
    ? {
        remote: upstream.slice(0, separator),
        branch: upstream.slice(separator + 1) || null,
      }
    : { remote: null, branch: null };
}

type NativeProfileGitPushResult = {
  remote: string | null;
  branch: string | null;
  pushed: boolean;
};

async function nativeProfileGitPush(
  sessionId: number,
  cwd: string,
): Promise<NativeProfileGitPushResult> {
  const upstream = await nativeProfileGitUpstream(sessionId, cwd);
  let selectedRemote: string | null = null;
  const args = ["push"];
  if (!upstream) {
    selectedRemote = await nativeProfileGitRemoteName(sessionId, cwd);
    args.push("-u", "--", selectedRemote, "HEAD");
  }
  await runHelperGit(
    sessionId,
    cwd,
    args,
    64 * 1024,
    false,
    true,
    undefined,
    GIT_NETWORK_TIMEOUT_SECS,
  );
  const finalUpstream = await nativeProfileGitUpstream(sessionId, cwd);
  if (finalUpstream) {
    const remotes = await nativeProfileGitRemoteNames(sessionId, cwd);
    return {
      ...splitNativeProfileGitUpstream(finalUpstream, remotes),
      pushed: true,
    };
  }
  return {
    remote: selectedRemote,
    branch: await nativeProfileGitHeadBranch(sessionId, cwd),
    pushed: true,
  };
}

async function nativeProfileGitNetworkCommand(
  sessionId: number,
  root: string,
  cwd: string,
  command: string,
): Promise<NativeProfileGitPushResult | undefined> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const runNetworkGit = (args: string[]) =>
    runHelperGit(
      sessionId,
      cwd,
      args,
      64 * 1024,
      false,
      true,
      undefined,
      GIT_NETWORK_TIMEOUT_SECS,
    ).then(() => undefined);

  if (command === "git_pull") {
    await runNetworkGit(["pull", "--ff-only"]);
    return;
  }

  if (command === "git_fetch") {
    await runNetworkGit(["fetch", "--prune"]);
    return;
  }

  if (command === "git_push") {
    return nativeProfileGitPush(sessionId, cwd);
  }

  const hasUpstream = await nativeProfileGitHasUpstream(sessionId, cwd);
  if (command === "git_sync" && hasUpstream) {
    await runNetworkGit(["pull", "--no-edit", "--ff"]);
    await runNetworkGit(["push"]);
    return;
  }
  if (hasUpstream) {
    await runNetworkGit(["push"]);
    return;
  }
  const remote = await nativeProfileGitRemoteName(sessionId, cwd);
  await runNetworkGit(["push", "-u", "--", remote, "HEAD"]);
}

async function nativeProfileGitIsWorkTree(
  sessionId: number,
  cwd: string,
): Promise<boolean> {
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["rev-parse", "--is-inside-work-tree"],
    64 * 1024,
    true,
  );
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

async function nativeProfileGitHeadBranch(
  sessionId: number,
  cwd: string,
): Promise<string | null> {
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["symbolic-ref", "--short", "HEAD"],
    64 * 1024,
    true,
  );
  const branch = result.exitCode === 0 ? result.stdout.trim() : "";
  return branch && branch !== "HEAD" ? branch : null;
}

async function nativeProfileGitBranchName(
  sessionId: number,
  cwd: string,
  value: unknown,
): Promise<string> {
  if (typeof value !== "string") {
    throw new Error("The remote command requires name.");
  }
  const name = value.trim();
  if (!name) throw new Error("Branch name cannot be empty");
  if (new TextEncoder().encode(name).byteLength > MAX_GIT_REF_BYTES) {
    throw new Error("Branch name is too large");
  }
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["check-ref-format", "--branch", name],
    64 * 1024,
    true,
  );
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error(`'${name}' is not a valid branch name`);
  }
  return result.stdout.trim();
}

async function nativeProfileGitRefExists(
  sessionId: number,
  cwd: string,
  ref: string,
): Promise<boolean> {
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["show-ref", "--verify", "--quiet", ref],
    64 * 1024,
    true,
  );
  return result.exitCode === 0;
}

async function nativeProfileGitRemoteNames(
  sessionId: number,
  cwd: string,
): Promise<string[]> {
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["remote"],
    64 * 1024,
    true,
  );
  return decodeGitMetadata(result.stdoutBytes)
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

async function nativeProfileGitBranches(
  sessionId: number,
  root: string,
  cwd: string,
): Promise<GitBranches> {
  if (!(await nativeProfileGitIsWorkTree(sessionId, cwd))) {
    return { current: null, detached: false, branches: [] };
  }
  await assertProfileGitRoot(sessionId, root, cwd);

  const currentBranch = await nativeProfileGitHeadBranch(sessionId, cwd);
  const head = await runHelperGit(
    sessionId,
    cwd,
    ["rev-parse", "--short", "HEAD"],
    64 * 1024,
    true,
  );
  const headSha = head.exitCode === 0 ? head.stdout.trim() || null : null;
  const localRefs = await runHelperGit(sessionId, cwd, [
    "for-each-ref",
    "--format=%(refname:short)%09%(HEAD)",
    "refs/heads",
  ]);
  const remoteRefs = await runHelperGit(sessionId, cwd, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/remotes",
  ]);
  return parseGitBranches(
    currentBranch,
    headSha,
    decodeGitMetadata(localRefs.stdoutBytes),
    decodeGitMetadata(remoteRefs.stdoutBytes),
  );
}

async function nativeProfileGitMutation(
  sessionId: number,
  cwd: string,
  gitArgs: string[],
  timeoutSecs = 10,
): Promise<void> {
  const result = await runHelperGit(
    sessionId,
    cwd,
    gitArgs,
    64 * 1024,
    true,
    false,
    undefined,
    timeoutSecs,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Remote Git operation failed.",
    );
  }
}

async function nativeProfileGitCheckoutMutation(
  sessionId: number,
  cwd: string,
  gitArgs: string[],
): Promise<void> {
  try {
    await nativeProfileGitMutation(sessionId, cwd, gitArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isCheckoutBlockedByChanges(message)) {
      throw new Error(
        "Your local changes would be overwritten. Commit or stash them first.",
      );
    }
    throw error;
  }
}

async function nativeProfileGitCheckout(
  sessionId: number,
  root: string,
  cwd: string,
  value: unknown,
  remoteValue: unknown,
): Promise<string> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const name = await nativeProfileGitBranchName(sessionId, cwd, value);
  if (
    remoteValue !== undefined &&
    remoteValue !== null &&
    typeof remoteValue !== "string"
  ) {
    throw new Error("The remote branch name is invalid.");
  }
  const requestedRemote =
    typeof remoteValue === "string" ? remoteValue.trim() : "";
  const current = await nativeProfileGitHeadBranch(sessionId, cwd);
  if (current === name) return name;

  if (requestedRemote) {
    if (requestedRemote.startsWith("-")) {
      throw new Error("The remote branch name is invalid.");
    }
    const remotes = await nativeProfileGitRemoteNames(sessionId, cwd);
    if (!remotes.includes(requestedRemote)) {
      throw new Error(`Remote ${requestedRemote} not found`);
    }
    const ref = `refs/remotes/${requestedRemote}/${name}`;
    const validRef = await runHelperGit(
      sessionId,
      cwd,
      ["check-ref-format", ref],
      64 * 1024,
      true,
    );
    if (validRef.exitCode !== 0)
      throw new Error("The remote branch name is invalid.");
    if (!(await nativeProfileGitRefExists(sessionId, cwd, ref))) {
      throw new Error(`Branch ${name} not found`);
    }
    await nativeProfileGitCheckoutMutation(sessionId, cwd, [
      "checkout",
      "--track",
      "-b",
      name,
      `${requestedRemote}/${name}`,
    ]);
    return name;
  }

  if (await nativeProfileGitRefExists(sessionId, cwd, `refs/heads/${name}`)) {
    await nativeProfileGitCheckoutMutation(sessionId, cwd, ["checkout", name]);
    return name;
  }
  const remotes = await nativeProfileGitRemoteNames(sessionId, cwd);
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  if (remote && !remote.startsWith("-")) {
    const ref = `refs/remotes/${remote}/${name}`;
    if (await nativeProfileGitRefExists(sessionId, cwd, ref)) {
      await nativeProfileGitCheckoutMutation(sessionId, cwd, [
        "checkout",
        "--track",
        "-b",
        name,
        `${remote}/${name}`,
      ]);
      return name;
    }
  }
  throw new Error(`Branch ${name} not found`);
}

async function nativeProfileGitCreateBranch(
  sessionId: number,
  root: string,
  cwd: string,
  value: unknown,
): Promise<string> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const name = await nativeProfileGitBranchName(sessionId, cwd, value);
  if (
    (await nativeProfileGitRefExists(sessionId, cwd, `refs/heads/${name}`)) ||
    (await nativeProfileGitHeadBranch(sessionId, cwd)) === name
  ) {
    throw new Error(`Branch ${name} already exists`);
  }
  await nativeProfileGitMutation(sessionId, cwd, ["checkout", "-b", name]);
  return name;
}

async function nativeProfileGitBranchFromCommit(
  sessionId: number,
  root: string,
  cwd: string,
  nameValue: unknown,
  shaValue: unknown,
): Promise<void> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const name = await nativeProfileGitBranchName(sessionId, cwd, nameValue);
  const sha = await nativeProfileGitCommitSha(sessionId, cwd, shaValue);
  await nativeProfileGitMutation(
    sessionId,
    cwd,
    ["checkout", "-b", name, sha],
    GIT_MUTATION_TIMEOUT_SECS,
  );
}

async function nativeProfileGitHeadSha(
  sessionId: number,
  cwd: string,
): Promise<string> {
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["rev-parse", "HEAD"],
    64 * 1024,
  );
  const sha = result.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) {
    throw new Error("Could not resolve the new remote Git commit.");
  }
  return sha;
}

async function nativeProfileGitApplyCommit(
  sessionId: number,
  root: string,
  cwd: string,
  operation: "cherry-pick" | "revert",
  shaValue: unknown,
): Promise<string> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const sha = await nativeProfileGitCommitSha(sessionId, cwd, shaValue);
  await nativeProfileGitMutation(
    sessionId,
    cwd,
    operation === "revert"
      ? ["revert", "--no-edit", sha]
      : ["cherry-pick", sha],
    GIT_MUTATION_TIMEOUT_SECS,
  );
  return nativeProfileGitHeadSha(sessionId, cwd);
}

const GIT_OPERATION_SUBCOMMANDS = {
  merge: "merge",
  revert: "revert",
  cherryPick: "cherry-pick",
  rebase: "rebase",
} as const;

async function nativeProfileGitOperationStatus(
  sessionId: number,
  root: string,
  cwd: string,
): Promise<{ kind: "none" | keyof typeof GIT_OPERATION_SUBCOMMANDS }> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const refs = [
    ["MERGE_HEAD", "merge"],
    ["CHERRY_PICK_HEAD", "cherryPick"],
    ["REVERT_HEAD", "revert"],
    ["REBASE_HEAD", "rebase"],
  ] as const;
  for (const [ref, kind] of refs) {
    const result = await runHelperGit(
      sessionId,
      cwd,
      ["rev-parse", "-q", "--verify", ref],
      64 * 1024,
      true,
    );
    if (result.exitCode === 0) return { kind };
  }
  return { kind: "none" };
}

async function nativeProfileGitOperationMutation(
  sessionId: number,
  root: string,
  cwd: string,
  kindValue: unknown,
  action: "--abort" | "--continue",
): Promise<void> {
  await assertProfileGitRoot(sessionId, root, cwd);
  if (
    typeof kindValue !== "string" ||
    !Object.keys(GIT_OPERATION_SUBCOMMANDS).includes(kindValue)
  ) {
    throw new Error("The Git operation kind is invalid.");
  }
  const kind = kindValue as keyof typeof GIT_OPERATION_SUBCOMMANDS;
  const gitArgs =
    action === "--continue"
      ? ["-c", "core.editor=true", GIT_OPERATION_SUBCOMMANDS[kind], action]
      : [GIT_OPERATION_SUBCOMMANDS[kind], action];
  await nativeProfileGitMutation(
    sessionId,
    cwd,
    gitArgs,
    GIT_MUTATION_TIMEOUT_SECS,
  );
}

async function nativeProfileGitStash(
  sessionId: number,
  root: string,
  cwd: string,
  value: unknown,
  includeUntrackedValue: unknown = true,
): Promise<void> {
  await assertProfileGitRoot(sessionId, root, cwd);
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new Error("The stash message is invalid.");
  }
  if (typeof includeUntrackedValue !== "boolean") {
    throw new Error("The stash include-untracked option is invalid.");
  }
  const message = typeof value === "string" ? value.trim() : "";
  if (
    new TextEncoder().encode(message).byteLength > MAX_GIT_COMMIT_MESSAGE_BYTES
  ) {
    throw new Error("Stash message is too large");
  }
  const args = ["stash", "push"];
  if (includeUntrackedValue) args.push("--include-untracked");
  if (message) args.push("-m", message);
  await nativeProfileGitMutation(sessionId, cwd, args);
}

async function nativeProfileGitStashList(
  sessionId: number,
  root: string,
  cwd: string,
): Promise<
  Array<{ index: number; sha: string; message: string; timestampSecs: number }>
> {
  await assertProfileGitRoot(sessionId, root, cwd);
  const result = await runHelperGit(
    sessionId,
    cwd,
    ["stash", "list", "--format=%H%x1f%at%x1f%s"],
    MAX_GIT_OUTPUT_BYTES,
    false,
  );
  const entries = decodeGitMetadata(result.stdoutBytes)
    .split(/\r?\n/)
    .flatMap((line, index) => {
      if (!line) return [];
      const [sha, rawTimestamp, ...messageParts] = line.split("\x1f");
      const timestamp = Number(rawTimestamp);
      if (
        !sha ||
        !/^[0-9a-f]{40,64}$/i.test(sha) ||
        !Number.isSafeInteger(timestamp)
      ) {
        throw new Error("The remote helper returned invalid Git stash data.");
      }
      return [
        {
          index,
          sha,
          timestampSecs: timestamp,
          message: messageParts.join("\x1f"),
        },
      ];
    });
  if (entries.length > MAX_GIT_STASHES) {
    throw new Error("The remote Git stash list has too many entries.");
  }
  return entries;
}

async function nativeProfileGitStashMutation(
  sessionId: number,
  root: string,
  cwd: string,
  operation: "apply" | "pop" | "drop",
  indexValue: unknown,
): Promise<void> {
  await assertProfileGitRoot(sessionId, root, cwd);
  if (
    typeof indexValue !== "number" ||
    !Number.isSafeInteger(indexValue) ||
    indexValue < 0 ||
    indexValue >= MAX_GIT_STASHES
  ) {
    throw new Error("The Git stash index is invalid.");
  }
  await nativeProfileGitMutation(
    sessionId,
    cwd,
    ["stash", operation, `stash@{${indexValue}}`],
    GIT_MUTATION_TIMEOUT_SECS,
  );
}

async function nativeProfileGitStageContents(
  sessionId: number,
  cwd: string,
  requestedPath: unknown,
  contents: string,
): Promise<void> {
  if (new TextEncoder().encode(contents).byteLength > MAX_GIT_INPUT_BYTES) {
    throw new Error("File too large");
  }
  const relative = helperRelativePath(requestedPath);
  const hashOutput = await runHelperGit(
    sessionId,
    cwd,
    ["hash-object", "-w", "--path", relative, "--stdin"],
    64 * 1024,
    false,
    false,
    contents,
  );
  const hash = hashOutput.stdout.trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hash)) {
    throw new Error("Remote Git returned an invalid content hash.");
  }
  const indexOutput = await runHelperGit(
    sessionId,
    cwd,
    ["--literal-pathspecs", "ls-files", "--stage", "--", relative],
    64 * 1024,
    true,
  );
  const mode = indexOutput.stdout.match(/^([0-7]{6})\s/)?.[1] ?? "100644";
  await runHelperGit(sessionId, cwd, [
    "update-index",
    "--add",
    "--cacheinfo",
    mode,
    hash,
    relative,
  ]);
}

async function nativeProfileFileDiff(
  sessionId: number,
  environmentId: string,
  root: string,
  cwd: string,
  supportsUntrackedLineCounts: boolean,
  requestedPath: unknown,
  staged: boolean,
): Promise<GitFileDiff> {
  const relative = helperRelativePath(requestedPath);
  const projectRelative = joinRelativePath(cwd, relative);
  const index = await nativeProfileGitIndex(
    sessionId,
    environmentId,
    root,
    cwd,
    supportsUntrackedLineCounts,
  );
  const file = index.files.find((entry) => entry.relative === relative);
  if (!file) throw new Error("File has no uncommitted changes.");

  const readBlob = async (spec: string) => {
    const output = await runHelperGit(
      sessionId,
      cwd,
      ["show", "--no-ext-diff", "--no-textconv", spec],
      MAX_GIT_DIFF_BYTES,
      true,
      true,
    );
    if (output.exitCode !== 0) {
      return { text: "", binary: false, tooLarge: false };
    }
    const tooLarge =
      output.stdoutTruncated ||
      output.stdoutBytes.byteLength > MAX_GIT_DIFF_BYTES;
    return {
      text: tooLarge ? "" : output.stdout,
      binary: !tooLarge && output.stdoutBytes.includes(0),
      tooLarge,
    };
  };
  const original = await readBlob(`${staged ? "HEAD" : ""}:${relative}`);
  let current: { text: string; binary: boolean; tooLarge: boolean };
  if (staged) {
    current = await readBlob(`:${relative}`);
  } else {
    try {
      const stat = await helperStat(sessionId, projectRelative);
      if (stat.size > MAX_GIT_DIFF_BYTES) {
        current = { text: "", binary: false, tooLarge: true };
      } else {
        const result = await requestRemoteResult<{ content: string }>(
          sessionId,
          HELPER_FS.readFile,
          { path: projectRelative },
        );
        const tooLarge =
          new TextEncoder().encode(result.content).byteLength >
          MAX_GIT_DIFF_BYTES;
        current = {
          text: tooLarge ? "" : result.content,
          binary: !tooLarge && result.content.includes("\0"),
          tooLarge,
        };
      }
    } catch (error) {
      if (file.status === "deleted") {
        current = { text: "", binary: false, tooLarge: false };
      } else if (
        error instanceof RemoteRequestError &&
        error.code === "binary_file"
      ) {
        current = { text: "", binary: true, tooLarge: false };
      } else if (
        error instanceof RemoteRequestError &&
        error.code === "file_too_large"
      ) {
        current = { text: "", binary: false, tooLarge: true };
      } else {
        throw error;
      }
    }
  }

  return {
    path: file.path,
    relative,
    status: file.status,
    original: original.text,
    current: current.text,
    binary: original.binary || current.binary,
    tooLarge: original.tooLarge || current.tooLarge,
  };
}

async function ensureRemoteDirectories(
  sessionId: number,
  relativeDirectory: string,
): Promise<void> {
  const parts = relativeDirectory === "." ? [] : relativeDirectory.split("/");
  let current = ".";
  for (const part of parts) {
    current = joinRelativePath(current, part);
    try {
      const existing = await helperStat(sessionId, current);
      if (existing.kind !== "dir") {
        throw new Error("A path component already exists as a file.");
      }
    } catch (error) {
      if (
        !(error instanceof RemoteRequestError) ||
        error.code !== "stat_failed"
      ) {
        throw error;
      }
      try {
        await requestRemoteResult(sessionId, HELPER_FS.createDir, {
          path: current,
        });
      } catch (createError) {
        const existing = await helperStat(sessionId, current).catch(
          () => undefined,
        );
        if (existing?.kind !== "dir") throw createError;
      }
    }
  }
}

async function helperListDirectory(
  sessionId: number,
  relativePath: string,
): Promise<HelperDirectoryEntry[]> {
  const result = await requestRemoteResult<{
    entries: HelperDirectoryEntry[];
  }>(sessionId, HELPER_FS.listDir, { path: relativePath });
  return result.entries;
}

function projectFilePathsFromGit(output: HelperGitOutput): string[] {
  let bytes = output.stdoutBytes;
  if (output.stdoutTruncated) {
    const terminator = bytes.lastIndexOf(0);
    if (terminator < 0) {
      throw new Error("The remote Git file listing was truncated.");
    }
    bytes = bytes.subarray(0, terminator + 1);
  } else if (bytes.length > 0 && bytes[bytes.length - 1] !== 0) {
    throw new Error("The remote helper returned an incomplete Git file list.");
  }
  return decodeGitMetadata(bytes).split("\0").filter(Boolean);
}

function projectFilesFromGit(
  output: HelperGitOutput,
  environmentId: string,
  root: string,
): Array<{ name: string; path: string; relative: string }> {
  const found = [];
  for (const relative of projectFilePathsFromGit(output)) {
    const parts = relative.split("/");
    if (
      !relative ||
      relative.startsWith("/") ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error(
        "The remote Git file listing contains a path outside the project.",
      );
    }
    if (
      relative.includes("\\") ||
      parts[parts.length - 1] === ".DS_Store" ||
      parts.some((part) => PROJECT_WALK_SKIPS.has(part))
    ) {
      continue;
    }
    found.push({
      name: parts[parts.length - 1],
      relative,
      path: remotePath(environmentId, joinRemotePath(root, relative)),
    });
    if (found.length >= MAX_PROJECT_FILES) break;
  }
  return found.sort((left, right) =>
    left.relative.localeCompare(right.relative),
  );
}

async function listProjectFilesWithHelper(
  sessionId: number,
  environmentId: string,
  root: string,
  cwd: string,
  isCurrent: () => boolean,
): Promise<Array<{ name: string; path: string; relative: string }>> {
  assertProjectFileSourceCurrent(isCurrent);
  const gitFiles = await runHelperGit(
    sessionId,
    cwd,
    ["ls-files", "-co", "--exclude-standard", "-z"],
    MAX_GIT_OUTPUT_BYTES,
    true,
    true,
  );
  assertProjectFileSourceCurrent(isCurrent);
  if (gitFiles.exitCode === 0) {
    return projectFilesFromGit(gitFiles, environmentId, root);
  }

  const exactIgnores = new Set([".git"]);
  const suffixIgnores: string[] = [];
  try {
    assertProjectFileSourceCurrent(isCurrent);
    const ignoreFile = await requestRemoteResult<{ content: string }>(
      sessionId,
      HELPER_FS.readFile,
      { path: joinRelativePath(cwd, ".gitignore") },
    );
    assertProjectFileSourceCurrent(isCurrent);
    for (const raw of ignoreFile.content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      const pattern = line.replace(/\/+$/, "");
      if (pattern.includes("/")) continue;
      if (pattern.startsWith("*.") && !pattern.slice(2).includes("*")) {
        suffixIgnores.push(`.${pattern.slice(2)}`);
      } else if (!pattern.includes("*")) {
        exactIgnores.add(pattern);
      }
    }
  } catch {
    // Projects without a root .gitignore use the built-in skip list only.
  }
  assertProjectFileSourceCurrent(isCurrent);

  const isIgnored = (name: string) =>
    exactIgnores.has(name) ||
    suffixIgnores.some((suffix) => name.endsWith(suffix));
  const found: Array<{ name: string; path: string; relative: string }> = [];
  const pending = ["."];
  let visitedDirectories = 0;
  while (pending.length > 0) {
    assertProjectFileSourceCurrent(isCurrent);
    const directory = pending.pop()!;
    visitedDirectories += 1;
    if (visitedDirectories > 4000) {
      throw new Error("The remote project contains too many folders to list.");
    }
    const entries = await helperListDirectory(
      sessionId,
      joinRelativePath(cwd, directory),
    );
    assertProjectFileSourceCurrent(isCurrent);
    for (const entry of entries) {
      if (
        typeof entry.name !== "string" ||
        !entry.name ||
        entry.name === "." ||
        entry.name === ".." ||
        entry.name.includes("/") ||
        entry.name.includes("\0")
      )
        throw new Error("The remote helper returned an invalid project entry.");
      if (entry.name.includes("\\")) continue;
      if (entry.name === ".DS_Store" || isIgnored(entry.name)) continue;
      const relative = joinRelativePath(directory, entry.name);
      if (entry.kind === "directory") {
        if (!entry.isSymlink && !PROJECT_WALK_SKIPS.has(entry.name)) {
          pending.push(relative);
        }
      } else {
        found.push({
          name: entry.name,
          relative,
          path: remotePath(environmentId, joinRemotePath(root, relative)),
        });
        if (found.length >= MAX_PROJECT_FILES) {
          return found.sort((left, right) =>
            left.relative.localeCompare(right.relative),
          );
        }
      }
    }
  }
  return found.sort((left, right) =>
    left.relative.localeCompare(right.relative),
  );
}

export async function readCapturedProjectIndex(
  path: string,
  project: Readonly<RemoteProject>,
  profile: Readonly<SshConnection>,
  isCurrent: () => boolean,
) {
  assertProjectFileSourceCurrent(isCurrent);
  const parsed = parseRemotePath(path);
  const root = normalizeRemoteAbsolute(project.cwd);
  if (
    !parsed ||
    parsed.environmentId !== project.environmentId ||
    path.includes("\\") ||
    project.cwd.includes("\\") ||
    path.includes("\0")
  )
    throw new Error("The remote project index path is invalid.");
  const cwd = relativeToRemoteRoot(root, parsed.hostPath);
  const resultRoot = normalizeRemoteAbsolute(parsed.hostPath);
  const environmentId = project.environmentId;
  const files = await remoteSessions
    .use(
      { profileId: profile.id, root },
      remoteSshConnectionForProfile({ ...profile }),
      async (session) => {
        assertProjectFileSourceCurrent(isCurrent);
        normalizeRemoteAbsolute(session.workspace_root);
        const files = await listProjectFilesWithHelper(
          session.session_id,
          environmentId,
          resultRoot,
          cwd,
          isCurrent,
        );
        assertProjectFileSourceCurrent(isCurrent);
        return files;
      },
    )
    .catch((error) => {
      assertProjectFileSourceCurrent(isCurrent);
      throw error;
    });
  assertProjectFileSourceCurrent(isCurrent);
  return files;
}

/** GitHub is reached from this computer with the stored token, never through the remote host. */
const PROFILE_GITHUB: ProfileGithub = {
  branchStatus: (ownerRepo, head) =>
    invoke<GithubBranchStatus>("git_review_github_branch_status", {
      ownerRepo,
      head,
    }),
  createPullRequest: ({ ownerRepo, title, body, base, head }) =>
    invoke<string>("git_review_github_create_pr", {
      ownerRepo,
      title,
      body,
      base,
      head,
    }),
};

async function runProfileFileCommand(
  command: string,
  args: Record<string, unknown>,
  environmentId: string,
  sessionId: number,
  root: string,
  supportsUntrackedLineCounts: boolean,
  supportsFilePreview: boolean,
  relativePath: (value: unknown) => string,
): Promise<unknown> {
  if (!PROFILE_HELPER_COMMANDS.has(command))
    throw new Error(PROFILE_UNAVAILABLE);
  const remoteResultPath = (value: string) => remotePath(environmentId, value);
  if (command === "git_history") {
    return nativeProfileGitHistory(
      sessionId,
      environmentId,
      root,
      relativePath(args.cwd),
      args.limit,
      args.allRefs,
    );
  }
  if (command === "git_commit_files") {
    return nativeProfileGitCommitFiles(
      sessionId,
      environmentId,
      root,
      relativePath(args.cwd),
      args.sha,
    );
  }
  if (command === "git_commit_file_diff") {
    return nativeProfileGitCommitFileDiff(
      sessionId,
      environmentId,
      root,
      relativePath(args.cwd),
      args.sha,
      args.relative,
    );
  }
  if (command === "git_show_commit") {
    return nativeProfileGitShowCommit(
      sessionId,
      root,
      relativePath(args.cwd),
      args.sha,
    );
  }
  if (command === "git_tag_list") {
    return nativeProfileGitTagList(sessionId, root, relativePath(args.cwd));
  }
  if (command === "git_tag_create") {
    return nativeProfileGitTagCreate(
      sessionId,
      root,
      relativePath(args.cwd),
      args.name,
      args.targetSha,
      args.message,
    );
  }
  if (command === "git_tag_delete") {
    return nativeProfileGitTagDelete(
      sessionId,
      root,
      relativePath(args.cwd),
      args.name,
    );
  }
  if (command === "git_tag_push") {
    return nativeProfileGitTagPush(
      sessionId,
      root,
      relativePath(args.cwd),
      args.name,
      args.remote,
    );
  }
  if (command === "git_branch_from_commit") {
    return nativeProfileGitBranchFromCommit(
      sessionId,
      root,
      relativePath(args.repoRoot ?? args.cwd),
      args.name,
      args.sha,
    );
  }
  if (command === "git_cherry_pick_commit" || command === "git_revert_commit") {
    return nativeProfileGitApplyCommit(
      sessionId,
      root,
      relativePath(args.repoRoot ?? args.cwd),
      command === "git_revert_commit" ? "revert" : "cherry-pick",
      args.sha,
    );
  }
  if (command === "git_compare_branches") {
    return nativeProfileGitCompareBranches(
      sessionId,
      root,
      relativePath(args.repoRoot ?? args.cwd),
      args.base,
      args.compare,
    );
  }
  if (command === "git_operation_status") {
    return nativeProfileGitOperationStatus(
      sessionId,
      root,
      relativePath(args.repoRoot ?? args.cwd),
    );
  }
  if (
    command === "git_operation_abort" ||
    command === "git_operation_continue"
  ) {
    return nativeProfileGitOperationMutation(
      sessionId,
      root,
      relativePath(args.repoRoot ?? args.cwd),
      args.kind,
      command === "git_operation_abort" ? "--abort" : "--continue",
    );
  }
  if (command === "git_branches") {
    const cwd = relativePath(args.cwd);
    return nativeProfileGitBranches(sessionId, root, cwd);
  }
  if (command === "git_remote_url") {
    return nativeProfileGitRemoteUrl(
      sessionId,
      root,
      relativePath(args.cwd),
      args.name,
    );
  }
  if (command === "git_checkout") {
    return nativeProfileGitCheckout(
      sessionId,
      root,
      relativePath(args.cwd),
      args.name,
      args.remote,
    );
  }
  if (command === "git_create_branch") {
    return nativeProfileGitCreateBranch(
      sessionId,
      root,
      relativePath(args.cwd),
      args.name,
    );
  }
  if (command === "git_stash") {
    return nativeProfileGitStash(
      sessionId,
      root,
      relativePath(args.cwd),
      args.message,
    );
  }
  if (command === "git_stash_list") {
    return nativeProfileGitStashList(
      sessionId,
      root,
      relativePath(args.repoRoot ?? args.cwd),
    );
  }
  if (command === "git_stash_save") {
    return nativeProfileGitStash(
      sessionId,
      root,
      relativePath(args.repoRoot ?? args.cwd),
      args.message,
      args.includeUntracked,
    );
  }
  if (
    command === "git_stash_apply" ||
    command === "git_stash_pop" ||
    command === "git_stash_drop"
  ) {
    return nativeProfileGitStashMutation(
      sessionId,
      root,
      relativePath(args.repoRoot ?? args.cwd),
      command === "git_stash_apply"
        ? "apply"
        : command === "git_stash_pop"
          ? "pop"
          : "drop",
      args.index,
    );
  }
  if (command === "git_init") {
    const cwd = relativePath(args.cwd);
    const result = await runHelperGit(
      sessionId,
      cwd,
      ["init"],
      64 * 1024,
      true,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() || result.stdout.trim() || "git init failed.",
      );
    }
    return;
  }
  if (command === "git_patch") {
    const cwd = relativePath(args.cwd);
    await assertProfileGitRoot(sessionId, root, cwd);
    const relative =
      args.relative === undefined || args.relative === null
        ? undefined
        : helperRelativePath(args.relative);
    const result = await runHelperGit(
      sessionId,
      cwd,
      [
        "--literal-pathspecs",
        "diff",
        "--no-color",
        "--no-ext-diff",
        ...(args.staged === true ? ["--cached"] : []),
        "--",
        ...(relative ? [relative] : ["."]),
      ],
      MAX_GIT_OUTPUT_BYTES,
      true,
      true,
    );
    return { diffText: result.stdout, truncated: result.stdoutTruncated };
  }
  if (
    command === "git_range_context" ||
    command === "git_pr_status" ||
    command === "git_pr_create"
  ) {
    const cwd = relativePath(args.cwd);
    await assertProfileGitRoot(sessionId, root, cwd);
    const git: ProfileGit = async (gitArgs) => {
      const result = await runHelperGit(
        sessionId,
        cwd,
        gitArgs,
        MAX_GIT_OUTPUT_BYTES,
        true,
        true,
      );
      return { stdout: result.stdout, exitCode: result.exitCode };
    };
    if (command === "git_range_context") return profileRangeContext(git);
    if (command === "git_pr_status") {
      return profilePullRequestStatus(git, PROFILE_GITHUB);
    }
    return profileCreatePullRequest(git, PROFILE_GITHUB, {
      title: String(args.title ?? ""),
      body: String(args.body ?? ""),
      base: String(args.base ?? ""),
      head: String(args.head ?? ""),
    });
  }
  if (command === "git_staged_context") {
    return nativeProfileGitStagedContext(
      sessionId,
      root,
      relativePath(args.cwd),
    );
  }
  if (command === "git_commit" || command === "harness_git_commit") {
    const paths =
      args.paths === undefined || args.paths === null
        ? args.paths
        : Array.isArray(args.paths)
          ? args.paths.map(relativePath)
          : args.paths;
    return nativeProfileGitCommit(
      sessionId,
      root,
      relativePath(args.cwd),
      args.message,
      paths,
      command === "git_commit",
    );
  }
  if (
    command === "git_push" ||
    command === "harness_git_push" ||
    command === "git_fetch" ||
    command === "git_pull" ||
    command === "git_sync"
  ) {
    return nativeProfileGitNetworkCommand(
      sessionId,
      root,
      relativePath(args.cwd),
      command,
    );
  }
  if (
    command === "git_diff_index" ||
    command === "git_diff_files" ||
    command === "git_diff_stats" ||
    command === "git_file_diff"
  ) {
    const cwd = relativePath(args.cwd);
    if (command === "git_file_diff") {
      return nativeProfileFileDiff(
        sessionId,
        environmentId,
        root,
        cwd,
        supportsUntrackedLineCounts,
        args.relative,
        args.staged === true,
      );
    }
    const index = await nativeProfileGitIndex(
      sessionId,
      environmentId,
      root,
      cwd,
      supportsUntrackedLineCounts,
    );
    if (command === "git_diff_stats") {
      return {
        files: index.files.length,
        additions: index.additions,
        deletions: index.deletions,
      };
    }
    return index;
  }
  if (
    command === "git_stage_contents" ||
    command === "git_stage_file" ||
    command === "git_unstage_file" ||
    command === "git_discard_file" ||
    command === "git_discard_all" ||
    command === "git_stage_all" ||
    command === "git_unstage_all"
  ) {
    const cwd = relativePath(args.cwd);
    const runGitMutation = (gitArgs: string[]) =>
      runHelperGit(sessionId, cwd, gitArgs).then(() => undefined);
    if (command === "git_stage_contents") {
      return nativeProfileGitStageContents(
        sessionId,
        cwd,
        args.relative,
        requireString(args, "contents"),
      );
    }
    if (command === "git_stage_file") {
      return runGitMutation([
        "--literal-pathspecs",
        "add",
        "--",
        helperRelativePath(args.relative),
      ]);
    }
    if (command === "git_unstage_file") {
      return runGitMutation([
        "--literal-pathspecs",
        "restore",
        "--staged",
        "--",
        helperRelativePath(args.relative),
      ]);
    }
    if (command === "git_stage_all") {
      return runGitMutation(["--literal-pathspecs", "add", "-A", "--", "."]);
    }
    if (command === "git_unstage_all") {
      return runGitMutation([
        "--literal-pathspecs",
        "restore",
        "--staged",
        "--",
        ".",
      ]);
    }

    const status = await nativeProfileGitStatus(sessionId, cwd);
    if (command === "git_discard_file") {
      const relative = helperRelativePath(args.relative);
      const file = status?.files.find((entry) => entry.relative === relative);
      if (!file?.unstaged) throw new Error("File has no changes to discard.");
      return runGitMutation(
        file.status === "untracked"
          ? ["--literal-pathspecs", "clean", "-f", "--", file.relative]
          : [
              "--literal-pathspecs",
              "restore",
              "--worktree",
              "--",
              file.relative,
            ],
      );
    }
    if (!status?.files.some((file) => file.unstaged)) return;
    await runGitMutation([
      "--literal-pathspecs",
      "restore",
      "--worktree",
      "--",
      ".",
    ]);
    await runGitMutation(["--literal-pathspecs", "clean", "-fd", "--", "."]);
    return;
  }
  if (command === "list_dir") {
    const relative = relativePath(args.path);
    const entries = await helperListDirectory(sessionId, relative);
    return entries
      .map((entry) => ({
        name: entry.name,
        path: remoteResultPath(
          joinRemotePath(root, joinRelativePath(relative, entry.name)),
        ),
        isDir: entry.kind === "directory",
        ignored: entry.name === ".git",
      }))
      .sort(
        (left, right) =>
          Number(right.isDir) - Number(left.isDir) ||
          left.name
            .toLocaleLowerCase("en-US")
            .localeCompare(right.name.toLocaleLowerCase("en-US")),
      );
  }
  if (command === "search_project") {
    const options = args.options;
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new Error("The project search options are invalid.");
    }
    const searchOptions = options as Record<string, unknown>;
    const query = requireString(searchOptions, "query").trim();
    if (!query) return { matches: [], truncated: false };
    const result = await requestRemoteResult<{
      hits: Array<{
        rel: string;
        line: number;
        column: number;
        text: string;
      }>;
      truncated: boolean;
    }>(sessionId, "fs.grep", {
      pattern: query,
      cwd: relativePath(searchOptions.cwd),
      include: searchPatterns(searchOptions.include),
      exclude: searchPatterns(searchOptions.exclude),
      caseSensitive: searchOptions.caseSensitive === true,
      wholeWord: searchOptions.wholeWord === true,
      regex: searchOptions.regex === true,
      showHidden: true,
      maxResults: 500,
    });
    if (!result || !Array.isArray(result.hits)) {
      throw new Error("The remote helper returned an invalid search result.");
    }
    const matches = result.hits.map((hit) => {
      if (
        !hit ||
        typeof hit !== "object" ||
        typeof hit.text !== "string" ||
        !Number.isSafeInteger(hit.line) ||
        hit.line < 1 ||
        !Number.isSafeInteger(hit.column) ||
        hit.column < 1
      ) {
        throw new Error("The remote helper returned an invalid search match.");
      }
      const relative = helperRelativePath(hit.rel);
      return {
        path: remoteResultPath(joinRemotePath(root, relative)),
        relative,
        line: hit.line,
        column: hit.column,
        preview: hit.text,
      };
    });
    return { matches, truncated: result.truncated === true };
  }
  if (command === "read_text_file") {
    const result = await requestRemoteResult<{ content: string }>(
      sessionId,
      HELPER_FS.readFile,
      { path: relativePath(args.path) },
    );
    return result.content;
  }
  if (command === "read_binary_file") {
    const result = await requestRemoteResult<{ contentBase64: string }>(
      sessionId,
      HELPER_FS.readBinaryFile,
      { path: relativePath(args.path) },
    );
    return result.contentBase64;
  }
  if (command === "read_file_preview") {
    const requestedMaxLines = Number(args.maxLines);
    const maxLines = Math.min(
      12,
      Math.max(
        1,
        Number.isFinite(requestedMaxLines) && requestedMaxLines !== 0
          ? Math.floor(requestedMaxLines)
          : 6,
      ),
    );
    const requestedStartLine = Number(args.startLine);
    const startLine =
      Number.isSafeInteger(requestedStartLine) && requestedStartLine > 0
        ? requestedStartLine
        : 1;
    if (supportsFilePreview) {
      const result = await requestRemoteResult<unknown>(
        sessionId,
        HELPER_FS.readFilePreview,
        {
          path: relativePath(args.path),
          maxLines,
          startLine,
        },
      );
      const lines =
        result && typeof result === "object" && !Array.isArray(result)
          ? (result as { lines?: unknown }).lines
          : undefined;
      const encoder = new TextEncoder();
      if (
        !Array.isArray(lines) ||
        lines.length > maxLines ||
        lines.some(
          (line) =>
            typeof line !== "string" || encoder.encode(line).byteLength > 1024,
        )
      ) {
        throw new Error("The remote helper returned an invalid file preview.");
      }
      return lines;
    }
    const result = await requestRemoteResult<{ content: string }>(
      sessionId,
      HELPER_FS.readFile,
      { path: relativePath(args.path) },
    );
    if (result.content.includes("\0")) throw new Error("Binary file");
    const lines = result.content.split(/\r?\n/);
    if (result.content === "") lines.length = 0;
    else if (result.content.endsWith("\n")) lines.pop();
    return lines
      .slice(startLine - 1, startLine - 1 + maxLines)
      .map((line) =>
        line.length > 200 ? `${[...line].slice(0, 199).join("")}…` : line,
      );
  }
  if (command === "write_text_file") {
    const expectedContent = args.expectedContent;
    await requestRemoteResult(sessionId, HELPER_FS.writeFile, {
      path: relativePath(args.path),
      content: requireString(args, "content"),
      ...(typeof expectedContent === "string" ? { expectedContent } : {}),
    });
    return undefined;
  }
  if (command === "stat_files") {
    const paths = args.paths;
    if (!Array.isArray(paths))
      throw new Error("The remote command requires paths.");
    return Promise.all(
      paths.map(async (path) => {
        try {
          const stat = await helperStat(sessionId, relativePath(path));
          return {
            path,
            mtimeMs: stat.kind === "file" ? stat.mtime : null,
          };
        } catch {
          return { path, mtimeMs: null };
        }
      }),
    );
  }
  if (command === "create_path") {
    const parent = relativePath(args.parent);
    const target = joinRelativePath(
      parent,
      ...relativeNameParts(requireString(args, "name")),
    );
    const parentDirectory = target.includes("/")
      ? target.slice(0, target.lastIndexOf("/")) || "."
      : ".";
    await ensureRemoteDirectories(sessionId, parentDirectory);
    let result: { path: string };
    if (args.isDir === true) {
      result = await requestRemoteResult<{ path: string }>(
        sessionId,
        HELPER_FS.createDir,
        { path: target },
      );
    } else {
      result = await requestRemoteResult<{ path: string }>(
        sessionId,
        HELPER_FS.createFile,
        { path: target },
      );
    }
    return remoteResultPath(result.path);
  }
  if (command === "rename_path") {
    const source = relativePath(args.path);
    const sourceParent = source.includes("/")
      ? source.slice(0, source.lastIndexOf("/"))
      : ".";
    const target = joinRelativePath(
      sourceParent,
      ...relativeNameParts(requireString(args, "name")),
    );
    const targetParent = target.includes("/")
      ? target.slice(0, target.lastIndexOf("/"))
      : ".";
    await ensureRemoteDirectories(sessionId, targetParent);
    if (target === source)
      return remoteResultPath(joinRemotePath(root, source));
    const result = await requestRemoteResult<{ path: string }>(
      sessionId,
      HELPER_FS.rename,
      { from: source, to: target },
    );
    return remoteResultPath(result.path);
  }
  if (command === "delete_path") {
    await requestRemoteResult(sessionId, HELPER_FS.delete, {
      path: relativePath(args.path),
    });
    return undefined;
  }
  if (command === "copy_path") {
    const result = await requestRemoteResult<{ path: string }>(
      sessionId,
      HELPER_FS.copy,
      {
        from: relativePath(args.from),
        destParent: relativePath(args.destParent),
      },
    );
    return remoteResultPath(result.path);
  }
  if (command === "move_path") {
    const source = relativePath(args.from);
    const destinationParent = relativePath(args.destParent);
    const sourceParts = source.split("/").filter(Boolean);
    const name = sourceParts[sourceParts.length - 1];
    if (!name || source === ".")
      throw new Error("The workspace root cannot be moved.");
    const sourceParent = source.includes("/")
      ? source.slice(0, source.lastIndexOf("/"))
      : ".";
    if (destinationParent === sourceParent) {
      return remoteResultPath(joinRemotePath(root, source));
    }
    const result = await requestRemoteResult<{ path: string }>(
      sessionId,
      HELPER_FS.rename,
      { from: source, to: joinRelativePath(destinationParent, name) },
    );
    return remoteResultPath(result.path);
  }
  throw new Error(PROFILE_UNAVAILABLE);
}

async function runNativeProfileCommand(
  command: string,
  args: Record<string, unknown>,
  references: RemotePathReference[],
  environmentId: string,
): Promise<unknown> {
  if (!PROFILE_HELPER_COMMANDS.has(command))
    throw new Error(PROFILE_UNAVAILABLE);
  const savedConnections = usePreferencesStore.getState().sshConnections ?? [];
  const profile = findSshProfile(environmentId, savedConnections);
  if (!profile)
    throw new Error("The saved SSH connection for this project is missing.");
  const project = remoteProjectForPath(references[0].value);
  if (!project) throw new Error("This path is outside a saved remote project.");
  for (const reference of references) {
    const owner = remoteProjectForPath(reference.value);
    if (
      reference.environmentId !== environmentId ||
      !owner ||
      owner.key !== project.key
    ) {
      throw new Error(
        "Files can only be accessed within one saved remote project.",
      );
    }
    relativeToRemoteRoot(project.cwd, reference.hostPath);
  }
  const normalizedProjectRoot = normalizeRemoteAbsolute(project.cwd);
  if (normalizedProjectRoot === "/" && project.cwd !== "/") {
    throw new Error("The saved remote project root is invalid.");
  }
  if (command === "list_project_files") {
    return readCapturedProjectIndex(
      requireString(args, "cwd"),
      project,
      profile,
      () => true,
    );
  }
  return remoteSessions.use(
    { profileId: profile.id, root: normalizedProjectRoot },
    remoteSshConnectionForProfile(profile),
    async (session) => {
      const sessionRoot = normalizeRemoteAbsolute(session.workspace_root);
      if (sessionRoot !== normalizedProjectRoot) {
        throw new Error(
          "The native SSH helper did not open the saved project root.",
        );
      }
      if (
        command === "git_stage_contents" &&
        !session.capabilities.includes(HELPER_GIT_EXEC_WORKSPACE_INPUT)
      ) {
        throw new Error(
          "Update the Voktty remote helper to stage unsaved editor contents.",
        );
      }
      return runProfileFileCommand(
        command,
        args,
        environmentId,
        session.session_id,
        sessionRoot,
        session.capabilities.includes(HELPER_FS.countTextLines),
        session.capabilities.includes(HELPER_FS.readFilePreview),
        (value) => {
          if (typeof value !== "string") {
            throw new Error("The remote command is missing a project path.");
          }
          const parsed = parseRemotePath(value);
          if (!parsed || parsed.environmentId !== environmentId) {
            throw new Error(
              "Files can only be accessed within one remote project.",
            );
          }
          return relativeToRemoteRoot(sessionRoot, parsed.hostPath);
        },
      );
    },
  );
}

/** Runs a file command whose paths are `remote://` paths on the machine that
 * owns them, translating paths both ways so callers never see host paths. */
export async function runRemoteCommand(
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!HOST_COMMANDS.has(command) && !PROFILE_HELPER_COMMANDS.has(command)) {
    throw new Error(UNAVAILABLE);
  }
  const references = pathReferences(args);
  if (references.length === 0) throw new Error(UNAVAILABLE);
  const remoteEnvironmentId = references[0].environmentId;
  if (
    references.some(
      (reference) => reference.environmentId !== remoteEnvironmentId,
    )
  ) {
    throw new Error("Files can only be copied or moved within one machine.");
  }
  if (remoteEnvironmentId.startsWith("voktty-ssh-")) {
    return runNativeProfileCommand(
      command,
      args,
      references,
      remoteEnvironmentId,
    );
  }
  if (!HOST_COMMANDS.has(command)) throw new Error(UNAVAILABLE);

  let environmentId: string | undefined;
  const toHost = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(toHost);
    if (typeof value !== "string") return value;
    const parsed = parseRemotePath(value);
    if (!parsed || (environmentId && parsed.environmentId !== environmentId))
      throw new Error("Files can only be copied or moved within one machine.");
    environmentId = parsed.environmentId;
    return parsed.hostPath;
  };
  const hostArgs = Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      PATH_ARGS.includes(key)
        ? toHost(value)
        : key === "options" &&
            value &&
            typeof value === "object" &&
            !Array.isArray(value)
          ? { ...value, cwd: toHost((value as Record<string, unknown>).cwd) }
          : value,
    ]),
  );
  if (!environmentId) throw new Error(UNAVAILABLE);
  const env = environmentId;
  const machine = await remoteMachineFor(env);
  if (!machine)
    throw new Error("This project’s machine isn’t connected on this computer.");
  let result: unknown;
  try {
    result = await remoteRequest(machine.id, "workspace.run", {
      command,
      args: hostArgs,
    });
  } catch (reason) {
    if (/Unsupported (host method|remote operation)/i.test(String(reason)))
      throw new Error(OUTDATED);
    throw reason;
  }
  const fromHost = (path: string) => remotePath(env, path);
  if (PATH_RESULTS.has(command) && typeof result === "string")
    return fromHost(result);
  if (ENTRY_RESULTS.has(command) && Array.isArray(result))
    return result.map((entry: { path: string }) => ({
      ...entry,
      path: fromHost(entry.path),
    }));
  if (
    (command === "git_diff_index" || command === "git_diff_files") &&
    result &&
    typeof result === "object"
  ) {
    const index = result as { files: { path: string }[] };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return {
      ...index,
      files: index.files.map((file) => ({
        ...file,
        path: fromHost(`${root}/${file.path}`),
      })),
    };
  }
  if (command === "git_file_diff" && result && typeof result === "object") {
    const diff = result as { path: string };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return { ...diff, path: fromHost(`${root}/${diff.path}`) };
  }
  if (command === "git_commit_files" && Array.isArray(result)) {
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return result.map((file: { path: string }) => ({
      ...file,
      path: fromHost(`${root}/${file.path}`),
    }));
  }
  if (
    command === "git_commit_file_diff" &&
    result &&
    typeof result === "object"
  ) {
    const diff = result as { path: string };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return { ...diff, path: fromHost(`${root}/${diff.path}`) };
  }
  if (command === "search_project" && result && typeof result === "object") {
    const search = result as { matches: { path: string }[] };
    return {
      ...search,
      matches: search.matches.map((match) => ({
        ...match,
        path: fromHost(match.path),
      })),
    };
  }
  if (command === "git_worktrees" && result && typeof result === "object") {
    const worktrees = result as {
      defaultRoot: string;
      worktrees: { path: string }[];
    };
    return {
      ...worktrees,
      defaultRoot: fromHost(worktrees.defaultRoot),
      worktrees: worktrees.worktrees.map((tree) => ({
        ...tree,
        path: fromHost(tree.path),
      })),
    };
  }
  return result;
}

setRemoteCommandRunner(runRemoteCommand);
