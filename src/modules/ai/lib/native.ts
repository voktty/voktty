import { invoke } from "@tauri-apps/api/core";
import {
  isPathInRemoteWorkspace,
  remoteCanonicalize,
  remoteCreateDir,
  remoteCreateFile,
  remoteDelete,
  remoteReadDir,
  remoteReadFile,
  remoteStat,
  remoteWriteFile,
} from "@/modules/remote";
import {
  currentWorkspaceEnv,
  LOCAL_WORKSPACE,
  workspaceForNativeFs,
  type WorkspaceEnv,
} from "@/modules/workspace";

export type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type OperationPathInspection =
  | { kind: "file"; content: string }
  | { kind: "directory"; empty: boolean }
  | null;

export type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
  gitignored: boolean;
};

export type CommandOutput = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
};

export type GrepHit = {
  path: string;
  rel: string;
  line: number;
  text: string;
};

export type GrepResponse = {
  hits: GrepHit[];
  truncated: boolean;
  files_scanned: number;
};

export type GlobHit = { path: string; rel: string };
export type GlobResponse = { hits: GlobHit[]; truncated: boolean };

export type GitRepoInfo = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  isDetached: boolean;
};

export type GitChangedFile = {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  statusLabel: string;
};

export type GitStatusSnapshot = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isDetached: boolean;
  truncated: boolean;
  changedFiles: GitChangedFile[];
};

export type GitDiffResult = {
  diffText: string;
  truncated: boolean;
};

export type GitDiffContentResult = {
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
  fallbackPatch: string;
  truncated: boolean;
};

export type GitCommitResult = {
  commitSha: string;
  summary: string;
};

export type GitPushResult = {
  remote: string | null;
  branch: string | null;
  pushed: boolean;
};

