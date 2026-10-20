import { describe, expect, it, vi } from "vitest";
import {
  type ProfileGit,
  type ProfileGithub,
  profileCreatePullRequest,
  profilePullRequestStatus,
  profileRangeContext,
} from "./remoteProfileGitPr";

function fakeGit(table: Record<string, string | number>): ProfileGit {
  return async (args) => {
    const key = args.join(" ");
    const value = table[key];
    if (value === undefined) return { stdout: "", exitCode: 1 };
    if (typeof value === "number") return { stdout: "", exitCode: value };
    return { stdout: value, exitCode: 0 };
  };
}

const baseTable = {
  "symbolic-ref --short HEAD": "feature/x\n",
  remote: "upstream\norigin\n",
  "config --get remote.origin.url": "git@github.com:acme/app.git\n",
  "symbolic-ref --short refs/remotes/origin/HEAD": "origin/main\n",
  "show-ref --verify --quiet refs/remotes/origin/main": "",
  "log --format=%s origin/main..HEAD": "add thing\nfix thing\n",
  "diff --stat origin/main...HEAD": " a.ts | 2 +-\n",
  "diff --no-ext-diff origin/main...HEAD": "diff --git a/a.ts b/a.ts\n",
};

describe("profileRangeContext", () => {
  it("resolves the base from the primary remote and reads the PR range", async () => {
    await expect(profileRangeContext(fakeGit(baseTable))).resolves.toEqual({
      base: "main",
      head: "feature/x",
      commitSummary: "add thing\nfix thing\n",
      diffSummary: " a.ts | 2 +-\n",
      diffPatch: "diff --git a/a.ts b/a.ts\n",
    });
  });

  it("falls back to a local main or master branch without a remote", async () => {
    const git = fakeGit({
      "symbolic-ref --short HEAD": "topic",
      "show-ref --verify --quiet refs/heads/master": "",
      "log --format=%s master..HEAD": "one\n",
      "diff --stat master...HEAD": "s",
      "diff --no-ext-diff master...HEAD": "p",
    });
    await expect(profileRangeContext(git)).resolves.toMatchObject({
      base: "master",
      head: "topic",
    });
  });

  it("fails clearly when detached, without a default branch or without changes", async () => {
    await expect(profileRangeContext(fakeGit({}))).rejects.toThrow(
      "Not on a branch",
    );
    await expect(
      profileRangeContext(fakeGit({ "symbolic-ref --short HEAD": "topic" })),
    ).rejects.toThrow("Could not resolve the default branch");
    await expect(
      profileRangeContext(
        fakeGit({
          "symbolic-ref --short HEAD": "topic",
          "show-ref --verify --quiet refs/heads/main": "",
        }),
      ),
    ).rejects.toThrow("No commits to include in a pull request");
  });
});

describe("pull requests through the GitHub API", () => {
  const github = (overrides: Partial<ProfileGithub> = {}): ProfileGithub => ({
    branchStatus: vi.fn(async () => ({
      pullRequest: {
        number: 7,
        title: "Add thing",
        htmlUrl: "https://github.com/acme/app/pull/7",
        state: "OPEN",
      },
    })),
    createPullRequest: vi.fn(async () => "https://github.com/acme/app/pull/8"),
    ...overrides,
  });

  it("reports the open pull request of the current branch", async () => {
    const api = github();
    await expect(
      profilePullRequestStatus(fakeGit(baseTable), api),
    ).resolves.toEqual({
      number: 7,
      title: "Add thing",
      url: "https://github.com/acme/app/pull/7",
      state: "open",
    });
    expect(api.branchStatus).toHaveBeenCalledWith("acme/app", "feature/x");
  });

  it("returns null without a GitHub remote, a branch, or a working token", async () => {
    const api = github();
    expect(
      await profilePullRequestStatus(
        fakeGit({
          ...baseTable,
          "config --get remote.origin.url": "https://gitlab.com/acme/app.git",
        }),
        api,
      ),
    ).toBeNull();
    expect(await profilePullRequestStatus(fakeGit({}), api)).toBeNull();
    expect(api.branchStatus).not.toHaveBeenCalled();
    expect(
      await profilePullRequestStatus(
        fakeGit(baseTable),
        github({
          branchStatus: async () => {
            throw new Error("GitHub is not connected");
          },
        }),
      ),
    ).toBeNull();
  });

  it("creates a pull request on the repository behind the remote", async () => {
    const api = github();
    await expect(
      profileCreatePullRequest(fakeGit(baseTable), api, {
        title: " Add thing ",
        body: "Body\n",
        base: "main",
        head: "feature/x",
      }),
    ).resolves.toBe("https://github.com/acme/app/pull/8");
    expect(api.createPullRequest).toHaveBeenCalledWith({
      ownerRepo: "acme/app",
      title: "Add thing",
      body: "Body",
      base: "main",
      head: "feature/x",
    });
  });

  it("refuses to create a pull request without a GitHub remote", async () => {
    await expect(
      profileCreatePullRequest(fakeGit({ remote: "" }), github(), {
        title: "t",
        body: "",
        base: "main",
        head: "x",
      }),
    ).rejects.toThrow("no GitHub remote");
  });
});
