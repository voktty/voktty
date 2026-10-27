import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type RemoteCommandRunner = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

let remoteRunner: RemoteCommandRunner | undefined;
let remoteRunnerLoad: Promise<RemoteCommandRunner> | undefined;

export function setRemoteCommandRunner(runner: RemoteCommandRunner) {
  remoteRunner = runner;
}

export class RemoteRunnerUnavailableError extends Error {
  readonly code = "remote-runner-unavailable";
  readonly cause?: unknown;
  constructor(cause?: unknown) {
    super(
      "Remote file commands are unavailable: the remote command module could not be loaded.",
    );
    this.name = "RemoteRunnerUnavailableError";
    this.cause = cause;
  }
}

/** The runner registers itself when its module loads. Loading it on the first
 * remote request keeps it out of the eager bundle without depending on
 * another surface (such as Settings) having been opened first. */
async function resolveRemoteRunner(): Promise<RemoteCommandRunner> {
  if (remoteRunner) return remoteRunner;
  remoteRunnerLoad ??= import("@/modules/connections/model/remoteCommands")
    .then(() => {
      if (!remoteRunner) throw new RemoteRunnerUnavailableError();
      return remoteRunner;
    })
    .catch((reason: unknown) => {
      remoteRunnerLoad = undefined;
      throw reason instanceof RemoteRunnerUnavailableError
        ? reason
        : new RemoteRunnerUnavailableError(reason);
    });
  return remoteRunnerLoad;
}

const isRemotePath = (value: unknown): boolean =>
  typeof value === "string"
    ? value.replace(/\\/g, "/").startsWith("remote://")
    : Array.isArray(value) && value.some(isRemotePath);

const PATH_ARGS = ["path", "cwd", "parent", "from", "destParent", "paths"];

/** An action that only exists on this computer was asked for a remote path. */
export class RemoteActionUnavailableError extends Error {
  readonly code = "remote-action-unavailable";
  constructor(action: string) {
    super(`${action} is not available for remote projects.`);
    this.name = "RemoteActionUnavailableError";
  }
}

function requireLocalPath(action: string, path: string): void {
  if (isRemotePath(path)) throw new RemoteActionUnavailableError(action);
}

/** Runs a command on the machine that owns its paths, so the same file and
 * Git UI works for a local project and one on a connected machine. */
export function invokeWorkspace<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const options = args?.options;
  const remoteOptions =
    options && typeof options === "object" && !Array.isArray(options)
      ? isRemotePath((options as Record<string, unknown>).cwd)
      : false;
  if (args && (PATH_ARGS.some((key) => isRemotePath(args[key])) || remoteOptions)) {
    if (remoteRunner) return remoteRunner(command, args) as Promise<T>;
    return resolveRemoteRunner().then(
      (runner) => runner(command, args) as Promise<T>,
    );
  }
  return invoke<T>(command, args);
}

export type FsEntry = {
  name: string;
  path: string;
  isDir: boolean;
  ignored: boolean;
};

export type ExternalEditor = {
  id: string;
  name: string;
};

export function listExternalEditors(): Promise<ExternalEditor[]> {
  return invoke<ExternalEditor[]>("list_external_editors");
}

export async function openInExternalEditor(
  editorId: string,
  cwd: string,
): Promise<void> {
  requireLocalPath("Opening in an external editor", cwd);
  return invoke<void>("open_in_external_editor", { editorId, cwd });
}

export type ProjectFile = {
  name: string;
  path: string;
  relative: string;
  isDir?: boolean;
};

export function listDir(path: string): Promise<FsEntry[]> {
  return invokeWorkspace<FsEntry[]>("list_dir", { path });
}

export type DiscoveredSkill = {
  name: string;
  description: string;
  path: string;
  scope: "project" | "user" | "builtin";
  source:
    | "agents"
    | "claude"
    | "cursor"
    | "codex"
    | "opencode"
    | "pi"
    | "omp"
    | "fx"
    | "grok"
    | "hermes"
    | "monocode";
};

export function listSkills(cwd: string): Promise<DiscoveredSkill[]> {
  return invoke<DiscoveredSkill[]>("list_skills", { cwd });
}

export function listProjectFiles(cwd: string): Promise<ProjectFile[]> {
  return invokeWorkspace<ProjectFile[]>("list_project_files", { cwd });
}

export type GitDiffStats = {
  files: number;
  additions: number;
  deletions: number;
};

export function gitDiffStats(cwd: string): Promise<GitDiffStats> {
  return invokeWorkspace<GitDiffStats>("git_diff_stats", { cwd });
}

export type GitChangedFile = {
  path: string;
  relative: string;
  status: "modified" | "added" | "deleted" | "untracked" | string;
  additions: number;
  deletions: number;
  staged: boolean;
  unstaged: boolean;
};

