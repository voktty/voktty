import { describe, expect, it } from "vitest";
import { parseGitNumstat, parseGitPorcelainV2 } from "./remoteGit";

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
