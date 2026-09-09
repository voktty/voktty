import type { WorkspaceEnv } from "@/modules/workspace";

export type GitWorkbenchSection =
  | "history"
  | "branches"
  | "worktrees"
  | "tags-stashes"
  | "remotes"
  | "compare"
  | "pulls";

export type CommitFileDiffOpenInput = {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
  workspaceEnv?: WorkspaceEnv;
  split?: boolean;
};

export type CommitDiffOpenInput = {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  workspaceEnv?: WorkspaceEnv;
  split?: boolean;
};

export type GitHistorySearchHandle = {
  setQuery: (query: string) => void;
  clearQuery: () => void;
};

export type GitBranchScope = "all" | "current";
