import { describe, expect, it } from "vitest";
import {
  parseGitBranches,
  parseGitCommitFiles,
  parseGitHistory,
  parseGitNumstat,
  parseGitPorcelainV2,
} from "./remoteGit";

describe("parseGitBranches", () => {
  it("sorts local branches first and keeps remote-only names selectable", () => {
    expect(
      parseGitBranches(
        "feature/demo",
        "abc1234",
        "feature/demo\t*\nmain\t \nrelease\t \n",
        "origin/main\norigin/feat/remote-only\nbackup/feat/remote-only\norigin/HEAD\norigin/foo/HEAD\norigin/feat/demo\n",
      ),
    ).toEqual({
      current: "feature/demo",
      detached: false,
      branches: [
        { name: "feature/demo", current: true, remote: null },
        { name: "main", current: false, remote: null },
        { name: "release", current: false, remote: null },
        { name: "feat/demo", current: false, remote: "origin" },
        { name: "feat/remote-only", current: false, remote: "backup" },
        { name: "feat/remote-only", current: false, remote: "origin" },
      ],
    });
  });

  it("represents detached HEAD and an unborn current branch", () => {
    expect(parseGitBranches(null, "abc1234", "main\t \n", "")).toEqual({
      current: "abc1234",
      detached: true,
      branches: [{ name: "main", current: false, remote: null }],
    });
    expect(parseGitBranches("feature/new", null, "", "")).toEqual({
      current: "feature/new",
      detached: false,
      branches: [{ name: "feature/new", current: true, remote: null }],
    });
  });
});

describe("parseGitHistory", () => {
  it("parses commit fields and classifies local, remote, and tag refs", () => {
    const head = "a".repeat(40);
    const parent = "b".repeat(40);
    expect(
      parseGitHistory(
        `${head}\0${head.slice(0, 7)}\0${parent}\0Ada\0${1700000000}\0` +
          "HEAD -> main, origin/main, tag: v1.0\0Add feature\x1e\n" +
          `${parent}\0${parent.slice(0, 7)}\0\0Lin\0${1699990000}\0\0First commit\x1e\n`,
        head,
        ["origin"],
      ),
    ).toEqual([
      {
        sha: head,
        shortSha: head.slice(0, 7),
        parents: [parent],
        author: "Ada",
        timestamp: 1700000000,
        subject: "Add feature",
        refs: [
          { name: "main", kind: "local" },
          { name: "origin/main", kind: "remote" },
          { name: "v1.0", kind: "tag" },
        ],
        head: true,
      },
      {
        sha: parent,
        shortSha: parent.slice(0, 7),
        parents: [],
        author: "Lin",
        timestamp: 1699990000,
        subject: "First commit",
        refs: [],
        head: false,
      },
    ]);
  });

  it("ignores malformed and abbreviated commit records", () => {
    expect(
      parseGitHistory("abcd\0abcd\0\0Ada\0" + "1700000000\0\0bad\x1e", "", []),
    ).toEqual([]);
  });
});

describe("parseGitCommitFiles", () => {
  it("keeps unusual path characters and attaches numstat counts", () => {
    expect(
      parseGitCommitFiles(
        "A\0new file.ts\0M\0source\nname.ts\0D\0gone.txt\0",
        "2\t0\tnew file.ts\0-\t-\tsource\nname.ts\0",
      ),
    ).toEqual([
      {
        relative: "new file.ts",
        status: "added",
        additions: 2,
        deletions: 0,
      },
      {
        relative: "source\nname.ts",
        status: "modified",
        additions: 0,
        deletions: 0,
      },
      {
        relative: "gone.txt",
        status: "deleted",
        additions: 0,
        deletions: 0,
      },
    ]);
  });

  it("rejects malformed statuses, incomplete records, and paths outside the project", () => {
    expect(() => parseGitCommitFiles("Q\0file.ts\0", "")).toThrow(
      "invalid commit file status",
    );
    expect(() => parseGitCommitFiles("A\0", "")).toThrow(
      "incomplete commit file list",
    );
    expect(() => parseGitCommitFiles("M\0../outside.txt\0", "")).toThrow(
      "outside the saved project",
    );
  });
});

describe("parseGitPorcelainV2", () => {
  it("maps branch metadata, staged state, untracked files, and renames", () => {
    const status = parseGitPorcelainV2(
      [
        "# branch.oid abc123",
        "# branch.head feature/demo",
        "# branch.upstream origin/feature/demo",
        "# branch.ab +2 -1",
        "1 .M N... 100644 100644 100644 abc def src/app file.ts",
        "2 R. N... 100644 100644 100644 abc def R100 renamed file.ts\0old file.ts",
        "? new file.ts",
        "",
      ].join("\0"),
    );

    expect(status).toEqual({
      branch: "feature/demo",
      upstream: "origin/feature/demo",
      ahead: 2,
      behind: 1,
      files: [
        {
          path: "new file.ts",
          relative: "new file.ts",
          status: "untracked",
          additions: 0,
          deletions: 0,
          staged: false,
          unstaged: true,
        },
        {
          path: "renamed file.ts",
          relative: "renamed file.ts",
          status: "modified",
          additions: 0,
          deletions: 0,
          staged: true,
          unstaged: false,
        },
        {
          path: "src/app file.ts",
          relative: "src/app file.ts",
          status: "modified",
          additions: 0,
          deletions: 0,
          staged: false,
          unstaged: true,
        },
      ],
    });
  });

  it("handles detached branches and rejects paths outside the project", () => {
    expect(parseGitPorcelainV2("# branch.head (detached)\0").branch).toBeNull();
    expect(() => parseGitPorcelainV2("? ../private.txt\0")).toThrow(
      "outside the saved project",
    );
  });
});

describe("parseGitNumstat", () => {
  it("preserves spaces and maps rename statistics to the new path", () => {
    expect(
      parseGitNumstat(
        "4\t2\tfile with spaces.ts\0-\t-\tbinary.dat\0" +
          "3\t1\t\x00old.ts\0new.ts\0",
      ),
    ).toEqual(
      new Map([
        ["file with spaces.ts", { additions: 4, deletions: 2 }],
        ["binary.dat", { additions: 0, deletions: 0 }],
        ["new.ts", { additions: 3, deletions: 1 }],
      ]),
    );
  });

  it("rejects malformed counts and paths outside the project", () => {
    expect(() => parseGitNumstat("x\t0\tfile.ts\0")).toThrow(
      "invalid change counts",
    );
    expect(() => parseGitNumstat("1\t0\t../private.txt\0")).toThrow(
      "outside the saved project",
    );
  });
});
