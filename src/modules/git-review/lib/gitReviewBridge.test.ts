import { describe, expect, it, vi } from "vitest";
import {
  getSessionReviewOverview,
  markFileViewed,
  markRangeClaim,
  openReviewSession,
  reconcileFileReview,
  unmarkRangeClaim,
} from "./gitReviewBridge";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: any) => {
    switch (cmd) {
      case "git_review_open_session":
        return {
          id: "rev_123",
          sessionKey: `${args.repoRoot}#${args.target}`,
          repoRoot: args.repoRoot,
          target: args.target,
          baseRef: args.baseRef ?? null,
          headRef: args.headRef ?? null,
          createdAt: 1000,
          updatedAt: 1000,
          closedAt: null,
        };
      case "git_review_mark_file":
        return undefined;
      case "git_review_mark_range":
        return undefined;
      case "git_review_unmark_range":
        return undefined;
      case "git_review_reconcile_file":
        return {
          changedSinceReview: false,
          ranges: [
            {
              startLine: 1,
              endLine: 5,
              status: "reviewed",
              reviewedVia: { kind: "file" },
            },
          ],
          reviewedBaseline: args.headContent,
        };
      case "git_review_get_session_overview":
        return {
          sessionId: "rev_123",
          repoRoot: args.repoRoot,
          target: args.target,
          files: [
            {
              path: "src/main.rs",
              reviewed: true,
              viewedAt: 1000,
              snapshotHash: "hash_abc",
              claimsCount: 1,
            },
          ],
        };
      default:
        throw new Error(`Unhandled command: ${cmd}`);
    }
  }),
}));

describe("gitReviewBridge", () => {
  it("opens review session and returns typed model", async () => {
    const session = await openReviewSession("C:\\repo", "worktree");
    expect(session).not.toBeNull();
    expect(session?.id).toBe("rev_123");
    expect(session?.repoRoot).toBe("C:\\repo");
  });

  it("marks and unmarks file reviewed", async () => {
    const success = await markFileViewed("C:\\repo", "worktree", "src/lib.rs", "content", true);
    expect(success).toBe(true);
  });

  it("marks range claims with block metadata", async () => {
    const success = await markRangeClaim(
      "C:\\repo",
      "worktree",
      "src/lib.rs",
      "block_1",
      "Refactoring",
      "content",
      [{ startLine: 1, endLine: 10 }],
    );
    expect(success).toBe(true);
  });

  it("unmarks range claims", async () => {
    const success = await unmarkRangeClaim("C:\\repo", "worktree", "src/lib.rs", "block_1");
    expect(success).toBe(true);
  });

  it("reconciles file review and returns range projections", async () => {
    const reconciliation = await reconcileFileReview(
      "C:\\repo",
      "worktree",
      "src/lib.rs",
      "base",
      "head",
    );
    expect(reconciliation).not.toBeNull();
    expect(reconciliation?.changedSinceReview).toBe(false);
    expect(reconciliation?.ranges[0].status).toBe("reviewed");
  });

  it("gets session overview", async () => {
    const overview = await getSessionReviewOverview("C:\\repo", "worktree");
    expect(overview).not.toBeNull();
    expect(overview?.files[0].path).toBe("src/main.rs");
    expect(overview?.files[0].reviewed).toBe(true);
  });
});
