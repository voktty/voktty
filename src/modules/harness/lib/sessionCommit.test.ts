import { describe, expect, it, vi } from "vitest";
import type { CheckpointFile } from "./checkpoint";
import {
  buildSessionCommitMessageContext,
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

describe("buildSessionCommitMessageContext", () => {
  it("uses staged and working diffs for selected files in stable order", async () => {
    const selected = [
      {
        path: "/repo/src/a.ts",
        relative: "src/a.ts",
        sessionFile: file("/repo/src/a.ts"),
        statusLabel: "Modified",
      },
      {
        path: "/repo/README.md",
        relative: "README.md",
        sessionFile: null,
        statusLabel: "Untracked",
      },
    ];
    const readDiff = vi.fn(async (path: string, staged: boolean) => ({
      diffText: `${staged ? "staged" : "working"}: ${path}`,
      truncated: false,
    }));

    const context = await buildSessionCommitMessageContext(
      "feature/session",
      selected,
      readDiff,
    );

    expect(context.branch).toBe("feature/session");
    expect(context.summary).toContain("Modified src/a.ts");
    expect(context.summary).toContain("Untracked README.md");
    expect(context.patch.indexOf("src/a.ts (staged)")).toBeLessThan(
      context.patch.indexOf("src/a.ts (unstaged)"),
    );
    expect(context.patch).toContain("README.md (staged)");
    expect(context.patch).toContain("README.md (unstaged)");
    expect(readDiff).toHaveBeenCalledTimes(4);
  });
});