export type GitDiffIndex = {
  branch: string | null;
  files: GitChangedFile[];
  additions: number;
  deletions: number;
  remote: string | null;
  upstream: string | null;
  defaultBranch: string | null;
  ahead: number;
  behind: number;
  aheadOfDefault: number;
};

export function gitDiffIndex(cwd: string): Promise<GitDiffIndex> {
  return invokeWorkspace<GitDiffIndex>("git_diff_index", { cwd });
}

export type GitFileDiffKind = "staged" | "unstaged";

export type GitFileDiff = {
  path: string;
  relative: string;
  status: string;
  original: string;
  current: string;
  binary: boolean;
  tooLarge: boolean;
};

export function gitFileDiff(
  cwd: string,
  relative: string,
  staged?: boolean,
): Promise<GitFileDiff> {
  return invokeWorkspace<GitFileDiff>("git_file_diff", {
    cwd,
    relative,
    staged: staged ?? false,
  });
}

export function gitStageContents(
  cwd: string,
  relative: string,
  contents: string,
): Promise<void> {
  return invokeWorkspace<void>("git_stage_contents", { cwd, relative, contents });
}

export function gitStageFile(cwd: string, relative: string): Promise<void> {
  return invokeWorkspace<void>("git_stage_file", { cwd, relative });
}

export function gitUnstageFile(cwd: string, relative: string): Promise<void> {
  return invokeWorkspace<void>("git_unstage_file", { cwd, relative });
}

export function gitDiscardFile(cwd: string, relative: string): Promise<void> {
  return invokeWorkspace<void>("git_discard_file", { cwd, relative });
}

export function gitStageAll(cwd: string): Promise<void> {
  return invokeWorkspace<void>("git_stage_all", { cwd });
}

export function gitUnstageAll(cwd: string): Promise<void> {
  return invokeWorkspace<void>("git_unstage_all", { cwd });
}

export function gitCommit(cwd: string, message: string): Promise<void> {
  return invokeWorkspace<void>("harness_git_commit", { cwd, message });
}

export type GitStagedContext = {
  branch: string | null;
  summary: string;
  patch: string;
};

export function gitStagedContext(cwd: string): Promise<GitStagedContext> {
  return invokeWorkspace<GitStagedContext>("git_staged_context", { cwd });
}

export function gitPush(cwd: string): Promise<void> {
  return invokeWorkspace<void>("harness_git_push", { cwd });
}

export function gitPull(cwd: string): Promise<void> {
  return invokeWorkspace<void>("git_pull", { cwd });
}

export function gitSync(cwd: string): Promise<void> {
  return invokeWorkspace<void>("git_sync", { cwd });
}

export type GitRangeContext = {
  base: string;
  head: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
};

export function gitRangeContext(cwd: string): Promise<GitRangeContext> {
  return invokeWorkspace<GitRangeContext>("git_range_context", { cwd });
}

export type GitPr = {
  number: number;
  title: string;
  url: string;
  state: string;
};

export function gitPrStatus(cwd: string): Promise<GitPr | null> {
  return invokeWorkspace<GitPr | null>("git_pr_status", { cwd });
}

export function gitPrCreate(
  cwd: string,
  title: string,
  body: string,
  base: string,
  head: string,
): Promise<string> {
  return invokeWorkspace<string>("git_pr_create", { cwd, title, body, base, head });
}

export type GitBranchInfo = {
  name: string;
  current: boolean;
  remote: string | null;
};

export type GitBranches = {
  current: string | null;
  detached: boolean;
  branches: GitBranchInfo[];
};

export function gitBranches(cwd: string): Promise<GitBranches> {
  return invokeWorkspace<GitBranches>("git_branches", { cwd });
}

export function gitCheckout(
  cwd: string,
  name: string,
  remote?: string | null,
): Promise<string> {
  return invokeWorkspace<string>("git_checkout", { cwd, name, remote: remote ?? null });
}

export function gitCreateBranch(cwd: string, name: string): Promise<string> {
  return invokeWorkspace<string>("git_create_branch", { cwd, name });
}

export function gitStash(cwd: string, message?: string): Promise<void> {
  return invokeWorkspace<void>("git_stash", { cwd, message: message ?? null });
}

/** Git refused a checkout because the working tree would be overwritten. */
export function isCheckoutBlockedByChanges(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("would be overwritten") ||
    text.includes("commit your changes or stash") ||
    text.includes("please move or remove them before")
  );
}

/** Drop leftover session-worktree pins. The composer now switches this folder. */
export function restoreSessionCheckout<
  T extends { cwd: string; branch?: string; worktreeCwd?: string; providerSessionId?: string },
>(session: T): T {
  if (!session.branch && !session.worktreeCwd) return session;
  return {
    ...session,
    branch: undefined,
    worktreeCwd: undefined,
    ...(session.worktreeCwd ? { providerSessionId: undefined } : {}),
  };
}

const GIT_CHANGED = "monocode-git-changed";