export type GitLogEntry = {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  timestampSecs: number;
  parents: string[];
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export type GitCommitFileChange = {
  path: string;
  originalPath: string | null;
  status: string;
  statusLabel: string;
  added: number;
  removed: number;
  isBinary: boolean;
};

export type GitPanelSnapshot = {
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
};

export type GitDiscardEntry = {
  path: string;
  untracked: boolean;
};

export type GitBranchEntry = {
  name: string;
  kind: "local" | "worktree";
  worktreePath: string | null;
  isHead: boolean;
  isDetached: boolean;
};

export type GitBranchListResult = {
  branches: GitBranchEntry[];
};

function resolveGitWorkspace(
  repoRootOrPath?: string | null,
  explicitWorkspace?: WorkspaceEnv,
): WorkspaceEnv {
  if (explicitWorkspace) return explicitWorkspace;
  const current = currentWorkspaceEnv();
  // If the path is a local Windows path (e.g. starts with C:/ or C:\) or UNC path,
  // but current workspace is remote/docker/serial, fallback to local workspace.
  if (
    repoRootOrPath &&
    (repoRootOrPath.includes(":") ||
      repoRootOrPath.startsWith("\\\\") ||
      repoRootOrPath.startsWith("//"))
  ) {
    if (
      current.kind === "docker" ||
      current.kind === "ssh" ||
      current.kind === "serial"
    ) {
      return LOCAL_WORKSPACE;
    }
  }
  return current;
}

export const native = {
  workspaceCurrentDir: () => invoke<string>("workspace_current_dir"),
  workspaceAuthorize: (path: string) =>
    invoke<string>("workspace_authorize", {
      path,
      workspace: currentWorkspaceEnv(),
    }),
  readFile: (path: string) => {
    const workspace = currentWorkspaceEnv();
    if (isPathInRemoteWorkspace(workspace, path)) {
      return remoteReadFile(workspace, path).then(({ content, size }) => ({
        kind: "text" as const,
        content,
        size,
      }));
    }
    return invoke<ReadResult>("fs_read_file", {
      path,
      workspace: workspaceForNativeFs(workspace, path),
    });
  },
  writeFile: async (path: string, content: string) => {
    const workspace = currentWorkspaceEnv();
    if (isPathInRemoteWorkspace(workspace, path)) {
      await remoteWriteFile(workspace, path, content);
      return;
    }
    await invoke<void>("fs_write_file", {
      path,
      content,
      workspace: workspaceForNativeFs(workspace, path),
    });
  },
  canonicalize: (path: string) => {
    const workspace = currentWorkspaceEnv();
    return isPathInRemoteWorkspace(workspace, path)
      ? remoteCanonicalize(workspace, path)
      : invoke<string>("fs_canonicalize", {
          path,
          workspace: workspaceForNativeFs(workspace, path),
        });
  },
  createFile: async (path: string) => {
    const workspace = currentWorkspaceEnv();
    if (isPathInRemoteWorkspace(workspace, path)) {
      await remoteCreateFile(workspace, path);
      return;
    }
    await invoke<void>("fs_create_file", {
      path,
      workspace: workspaceForNativeFs(workspace, path),
    });
  },
  createDir: async (path: string) => {
    const workspace = currentWorkspaceEnv();
    if (isPathInRemoteWorkspace(workspace, path)) {
      await remoteCreateDir(workspace, path);
      return;
    }
    await invoke<void>("fs_create_dir", {
      path,
      workspace: workspaceForNativeFs(workspace, path),
    });
  },
  operationInspect: async (path: string): Promise<OperationPathInspection> => {
    const workspace = currentWorkspaceEnv();
    if (isPathInRemoteWorkspace(workspace, path)) {
      try {
        const stat = await remoteStat(workspace, path);
        if (stat.kind === "dir") {
          const entries = await remoteReadDir(workspace, path);
          return { kind: "directory", empty: entries.length === 0 };
        }
        if (stat.size > 4 * 1024 * 1024) {
          throw new Error("operation target exceeds the 4 MiB limit");
        }
        const file = await remoteReadFile(workspace, path);
        return { kind: "file", content: file.content };
      } catch (error) {
        const message = String(error).toLowerCase();
        if (message.includes("not found") || message.includes("no such file"))
          return null;
        throw error;
      }
    }
    return invoke<OperationPathInspection>("fs_inspect_operation_path", {
      path,
      workspace: workspaceForNativeFs(workspace, path),
    });
  },
  operationWriteFile: async (
    path: string,
    content: string,
    expectedContent: string | null,
  ) => {
    const workspace = currentWorkspaceEnv();
    if (isPathInRemoteWorkspace(workspace, path)) {
      try {
        const current = await remoteReadFile(workspace, path);
        if (expectedContent === null || current.content !== expectedContent) {
          throw new Error("operation target changed before write");
        }
      } catch (error) {
        const message = String(error).toLowerCase();
        const missing =
          message.includes("not found") || message.includes("no such file");
        if (!missing || expectedContent !== null) throw error;
      }
      await remoteWriteFile(workspace, path, content);
      return;
    }
    await invoke<void>("fs_write_operation_file", {
      path,
      content,
      expectedContent,
      workspace: workspaceForNativeFs(workspace, path),
    });
  },
  operationRemoveFile: async (path: string, expectedContent: string) => {
    const workspace = currentWorkspaceEnv();
    if (isPathInRemoteWorkspace(workspace, path)) {
      const current = await remoteReadFile(workspace, path);
      if (current.content !== expectedContent) {
        throw new Error("operation target changed before removal");
      }
      await remoteDelete(workspace, path);
      return;
    }
    await invoke<void>("fs_remove_operation_file", {
      path,
      expectedContent,
      workspace: workspaceForNativeFs(workspace, path),
    });
  },
  operationRemoveEmptyDirectory: async (path: string) => {
    const workspace = currentWorkspaceEnv();
    if (isPathInRemoteWorkspace(workspace, path)) {
      const entries = await remoteReadDir(workspace, path);
      if (entries.length > 0)
        throw new Error("operation directory is not empty");
      await remoteDelete(workspace, path);
      return;
    }
    await invoke<void>("fs_remove_empty_operation_directory", {
      path,
      workspace: workspaceForNativeFs(workspace, path),
    });
  },
  // AI tooling never sees dot-prefixed entries regardless of the user's
  // explorer preference — keeps .git / .env / .ssh out of agent context.
  readDir: (path: string) => {
    const workspace = currentWorkspaceEnv();
    if (isPathInRemoteWorkspace(workspace, path)) {
      return remoteReadDir(workspace, path).then((entries) =>
        entries
          .filter((entry) => !entry.name.startsWith("."))
          .map((entry) => ({ ...entry, gitignored: false })),
      );
    }
    return invoke<DirEntry[]>("fs_read_dir", {
      path,
      showHidden: false,
      workspace: workspaceForNativeFs(workspace, path),
    });
  },
  grep: (params: {
    pattern: string;
    root: string;
    glob?: string[];
    caseInsensitive?: boolean;
    maxResults?: number;
  }) =>
    invoke<GrepResponse>("fs_grep", {
      pattern: params.pattern,
      root: params.root,
      glob: params.glob ?? null,
      caseInsensitive: params.caseInsensitive ?? null,
      maxResults: params.maxResults ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  glob: (params: { pattern: string; root: string; maxResults?: number }) =>
    invoke<GlobResponse>("fs_glob", {
      pattern: params.pattern,
      root: params.root,
      maxResults: params.maxResults ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  runCommand: (
    command: string,
    cwd?: string | null,
    timeoutSecs?: number,
  ) =>
    invoke<CommandOutput>("shell_run_command", {
      command,
      cwd: cwd ?? null,
      timeoutSecs: timeoutSecs ?? null,
      workspace: currentWorkspaceEnv(),
    }),

  shellSessionOpen: (cwd?: string | null) =>
    invoke<number>("shell_session_open", {
      cwd: cwd ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  shellSessionRun: (
    id: number,
    command: string,
    cwd?: string | null,
    timeoutSecs?: number,
  ) =>
    invoke<{
      stdout: string;
      stderr: string;
      exit_code: number | null;
      timed_out: boolean;
      truncated: boolean;
      cwd_after: string;
    }>("shell_session_run", {
      id,
      command,
      cwd: cwd ?? null,
      timeoutSecs: timeoutSecs ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  shellSessionClose: (id: number) =>
    invoke<void>("shell_session_close", { id }),
  shellBgSpawn: (command: string, cwd?: string | null) =>
    invoke<number>("shell_bg_spawn", {
      command,
      cwd: cwd ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  shellBgLogs: (handle: number, sinceOffset?: number) =>
    invoke<{
      bytes: string;
      next_offset: number;
      dropped: number;
      exited: boolean;
      exit_code: number | null;
    }>("shell_bg_logs", { handle, sinceOffset: sinceOffset ?? null }),
  shellBgKill: (handle: number) => invoke<void>("shell_bg_kill", { handle }),
  shellBgList: () =>
    invoke<
      {
        handle: number;
        command: string;
        cwd: string | null;
        started_at_ms: number;
        exited: boolean;
        exit_code: number | null;
      }[]
    >("shell_bg_list"),
  dapStart: (adapterCommand: string, cwd?: string | null) =>
    invoke<number>("dap_start", {
      adapterCommand,
      cwd: cwd ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  dapSend: (sessionId: number, message: Record<string, unknown>) =>
    invoke<void>("dap_send", { sessionId, message }),
  dapPoll: (sessionId: number) =>
    invoke<{
      messages: Record<string, unknown>[];
      stderr: string;
      exited: boolean;
      exit_code: number | null;
      error: string | null;
    }>("dap_poll", { sessionId }),
  dapStop: (sessionId: number) => invoke<void>("dap_stop", { sessionId }),
  gitResolveRepo: (cwd: string, workspace?: WorkspaceEnv) =>
    invoke<GitRepoInfo | null>("git_resolve_repo", {
      cwd,
      workspace: resolveGitWorkspace(cwd, workspace),
    }),
  gitPanelSnapshot: (cwd: string, workspace?: WorkspaceEnv) =>
    invoke<GitPanelSnapshot>("git_panel_snapshot", {
      cwd,
      workspace: resolveGitWorkspace(cwd, workspace),
    }),
  gitStatus: (repoRoot: string, workspace?: WorkspaceEnv) =>
    invoke<GitStatusSnapshot>("git_status", {
      repoRoot,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitDiff: (
    repoRoot: string,
    path: string | null,
    staged: boolean,
    workspace?: WorkspaceEnv,
  ) =>
    invoke<GitDiffResult>("git_diff", {
      repoRoot,
      path,
      staged,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitDiffContent: (
    repoRoot: string,
    path: string,
    staged: boolean,
    originalPath?: string | null,
    workspace?: WorkspaceEnv,
  ) =>
    invoke<GitDiffContentResult>("git_diff_content", {
      repoRoot,
      path,
      staged,
      originalPath: originalPath ?? null,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitStage: (repoRoot: string, paths: string[], workspace?: WorkspaceEnv) =>
    invoke<void>("git_stage", {
      repoRoot,
      paths,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitUnstage: (repoRoot: string, paths: string[], workspace?: WorkspaceEnv) =>
    invoke<void>("git_unstage", {
      repoRoot,
      paths,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitDiscard: (
    repoRoot: string,
    entries: GitDiscardEntry[],
    workspace?: WorkspaceEnv,
  ) =>
    invoke<void>("git_discard", {
      repoRoot,
      entries,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitCommit: (
    repoRoot: string,
    message: string,
    workspace?: WorkspaceEnv,
  ) =>
    invoke<GitCommitResult>("git_commit", {
      repoRoot,
      message,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitFetch: (repoRoot: string, workspace?: WorkspaceEnv) =>
    invoke<void>("git_fetch", {
      repoRoot,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitPullFfOnly: (repoRoot: string, workspace?: WorkspaceEnv) =>
    invoke<void>("git_pull_ff_only", {
      repoRoot,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitPush: (repoRoot: string, workspace?: WorkspaceEnv) =>
    invoke<GitPushResult>("git_push", {
      repoRoot,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitLog: (
    repoRoot: string,
    options?: { limit?: number; beforeSha?: string; workspace?: WorkspaceEnv },
  ) =>
    invoke<GitLogEntry[]>("git_log", {
      repoRoot,
      limit: options?.limit ?? null,
      beforeSha: options?.beforeSha ?? null,
      workspace: resolveGitWorkspace(repoRoot, options?.workspace),
    }),
  gitShowCommit: (repoRoot: string, sha: string, workspace?: WorkspaceEnv) =>
    invoke<GitDiffResult>("git_show_commit", {
      repoRoot,
      sha,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitCommitFiles: (repoRoot: string, sha: string, workspace?: WorkspaceEnv) =>
    invoke<GitCommitFileChange[]>("git_commit_files", {
      repoRoot,
      sha,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitCommitFileDiff: (
    repoRoot: string,
    sha: string,
    path: string,
    originalPath?: string | null,
    workspace?: WorkspaceEnv,
  ) =>
    invoke<GitDiffContentResult>("git_commit_file_diff", {
      repoRoot,
      sha,
      path,
      originalPath: originalPath ?? null,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitRemoteUrl: (
    repoRoot: string,
    name?: string,
    workspace?: WorkspaceEnv,
  ) =>
    invoke<string | null>("git_remote_url", {
      repoRoot,
      name: name ?? null,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitListBranches: (repoRoot: string, workspace?: WorkspaceEnv) =>
    invoke<GitBranchListResult>("git_list_branches", {
      repoRoot,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitCheckoutBranch: (
    repoRoot: string,
    branch: string,
    workspace?: WorkspaceEnv,
  ) =>
    invoke<void>("git_checkout_branch", {
      repoRoot,
      branch,
      workspace: resolveGitWorkspace(repoRoot, workspace),
    }),
  gitAddSafeDirectory: (path: string, workspace?: WorkspaceEnv) =>
    invoke<void>("git_add_safe_directory", {
      path,
      workspace: resolveGitWorkspace(path, workspace),
    }),
  gitInit: (cwd: string, workspace?: WorkspaceEnv) =>
    invoke<void>("git_init", {
      cwd,
      workspace: resolveGitWorkspace(cwd, workspace),
    }),
};
