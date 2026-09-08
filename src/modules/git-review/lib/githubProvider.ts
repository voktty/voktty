import { invoke } from "@tauri-apps/api/core";
import { KEYRING_SERVICE } from "@/lib/identity";

/**
 * Optional remote GitHub provider for git-review (Fase 4 of
 * PLAN_REVIEW_GITHUB_AGENTICO_CRITTER.md). Talks to the native Rust module
 * (`src-tauri/src/modules/git_review/github.rs`), which calls the GitHub
 * REST API directly over `ureq` — no `gh` CLI dependency. Every function
 * here degrades to a rejected promise with a human-readable message when
 * GitHub isn't connected or the network fails; callers fall back to
 * local-only review rather than surfacing raw errors.
 */

const GITHUB_ACCOUNT = "github-pat";

export type GithubPullRequest = {
  number: number;
  title: string;
  author: string;
  state: string;
  draft: boolean;
  baseRef: string;
  headRef: string;
  headSha: string;
  htmlUrl: string;
  updatedAt: string;
};

export type GithubPrDiff = {
  diff: string;
  truncated: boolean;
  headSha: string;
};

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export function getGithubToken(): Promise<string | null> {
  return invoke<string | null>("secrets_get", {
    service: KEYRING_SERVICE,
    account: GITHUB_ACCOUNT,
  }).catch(() => null);
}

export async function setGithubToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("GitHub token is empty");
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account: GITHUB_ACCOUNT,
    value: trimmed,
  });
}

export async function clearGithubToken(): Promise<void> {
  await invoke("secrets_delete", {
    service: KEYRING_SERVICE,
    account: GITHUB_ACCOUNT,
  });
}

export function isGithubConnected(): Promise<boolean> {
  return invoke<boolean>("git_review_github_is_connected").catch(() => false);
}

/** Best-effort: resolves to `null` for a non-GitHub remote or no remote at all. */
export function detectGithubRepo(cwd: string): Promise<string | null> {
  return invoke<string | null>("git_review_github_detect_repo", { cwd }).catch(
    () => null,
  );
}

export function listGithubPullRequests(
  ownerRepo: string,
): Promise<GithubPullRequest[]> {
  return invoke<GithubPullRequest[]>("git_review_github_list_prs", {
    ownerRepo,
  });
}

export function getGithubPrDiff(
  ownerRepo: string,
  number: number,
): Promise<GithubPrDiff> {
  return invoke<GithubPrDiff>("git_review_github_pr_diff", {
    ownerRepo,
    number,
  });
}

export function postGithubReviewComment(input: {
  ownerRepo: string;
  number: number;
  commitId: string;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
}): Promise<void> {
  return invoke("git_review_github_post_comment", { payload: input });
}

export function submitGithubReview(input: {
  ownerRepo: string;
  number: number;
  commitId: string;
  event: ReviewEvent;
  body?: string;
}): Promise<void> {
  return invoke("git_review_github_submit_review", input);
}
