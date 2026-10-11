import { setRemoteCommandRunner } from "@/modules/harness/lib/fs";
import { describe, expect, it, vi } from "vitest";
import {
  isDirectSshProfilePath,
  loadRemoteGitBranches,
  loadRemoteGitBranchFromCommit,
  loadRemoteGitCheckout,
  loadRemoteGitCherryPickCommit,
  loadRemoteGitCommit,
  loadRemoteGitCompareBranches,
  loadRemoteGitFetch,
  loadRemoteGitHistoryMetadata,
  loadRemoteGitLog,
  loadRemoteGitOperationAbort,
  loadRemoteGitOperationContinue,
  loadRemoteGitOperationStatus,
  loadRemoteGitPull,
  loadRemoteGitPush,
  loadRemoteGitRemoteUrl,
  loadRemoteGitRevertCommit,
  loadRemoteGitShowCommit,
  loadRemoteGitStashApply,
  loadRemoteGitStashDrop,
  loadRemoteGitStashList,
  loadRemoteGitStashPop,
  loadRemoteGitStashSave,
  loadRemoteGitTagCreate,
  loadRemoteGitTagDelete,
  loadRemoteGitTagList,
  loadRemoteGitTagPush,
  mapRemoteCommitFiles,
  mapRemoteGitHistoryMetadata,
  mapRemoteGitLogPage,
  relativeCommitPath,
  resolveRemoteGitRepo,
} from "./remoteGitHistory";

const head = "a".repeat(40);
const parent = "b".repeat(40);
const side = "c".repeat(40);

