import { setRemoteCommandRunner } from "@/modules/harness/lib/fs";
import { describe, expect, it, vi } from "vitest";
import {
  isDirectSshProfilePath,
  loadRemoteGitLog,
  mapRemoteCommitFiles,
  mapRemoteGitLogPage,
  relativeCommitPath,
  resolveRemoteGitRepo,
} from "./remoteGitHistory";

const head = "a".repeat(40);
const parent = "b".repeat(40);
const side = "c".repeat(40);

describe("remote Git history adapters", () => {
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