/** Tell git UIs (diff pane, branch picker) to reload after a local git mutation. */
export function notifyGitChanged() {
  window.dispatchEvent(new Event(GIT_CHANGED));
  window.dispatchEvent(new CustomEvent("voktty:git-refresh"));
}

export function subscribeGitChanged(listener: () => void): () => void {
  window.addEventListener(GIT_CHANGED, listener);
  return () => window.removeEventListener(GIT_CHANGED, listener);
}

export function createPath(
  parent: string,
  name: string,
  isDir: boolean,
): Promise<string> {
  return invokeWorkspace<string>("create_path", { parent, name, isDir });
}

export function renamePath(path: string, name: string): Promise<string> {
  return invokeWorkspace<string>("rename_path", { path, name });
}

export function deletePath(path: string): Promise<void> {
  return invokeWorkspace<void>("delete_path", { path });
}

export function copyPath(from: string, destParent: string): Promise<string> {
  return invokeWorkspace<string>("copy_path", { from, destParent });
}

export function movePath(from: string, destParent: string): Promise<string> {
  return invokeWorkspace<string>("move_path", { from, destParent });
}

export async function revealPath(path: string): Promise<void> {
  requireLocalPath("Revealing in the file manager", path);
  return invoke<void>("reveal_path", { path });
}

/** macOS only. Other platforms return an empty list. */
export function clipboardFilePaths(): Promise<string[]> {
  return invoke<string[]>("clipboard_file_paths").then((paths) =>
    paths.map((p) => p.replace(/\\/g, "/")),
  );
}

/** Put the original file on the macOS clipboard, preserving its name and type. */
export async function copyFileToClipboard(path: string): Promise<void> {
  requireLocalPath("Copying a file to the clipboard", path);
  return invoke<void>("copy_file_to_clipboard", { path });
}

export function homeDir(): Promise<string> {
  return invoke<string>("home_dir");
}

export async function pickFolder(title = "Open project"): Promise<string | null> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title,
    });
    if (typeof selected === "string" && selected) return selected;
  } catch {
    // Fallback to Voktty native rust folder picker
  }
  try {
    const fallback = await invoke<string | null>("fs_pick_folder", {});
    return fallback || null;
  } catch {
    return null;
  }
}

export async function pickFiles(
  title = "Attach files",
  assertCurrent: () => void = () => {},
): Promise<string[] | null> {
  assertCurrent();
  try {
    const selected = await open({
      multiple: true,
      directory: false,
      title,
    });
    assertCurrent();
    if (Array.isArray(selected)) {
      const paths = selected.filter((path): path is string => Boolean(path));
      if (paths.length > 0) return paths;
    }
    if (typeof selected === "string" && selected) return [selected];
  } catch {
    // Fallback to Voktty native rust file picker
  }
  assertCurrent();
  try {
    const fallback = await invoke<string | null>("fs_pick_file", {});
    assertCurrent();
    return fallback ? [fallback] : null;
  } catch {
    assertCurrent();
    return null;
  }
}

export async function cloneRepo(url: string, parent: string): Promise<string> {
  requireLocalPath("Cloning into a remote folder", parent);
  return invoke<string>("clone_repo", { url, parent });
}

export function readFilePreview(
  path: string,
  maxLines = 6,
  startLine?: number,
): Promise<string[]> {
  return invokeWorkspace<string[]>("read_file_preview", {
    path,
    maxLines,
    startLine,
  });
}

export type FileMtime = {
  path: string;
  mtimeMs: number | null;
};

export function statFiles(paths: string[]): Promise<FileMtime[]> {
  if (paths.length === 0) return Promise.resolve([]);
  return invokeWorkspace<FileMtime[]>("stat_files", { paths });
}

export function readTextFile(path: string): Promise<string> {
  return invokeWorkspace<string>("read_text_file", { path });
}

/** Raw bytes for the image viewer. Arrives as an ArrayBuffer or base64 string from remote. */
export async function readBinaryFile(path: string): Promise<Uint8Array> {
  const buffer = await invokeWorkspace<ArrayBuffer | string>("read_binary_file", { path });
  return typeof buffer === "string"
    ? Uint8Array.from(atob(buffer), (char) => char.charCodeAt(0))
    : new Uint8Array(buffer);
}

export function writeTextFile(
  path: string,
  content: string,
  expectedContent?: string,
): Promise<void> {
  return invokeWorkspace<void>("write_text_file", {
    path,
    content,
    ...(expectedContent === undefined ? {} : { expectedContent }),
  });
}

/** Last path segment, or `/` for the filesystem root. */
export function basename(path: string): string {
  const trimmed = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

export type GeneratedImageAsset = {
  path: string;
  mimeType: string;
  size: number;
};

export function saveGeneratedImage(input: {
  data: string;
  name: string;
}): Promise<GeneratedImageAsset> {
  return invoke<GeneratedImageAsset>("save_generated_image", input);
}

export function deleteGeneratedImages(paths: string[]): Promise<void> {
  return invoke<void>("delete_generated_images", { paths });
}
