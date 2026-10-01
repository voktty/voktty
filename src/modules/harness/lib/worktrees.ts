import { invoke } from "@tauri-apps/api/core";
import { isEqualOrInside } from "./paths";
import type { Session } from "./session";

export type Worktree = {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  locked: boolean;
  prunable: boolean;
  missing: boolean;
  dirty: boolean | null;
  unpushed: number | null;
  sessionIds: string[];
};

export type Worktrees = { worktrees: Worktree[]; defaultRoot: string };

export async function listWorktrees(cwd: string): Promise<Worktrees> {
  try {
    const result = await invoke<Worktrees>("git_worktrees", { cwd });
    return result || { worktrees: [], defaultRoot: cwd };
  } catch {
    return { worktrees: [], defaultRoot: cwd };
  }
}

export async function createWorktree(
  cwd: string,
  branch: string,
  base: string,
  existing: boolean,
): Promise<Worktree> {
  return invoke<Worktree>("git_worktree_create", {
    cwd,
    branch,
    base,
    existing,
  });
}

export function temporaryWorktreeBranchName(
  id: string = crypto.randomUUID(),
): string {
  const token = id
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toLowerCase();
  return `mc/${token || Date.now().toString(36)}`;
}

export function namedWorktreeBranch(fragment: string): string | null {
  const clean = fragment
    .trim()
    .replace(/^(?:mc|monocode)\/+/, "")
    .replace(/^\/+|\/+$/g, "");
  return clean ? `mc/${clean}` : null;
}

export async function removeWorktree(
  cwd: string,
  path: string,
  force = false,
  keepSessions = false,
): Promise<{ sessionIds: string[]; projectCwd: string }> {
  return invoke<{ sessionIds: string[]; projectCwd: string }>(
    "git_worktree_remove",
    { cwd, path, force, keepSessions },
  );
}

export function worktreeSessionIds(
  tree: Worktree,
  sessions: readonly Pick<Session, "id" | "cwd" | "worktreeCwd">[],
): string[] {
  const ids = new Set(tree.sessionIds);
  for (const session of sessions) {
    ids.delete(session.id);
    if (isEqualOrInside(session.worktreeCwd || session.cwd, tree.path)) {
      ids.add(session.id);
    }
  }
  return [...ids];
}
