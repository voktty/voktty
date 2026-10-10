import { describe, expect, it, vi } from "vitest";
import type { CheckpointFile } from "./checkpoint";
import {
  mergeSessionCommitCandidates,
  resolveSessionCommitRepositories,
} from "./sessionCommit";

function file(path: string, exact = true): CheckpointFile {
  return {
    path,
    relative: path,
    status: "modified",
    additions: 1,
    deletions: 0,
    exact,
    undoable: true,
  };
}

describe("resolveSessionCommitRepositories", () => {
  it("groups exact files by nested repository and excludes shared or outside files", async () => {
    const resolveRepo = vi.fn(async (directory: string) => {
      if (directory.startsWith("/repo/packages/tool/")) {
        return {
          repoRoot: "/repo/packages/tool",
          branch: "main",
          upstream: null,
          isDetached: false,
        };
      }
      return {
        repoRoot: "/repo",
        branch: "main",
        upstream: null,
        isDetached: false,
      };
    });
    const files = [
      file("/repo/src/a.ts"),
      file("/repo/src/b.ts"),
      file("/repo/packages/tool/src/main.rs"),
      file("/outside/file.ts"),
      file("/repo/shared.ts", false),
    ];

    const result = await resolveSessionCommitRepositories(files, resolveRepo);

    expect(resolveRepo).toHaveBeenCalledTimes(3);
    expect(result.repositories).toEqual([
      {
        repoRoot: "/repo",
        files: [files[0], files[1]],
      },
      {
        repoRoot: "/repo/packages/tool",
        files: [files[2]],
      },
    ]);
    expect(result.unresolvedFiles).toEqual([files[3]]);
    expect(resolveRepo).not.toHaveBeenCalledWith("/repo/shared.ts");
  });
});

describe("mergeSessionCommitCandidates", () => {
  it("adds repository changes while retaining session checkpoint ownership", () => {
    const sessionFile = file("/repo/src/session.ts");
    const result = mergeSessionCommitCandidates(
      "/repo",
      [sessionFile, file("/repo/shared.ts", false)],
      [
        {
          path: "src/session.ts",
          originalPath: null,
          indexStatus: " ",
          worktreeStatus: "M",
          staged: false,
          unstaged: true,
          untracked: false,
          conflicted: false,
          statusLabel: "Modified",
        },
        {
          path: "shared.ts",
          originalPath: null,
          indexStatus: " ",
          worktreeStatus: "M",
          staged: false,
          unstaged: true,
          untracked: false,
          conflicted: false,
          statusLabel: "Modified",
        },
        {
          path: "README.md",
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
    );

    expect(result).toEqual([
      {
        path: "/repo/src/session.ts",
        relative: "/repo/src/session.ts",
        sessionFile,
        statusLabel: "Modified",
      },
      {
        path: "/repo/shared.ts",
        relative: "/repo/shared.ts",
        sessionFile: expect.objectContaining({ exact: false }),
        statusLabel: "Modified",
      },
      {
        path: "/repo/README.md",
        relative: "README.md",
        sessionFile: null,
        statusLabel: "Untracked",
      },
    ]);
  });
});
