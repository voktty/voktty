import { githubOwnerRepoFromRemote } from "@/modules/harness/lib/githubRemote";

export type ProfileGitResult = { stdout: string; exitCode: number | null };

/** Runs one Git command in the project repository; a non-zero exit is data. */
export type ProfileGit = (args: string[]) => Promise<ProfileGitResult>;

export type ProfileRangeContext = {
  base: string;
  head: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
};

export type ProfilePullRequest = {
  number: number;
  title: string;
  url: string;
  state: string;
};

export type GithubBranchStatus = {
  pullRequest: {
    number: number;
    title: string;
    htmlUrl: string;
    state: string;
  } | null;
};

export type ProfileGithub = {
  branchStatus: (
    ownerRepo: string,
    head: string,
  ) => Promise<GithubBranchStatus>;
  createPullRequest: (input: {
    ownerRepo: string;
    title: string;
    body: string;
    base: string;
    head: string;
  }) => Promise<string>;
};

const SAFE_NAME = /^[A-Za-z0-9_.\-/]+$/;
const SAFE_REMOTE = /^[A-Za-z0-9_.-]{1,64}$/;

const ok = (result: ProfileGitResult) => result.exitCode === 0;
const first = (text: string) => text.split(/\r?\n/, 1)[0]?.trim() ?? "";

async function stdout(
  git: ProfileGit,
  args: string[],
): Promise<string | undefined> {
  const result = await git(args);
  if (!ok(result)) return undefined;
  const text = result.stdout.trim();
  return text || undefined;
}

export async function profileCurrentBranch(
  git: ProfileGit,
): Promise<string | undefined> {
  const branch = await stdout(git, ["symbolic-ref", "--short", "HEAD"]);
  if (branch && branch !== "HEAD") return branch;
  return stdout(git, ["rev-parse", "--short", "HEAD"]);
}

async function currentBranchName(git: ProfileGit): Promise<string | undefined> {
  const branch = await stdout(git, ["symbolic-ref", "--short", "HEAD"]);
  return branch && branch !== "HEAD" ? branch : undefined;
}

export async function profilePrimaryRemote(
  git: ProfileGit,
): Promise<string | undefined> {
  const text = await stdout(git, ["remote"]);
  if (!text) return undefined;
  const names = text
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter((name) => SAFE_REMOTE.test(name));
  if (names.length === 0) return undefined;
  return names.includes("origin") ? "origin" : names[0];
}

async function refExists(git: ProfileGit, spec: string): Promise<boolean> {
  return ok(await git(["show-ref", "--verify", "--quiet", spec]));
}

async function defaultBranch(
  git: ProfileGit,
  remote: string | undefined,
): Promise<string | undefined> {
  if (remote) {
    const head = await stdout(git, [
      "symbolic-ref",
      "--short",
      `refs/remotes/${remote}/HEAD`,
    ]);
    if (head) return head.includes("/") ? head.slice(head.indexOf("/") + 1) : head;
    for (const name of ["main", "master"]) {
      if (await refExists(git, `refs/remotes/${remote}/${name}`)) return name;
    }
  }
  for (const name of ["main", "master"]) {
    if (await refExists(git, `refs/heads/${name}`)) return name;
  }
  return undefined;
}

/** The commits and diff a pull request from HEAD would contain. */
export async function profileRangeContext(
  git: ProfileGit,
): Promise<ProfileRangeContext> {
  const head = await profileCurrentBranch(git);
  if (!head) throw new Error("Not on a branch");
  const remote = await profilePrimaryRemote(git);
  const base = await defaultBranch(git, remote);
  if (!base) throw new Error("Could not resolve the default branch");
  const baseRef =
    remote && (await refExists(git, `refs/remotes/${remote}/${base}`))
      ? `${remote}/${base}`
      : base;
  const commitSummary =
    (await git(["log", "--format=%s", `${baseRef}..HEAD`])).stdout;
  const diffSummary = (await git(["diff", "--stat", `${baseRef}...HEAD`])).stdout;
  const diffPatch = (
    await git(["diff", "--no-ext-diff", `${baseRef}...HEAD`])
  ).stdout;
  if (!commitSummary.trim() && !diffPatch.trim()) {
    throw new Error("No commits to include in a pull request");
  }
  return { base, head, commitSummary, diffSummary, diffPatch };
}

async function githubRepoOf(
  git: ProfileGit,
): Promise<{ ownerRepo: string; remote: string } | undefined> {
  const remote = await profilePrimaryRemote(git);
  if (!remote) return undefined;
  const url = await git(["config", "--get", `remote.${remote}.url`]);
  if (!ok(url)) return undefined;
  const ownerRepo = githubOwnerRepoFromRemote(first(url.stdout));
  return ownerRepo ? { ownerRepo, remote } : undefined;
}

/** Open pull request of the current branch, or null when none, no GitHub
 * remote, no connected token or the lookup fails. */
export async function profilePullRequestStatus(
  git: ProfileGit,
  github: ProfileGithub,
): Promise<ProfilePullRequest | null> {
  const branch = await currentBranchName(git);
  if (!branch || !SAFE_NAME.test(branch)) return null;
  const repo = await githubRepoOf(git);
  if (!repo) return null;
  try {
    const status = await github.branchStatus(repo.ownerRepo, branch);
    const pull = status.pullRequest;
    return pull
      ? {
          number: pull.number,
          title: pull.title,
          url: pull.htmlUrl,
          state: pull.state.toLowerCase(),
        }
      : null;
  } catch {
    return null;
  }
}

export async function profileCreatePullRequest(
  git: ProfileGit,
  github: ProfileGithub,
  input: { title: string; body: string; base: string; head: string },
): Promise<string> {
  const repo = await githubRepoOf(git);
  if (!repo) {
    throw new Error("This repository has no GitHub remote to open a pull request on.");
  }
  return github.createPullRequest({
    ownerRepo: repo.ownerRepo,
    title: input.title.trim(),
    body: input.body.trim(),
    base: input.base.trim(),
    head: input.head.trim(),
  });
}