describe("remote Git history adapters", () => {
  const repoRoot = "remote://voktty-ssh-profile-1/srv/app";
  const index = {
    branch: "main",
    files: [
      {
        path: `${repoRoot}/src/main.ts`,
        relative: "src/main.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        staged: true,
        unstaged: true,
      },
      {
        path: `${repoRoot}/new file.ts`,
        relative: "new file.ts",
        status: "untracked",
        additions: 0,
        deletions: 0,
        staged: false,
        unstaged: true,
      },
    ],
    additions: 1,
    deletions: 0,
    remote: "origin",
    upstream: "origin/main",
    defaultBranch: "main",
    ahead: 2,
    behind: 1,
    aheadOfDefault: 0,
  };
  const branches = {
    current: "main",
    detached: false,
    branches: [
      { name: "main", current: true, remote: null },
      { name: "feature/remote", current: false, remote: "origin" },
    ],
  };

  it("routes saved SSH profile paths and keeps local paths on the native path", () => {
    expect(
      isDirectSshProfilePath("remote://voktty-ssh-profile-1/srv/app"),
    ).toBe(true);
    expect(isDirectSshProfilePath("remote://machine-1/srv/app")).toBe(false);
    expect(isDirectSshProfilePath("/srv/app")).toBe(false);
  });

  it("loads the bounded remote history through the workspace command router", async () => {
    const runner = vi.fn().mockResolvedValue({ head, commits: [] });
    setRemoteCommandRunner(runner);

    await expect(
      loadRemoteGitLog("remote://voktty-ssh-profile-1/srv/app", {
        limit: 3,
        allRefs: true,
      }),
    ).resolves.toEqual([]);
    expect(runner).toHaveBeenCalledWith("git_history", {
      cwd: "remote://voktty-ssh-profile-1/srv/app",
      limit: 500,
      allRefs: true,
    });
  });

  it("maps bounded Git status and local branch metadata", () => {
    expect(mapRemoteGitHistoryMetadata(repoRoot, index, branches)).toEqual({
      branches: [
        {
          name: "main",
          kind: "local",
          worktreePath: null,
          isHead: true,
          isDetached: false,
        },
      ],
      repo: {
        repoRoot,
        branch: "main",
        upstream: "origin/main",
        isDetached: false,
      },
      status: {
        repoRoot,
        branch: "main",
        upstream: "origin/main",
        ahead: 2,
        behind: 1,
        isDetached: false,
        truncated: false,
        changedFiles: [
          {
            path: `${repoRoot}/src/main.ts`,
            originalPath: null,
            indexStatus: "M",
            worktreeStatus: "M",
            staged: true,
            unstaged: true,
            untracked: false,
            conflicted: false,
            statusLabel: "Modified",
          },
          {
            path: `${repoRoot}/new file.ts`,
            originalPath: null,
            indexStatus: "?",
            worktreeStatus: "?",
            staged: false,
            unstaged: true,
            untracked: true,
            conflicted: false,
            statusLabel: "Untracked",
          },
        ],
      },
    });
    expect(() =>
      mapRemoteGitHistoryMetadata(
        repoRoot,
        {
          ...index,
          files: [{ ...index.files[0], path: `${repoRoot}/../private` }],
        },
        branches,
      ),
    ).toThrow("inside the remote project");
    expect(() =>
      mapRemoteGitHistoryMetadata(repoRoot, index, {
        ...branches,
        branches: [null] as unknown as typeof branches.branches,
      }),
    ).toThrow("invalid Git branches");
  });

  it("routes Git metadata, branch, remote, and network actions through SSH", async () => {
    const runner = vi.fn(async (command: string) => {
      if (command === "git_diff_index") return index;
      if (command === "git_branches") return branches;
      if (command === "git_remote_url") return "ssh://git.example/app.git";
      if (command === "git_push") {
        return { remote: "origin", branch: "main", pushed: true };
      }
      return undefined;
    });
    setRemoteCommandRunner(runner);

    await expect(loadRemoteGitHistoryMetadata(repoRoot)).resolves.toMatchObject(
      {
        repo: { branch: "main", upstream: "origin/main" },
      },
    );
    await expect(loadRemoteGitBranches(repoRoot)).resolves.toEqual({
      branches: [
        {
          name: "main",
          kind: "local",
          worktreePath: null,
          isHead: true,
          isDetached: false,
        },
      ],
    });
    await expect(loadRemoteGitRemoteUrl(repoRoot)).resolves.toBe(
      "ssh://git.example/app.git",
    );
    await expect(loadRemoteGitFetch(repoRoot)).resolves.toBeUndefined();
    await expect(loadRemoteGitPull(repoRoot)).resolves.toBeUndefined();
    await expect(loadRemoteGitPush(repoRoot)).resolves.toEqual({
      remote: "origin",
      branch: "main",
      pushed: true,
    });
    await expect(loadRemoteGitCheckout(repoRoot, "feature/new")).resolves.toBe(
      undefined,
    );
    expect(runner.mock.calls.map(([command]) => command)).toEqual([
      "git_diff_index",
      "git_branches",
      "git_branches",
      "git_remote_url",
      "git_fetch",
      "git_pull",
      "git_push",
      "git_checkout",
    ]);
    expect(runner).toHaveBeenCalledWith("git_checkout", {
      cwd: repoRoot,
      name: "feature/new",
    });
  });

  it("routes commits, patches, and tag actions through the SSH helper", async () => {
    const tag = {
      name: "v1.0",
      sha: head,
      annotated: true,
      message: "Release 1.0",
      timestampSecs: 1700000000,
    };
    const runner = vi.fn(async (command: string) => {
      if (command === "git_commit") {
        return { commitSha: head, summary: "fix: remote" };
      }
      if (command === "git_show_commit") {
        return { diffText: "commit patch", truncated: false };
      }
      if (command === "git_tag_list") return [tag];
      return undefined;
    });
    setRemoteCommandRunner(runner);

    await expect(
      loadRemoteGitCommit(repoRoot, "fix: remote", [`${repoRoot}/src/a.ts`]),
    ).resolves.toEqual({ commitSha: head, summary: "fix: remote" });
    await expect(loadRemoteGitShowCommit(repoRoot, head)).resolves.toEqual({
      diffText: "commit patch",
      truncated: false,
    });
    await expect(loadRemoteGitTagList(repoRoot)).resolves.toEqual([tag]);
    await expect(
      loadRemoteGitTagCreate(repoRoot, "v1.0", head, "Release 1.0"),
    ).resolves.toBeUndefined();
    await expect(
      loadRemoteGitTagDelete(repoRoot, "v1.0"),
    ).resolves.toBeUndefined();
    await expect(
      loadRemoteGitTagPush(repoRoot, "v1.0", "origin"),
    ).resolves.toBeUndefined();

    expect(runner.mock.calls.map(([command]) => command)).toEqual([
      "git_commit",
      "git_show_commit",
      "git_tag_list",
      "git_tag_create",
      "git_tag_delete",
      "git_tag_push",
    ]);
    expect(runner).toHaveBeenCalledWith("git_commit", {
      cwd: repoRoot,
      message: "fix: remote",
      paths: [`${repoRoot}/src/a.ts`],
    });
    expect(runner).toHaveBeenCalledWith("git_tag_create", {
      cwd: repoRoot,
      name: "v1.0",
      targetSha: head,
      message: "Release 1.0",
    });
    expect(runner).toHaveBeenCalledWith("git_tag_push", {
      cwd: repoRoot,
      name: "v1.0",
      remote: "origin",
    });
  });

  it("routes Git History stash actions through the SSH helper", async () => {
    const stashes = [
      {
        index: 0,
        sha: head,
        message: "WIP remote",
        timestampSecs: 1700000000,
      },
    ];
    const runner = vi.fn(async (command: string) =>
      command === "git_stash_list" ? stashes : undefined,
    );
    setRemoteCommandRunner(runner);

    await expect(loadRemoteGitStashList(repoRoot)).resolves.toEqual(stashes);
    await expect(
      loadRemoteGitStashSave(repoRoot, "WIP remote", false),
    ).resolves.toBeUndefined();
    await expect(loadRemoteGitStashApply(repoRoot, 0)).resolves.toBeUndefined();
    await expect(loadRemoteGitStashPop(repoRoot, 0)).resolves.toBeUndefined();
    await expect(loadRemoteGitStashDrop(repoRoot, 0)).resolves.toBeUndefined();

    expect(runner.mock.calls.map(([command]) => command)).toEqual([
      "git_stash_list",
      "git_stash_save",
      "git_stash_apply",
      "git_stash_pop",
      "git_stash_drop",
    ]);
    expect(runner).toHaveBeenCalledWith("git_stash_save", {
      cwd: repoRoot,
      message: "WIP remote",
      includeUntracked: false,
    });

    await expect(loadRemoteGitStashApply(repoRoot, -1)).rejects.toThrow(
      "Git stash index is invalid",
    );
    expect(runner).toHaveBeenCalledTimes(5);

    setRemoteCommandRunner(
      vi.fn().mockResolvedValue([{ ...stashes[0], index: 1 }]),
    );
    await expect(loadRemoteGitStashList(repoRoot)).rejects.toThrow(
      "invalid Git stash list",
    );
  });

  it("routes Git History mutations, conflict handling, and comparison through SSH", async () => {
    const comparison = {
      ahead: [
        {
          sha: head,
          shortSha: head.slice(0, 7),
          author: "Ada",
          authorEmail: "ada@example.test",
          timestampSecs: 1700000000,
          parents: [parent],
          subject: "Add remote feature",
          filesChanged: 0,
          insertions: 0,
          deletions: 0,
        },
      ],
      behind: [],
      files: [
        {
          path: "src/a.ts",
          originalPath: null,
          status: "M",
          statusLabel: "Modified",
          added: 2,
          removed: 1,
          isBinary: false,
        },
      ],
    };
    const runner = vi.fn(async (command: string) => {
      if (
        command === "git_cherry_pick_commit" ||
        command === "git_revert_commit"
      )
        return side;
      if (command === "git_operation_status") return { kind: "cherryPick" };
      if (command === "git_compare_branches") return comparison;
      return undefined;
    });
    setRemoteCommandRunner(runner);

    await expect(
      loadRemoteGitBranchFromCommit(repoRoot, "feature/new", head),
    ).resolves.toBeUndefined();
    await expect(loadRemoteGitCherryPickCommit(repoRoot, head)).resolves.toBe(
      side,
    );
    await expect(loadRemoteGitRevertCommit(repoRoot, head)).resolves.toBe(side);
    await expect(loadRemoteGitOperationStatus(repoRoot)).resolves.toEqual({
      kind: "cherryPick",
    });
    await expect(
      loadRemoteGitOperationAbort(repoRoot, "revert"),
    ).resolves.toBeUndefined();
    await expect(
      loadRemoteGitOperationContinue(repoRoot, "cherryPick"),
    ).resolves.toBeUndefined();
    await expect(
      loadRemoteGitCompareBranches(repoRoot, "main", "feature/new"),
    ).resolves.toEqual(comparison);

    expect(runner.mock.calls.map(([command]) => command)).toEqual([
      "git_branch_from_commit",
      "git_cherry_pick_commit",
      "git_revert_commit",
      "git_operation_status",
      "git_operation_abort",
      "git_operation_continue",
      "git_compare_branches",
    ]);
    expect(runner).toHaveBeenCalledWith("git_branch_from_commit", {
      cwd: repoRoot,
      name: "feature/new",
      sha: head,
    });
    expect(runner).toHaveBeenCalledWith("git_operation_abort", {
      cwd: repoRoot,
      kind: "revert",
    });
    expect(runner).toHaveBeenCalledWith("git_compare_branches", {
      cwd: repoRoot,
      base: "main",
      compare: "feature/new",
    });
  });

  it("rejects malformed remote Git operation and comparison responses", async () => {
    const runner = vi.fn(async (command: string) => {
      if (command === "git_operation_status") return { kind: "reset" };
      return {
        ahead: [],
        behind: [],
        files: [
          {
            path: "../private",
            originalPath: null,
            status: "M",
            statusLabel: "Modified",
            added: 1,
            removed: 0,
            isBinary: false,
          },
        ],
      };
    });
    setRemoteCommandRunner(runner);

    await expect(loadRemoteGitOperationStatus(repoRoot)).rejects.toThrow(
      "invalid Git operation",
    );
    await expect(
      loadRemoteGitCompareBranches(repoRoot, "main", "feature/new"),
    ).rejects.toThrow("invalid Git comparison");
  });

  it("resolves a canonical repository root for a file inside a saved profile", async () => {
    const runner = vi.fn().mockResolvedValue({
      repoRoot: "remote://voktty-ssh-profile-1/srv/app",
      head,
      commits: [
        {
          sha: head,
          shortSha: head.slice(0, 7),
          parents: [],
          author: "Ada",
          timestamp: 1700000000,
          subject: "Head commit",
          refs: [{ name: "main", kind: "local" }],
          head: true,
        },
      ],
    });
    setRemoteCommandRunner(runner);

    await expect(
      resolveRemoteGitRepo("remote://voktty-ssh-profile-1/srv/app/src/main.ts"),
    ).resolves.toEqual({
      repoRoot: "remote://voktty-ssh-profile-1/srv/app",
      branch: "main",
      upstream: null,
      isDetached: false,
    });
    expect(runner).toHaveBeenCalledWith("git_history", {
      cwd: "remote://voktty-ssh-profile-1/srv/app/src",
      limit: 1,
    });
  });

  it("maps bounded pages and follows only HEAD ancestors in current branch scope", () => {
    const history = {
      head,
      commits: [
        {
          sha: head,
          shortSha: head.slice(0, 7),
          parents: [parent],
          author: "Ada",
          timestamp: 1700000000,
          subject: "Head commit",
          head: true,
        },
        {
          sha: side,
          shortSha: side.slice(0, 7),
          parents: [],
          author: "Lin",
          timestamp: 1699995000,
          subject: "Other branch",
          head: false,
        },
        {
          sha: parent,
          shortSha: parent.slice(0, 7),
          parents: [],
          author: "Ada",
          timestamp: 1699990000,
          subject: "Parent commit",
          head: false,
        },
      ],
    };

    expect(mapRemoteGitLogPage(history, { limit: 1 })).toEqual([
      {
        sha: head,
        shortSha: head.slice(0, 7),
        author: "Ada",
        authorEmail: "",
        timestampSecs: 1700000000,
        parents: [parent],
        subject: "Head commit",
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      },
    ]);
    expect(
      mapRemoteGitLogPage(history, { limit: 1, beforeSha: head })[0]?.sha,
    ).toBe(parent);
    expect(
      mapRemoteGitLogPage(history, { limit: 1, allRefs: true, skip: 1 })[0]
        ?.sha,
    ).toBe(side);
  });

  it("maps commit file metadata and confines diff paths to the saved root", () => {
    expect(
      mapRemoteCommitFiles("remote://voktty-ssh-profile-1/srv/app", [
        {
          path: "remote://voktty-ssh-profile-1/srv/app/icon.png",
          relative: "icon.png",
          status: "modified",
          additions: 0,
          deletions: 0,
          binary: true,
        },
      ]),
    ).toEqual([
      {
        path: "remote://voktty-ssh-profile-1/srv/app/icon.png",
        originalPath: null,
        status: "M",
        statusLabel: "Modified",
        added: 0,
        removed: 0,
        isBinary: true,
      },
    ]);
    expect(() =>
      mapRemoteCommitFiles("remote://voktty-ssh-profile-1/srv/app", [
        {
          path: "remote://voktty-ssh-profile-2/private/key",
          relative: "private/key",
          status: "modified",
          additions: 0,
          deletions: 0,
          binary: false,
        },
      ]),
    ).toThrow("inside the remote project");
    expect(
      relativeCommitPath(
        "remote://voktty-ssh-profile-1/srv/app",
        "remote://voktty-ssh-profile-1/srv/app/src/main.ts",
      ),
    ).toBe("src/main.ts");
    expect(() =>
      relativeCommitPath(
        "remote://voktty-ssh-profile-1/srv/app",
        "remote://voktty-ssh-profile-1/srv/secrets.env",
      ),
    ).toThrow("inside the remote project");
    expect(() =>
      relativeCommitPath(
        "remote://voktty-ssh-profile-1/srv/app",
        "../secrets.env",
      ),
    ).toThrow("inside the remote project");
  });
});
