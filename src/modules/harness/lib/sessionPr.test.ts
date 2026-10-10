import type { GitBranchComparison } from "@/modules/ai/lib/native";
import { describe, expect, it, vi } from "vitest";
import { buildSessionPullRequestContext } from "./sessionPr";

const comparison: GitBranchComparison = {
  ahead: [
    {
      sha: "abcdef1234567890",
      shortSha: "abcdef1",
      author: "A. Developer",
      authorEmail: "dev@example.com",
      timestampSecs: 1,
      parents: [],
      subject: "Add selected workspace commit",
      filesChanged: 1,
      insertions: 3,
      deletions: 1,
    },
  ],
  behind: [],
  files: [
    {
      path: "src/feature.ts",
      originalPath: null,
      status: "M",
      statusLabel: "Modified",
      added: 3,
      removed: 1,
      isBinary: false,
    },
  ],
};

describe("buildSessionPullRequestContext", () => {
  it("builds summaries and patches from the selected branch range", async () => {
    const readCommitDiff = vi.fn(async (sha: string) => ({
      diffText: `patch for ${sha}`,
      truncated: false,
    }));

    const context = await buildSessionPullRequestContext(
      "main",
      "feature/session",
      comparison,
      readCommitDiff,
    );

    expect(context).toEqual({
      base: "main",
      head: "feature/session",
      commitSummary: "- abcdef1 Add selected workspace commit",
      diffSummary: "- Modified src/feature.ts (+3/-1)",
      diffPatch:
        "--- abcdef1 Add selected workspace commit ---\npatch for abcdef1234567890",
    });
    expect(readCommitDiff).toHaveBeenCalledWith("abcdef1234567890");
  });

  it("bounds commit patches and records unavailable or truncated diffs", async () => {
    const manyCommits: GitBranchComparison = {
      ...comparison,
      ahead: Array.from({ length: 22 }, (_, index) => ({
        ...comparison.ahead[0],
        sha: `sha-${index}`,
        shortSha: `short-${index}`,
      })),
    };
    const readCommitDiff = vi.fn(async (sha: string) => {
      if (sha === "sha-1") throw new Error("diff unavailable");
      return {
        diffText: "x".repeat(5_000),
        truncated: sha === "sha-0",
      };
    });

    const context = await buildSessionPullRequestContext(
      "main",
      "feature/session",
      manyCommits,
      readCommitDiff,
    );

    expect(readCommitDiff).toHaveBeenCalledTimes(20);
    expect(context.diffPatch).toContain("[truncated]");
    expect(context.diffPatch).toContain(
      "Patch omitted for 2 additional commits",
    );
    expect(context.diffPatch).toContain("could not provide diffs for 1 commit");
    expect(context.diffPatch.length).toBeLessThanOrEqual(12_014);
  });
});
