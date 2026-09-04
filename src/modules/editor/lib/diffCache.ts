import { type GitDiffContentResult, native } from "@/modules/ai/lib/native";
import {
  currentWorkspaceScopeKey,
  workspaceScopeKey,
  type WorkspaceEnv,
} from "@/modules/workspace";

const DIFF_CACHE_LIMIT = 6;
const inflight = new Map<string, Promise<GitDiffContentResult>>();
const cache = new Map<string, GitDiffContentResult>();

function touch(key: string, value: GitDiffContentResult) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > DIFF_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function getCachedDiff(key: string): GitDiffContentResult | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

export function invalidateDiff(key: string): void {
  cache.delete(key);
}

export function invalidateRepoDiffs(
  repoRoot: string,
  workspaceEnv?: WorkspaceEnv,
): void {
  const scopeKey = workspaceEnv
    ? workspaceScopeKey(workspaceEnv)
    : currentWorkspaceScopeKey();
  const prefix = `${scopeKey}|${repoRoot}|`;
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

export function workingDiffKey(
  repoRoot: string,
  path: string,
  mode: "-" | "+",
  workspaceEnv?: WorkspaceEnv,
): string {
  const scopeKey = workspaceEnv
    ? workspaceScopeKey(workspaceEnv)
    : currentWorkspaceScopeKey();
  return `${scopeKey}|${repoRoot}|w|${mode}|${path}`;
}

export function commitDiffKey(
  repoRoot: string,
  sha: string,
  path: string,
  workspaceEnv?: WorkspaceEnv,
): string {
  const scopeKey = workspaceEnv
    ? workspaceScopeKey(workspaceEnv)
    : currentWorkspaceScopeKey();
  return `${scopeKey}|${repoRoot}|c|${sha}|${path}`;
}

export async function fetchWorkingDiff(
  repoRoot: string,
  path: string,
  mode: "-" | "+",
  originalPath: string | null,
  workspaceEnv?: WorkspaceEnv,
): Promise<GitDiffContentResult> {
  const key = workingDiffKey(repoRoot, path, mode, workspaceEnv);
  const cached = getCachedDiff(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = native
    .gitDiffContent(repoRoot, path, mode === "+", originalPath, workspaceEnv)
    .then((res) => {
      touch(key, res);
      return res;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

export async function fetchCommitDiff(
  repoRoot: string,
  sha: string,
  path: string,
  originalPath: string | null,
  workspaceEnv?: WorkspaceEnv,
): Promise<GitDiffContentResult> {
  const key = commitDiffKey(repoRoot, sha, path, workspaceEnv);
  const cached = getCachedDiff(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = native
    .gitCommitFileDiff(repoRoot, sha, path, originalPath, workspaceEnv)
    .then((res) => {
      touch(key, res);
      return res;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}
