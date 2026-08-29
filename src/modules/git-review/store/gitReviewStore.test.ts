import { beforeEach, describe, expect, it, vi } from "vitest";
import * as bridge from "../lib/gitReviewBridge";
import type { ReviewComment } from "../types";
import { fileKey, sessionKey, useGitReviewStore } from "./gitReviewStore";

vi.mock("../lib/gitReviewBridge", () => ({
  openReviewSession: vi.fn(),
  markFileViewed: vi.fn(),
  markRangeClaim: vi.fn(),
  unmarkRangeClaim: vi.fn(),
  reconcileFileReview: vi.fn(),
  getSessionReviewOverview: vi.fn(),
  addReviewComment: vi.fn(),
  getReviewComments: vi.fn(),
  deleteReviewComment: vi.fn(),
  updateReviewComment: vi.fn(),
}));

describe("gitReviewStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGitReviewStore.setState({
      overviews: {},
      reconciliations: {},
      viewModes: {},
      comments: {},
      isLoading: false,
    });
  });

  it("builds consistent keys across slash styles", () => {
    expect(sessionKey("C:\\Repo\\", "worktree")).toBe("C:\\Repo#worktree");
    expect(fileKey("C:\\Repo", "worktree", "src/main.rs")).toBe(
      "C:\\Repo#worktree#src/main.rs",
    );
  });

  it("loads and stores session overview", async () => {
    vi.mocked(bridge.getSessionReviewOverview).mockResolvedValueOnce({
      sessionId: "rev_1",
      repoRoot: "C:\\Repo",
      target: "worktree",
      files: [
        {
          path: "src/lib.rs",
          reviewed: true,
          viewedAt: 100,
          snapshotHash: "abc",
          claimsCount: 1,
        },
      ],
    });

    const overview = await useGitReviewStore
      .getState()
      .loadOverview("C:\\Repo", "worktree");
    expect(overview).not.toBeNull();
    const stored =
      useGitReviewStore.getState().overviews[sessionKey("C:\\Repo", "worktree")];
    expect(stored?.files[0].path).toBe("src/lib.rs");
  });

  it("marks file reviewed and updates state", async () => {
    vi.mocked(bridge.markFileViewed).mockResolvedValueOnce(true);
    vi.mocked(bridge.getSessionReviewOverview).mockResolvedValueOnce({
      sessionId: "rev_1",
      repoRoot: "C:\\Repo",
      target: "worktree",
      files: [],
    });

    const ok = await useGitReviewStore
      .getState()
      .markFile("C:\\Repo", "worktree", "src/lib.rs", "content", true);
    expect(ok).toBe(true);
    expect(bridge.markFileViewed).toHaveBeenCalledWith(
      "C:\\Repo",
      "worktree",
      "src/lib.rs",
      "content",
      true,
    );
  });

  it("reconciles file review and toggles view modes", async () => {
    vi.mocked(bridge.reconcileFileReview).mockResolvedValueOnce({
      changedSinceReview: true,
      ranges: [
        {
          startLine: 1,
          endLine: 2,
          status: "new",
          reviewedVia: null,
        },
      ],
      reviewedBaseline: "baseline",
    });

    const rec = await useGitReviewStore
      .getState()
      .reconcileFile("C:\\Repo", "worktree", "src/lib.rs", "base", "head");
    expect(rec).not.toBeNull();
    expect(rec?.changedSinceReview).toBe(true);

    useGitReviewStore
      .getState()
      .setViewMode("C:\\Repo", "worktree", "src/lib.rs", "unreviewed");
    const fKey = fileKey("C:\\Repo", "worktree", "src/lib.rs");
    expect(useGitReviewStore.getState().viewModes[fKey]).toBe("unreviewed");
  });

  it("manages review comments and builds handoff prompt", async () => {
    const mockComment: ReviewComment = {
      id: "comment-1",
      sessionId: "s1",
      path: "src/lib.rs",
      side: "new",
      line: 42,
      endLine: 45,
      snapshotHash: "hash123",
      comment: "Please add unit tests for this function",
      createdAt: 1000,
      updatedAt: 1000,
      status: "pending",
    };

    vi.mocked(bridge.addReviewComment).mockResolvedValueOnce(mockComment);
    vi.mocked(bridge.getReviewComments).mockResolvedValueOnce([mockComment]);
    vi.mocked(bridge.updateReviewComment).mockResolvedValueOnce(true);
    vi.mocked(bridge.deleteReviewComment).mockResolvedValueOnce(true);

    // Add comment
    const added = await useGitReviewStore.getState().addComment({
      repoRoot: "C:\\Repo",
      target: "worktree",
      path: "src/lib.rs",
      side: "new",
      line: 42,
      endLine: 45,
      content: "fn test() {}",
      comment: "Please add unit tests for this function",
    });
    expect(added).toEqual(mockComment);
    expect(useGitReviewStore.getState().comments["C:\\Repo#worktree"]).toHaveLength(1);

    // Build handoff prompt
    const prompt = useGitReviewStore.getState().buildHandoffPrompt("C:\\Repo", "worktree");
    expect(prompt).toContain("Code Review Feedback");
    expect(prompt).toContain("src/lib.rs:42-45");
    expect(prompt).toContain("Please add unit tests for this function");

    // Update comment
    const updated = await useGitReviewStore
      .getState()
      .updateComment("C:\\Repo", "worktree", "comment-1", "Updated comment text");
    expect(updated).toBe(true);
    expect(useGitReviewStore.getState().comments["C:\\Repo#worktree"][0].comment).toBe(
      "Updated comment text",
    );

    // Delete comment
    const deleted = await useGitReviewStore
      .getState()
      .deleteComment("C:\\Repo", "worktree", "comment-1");
    expect(deleted).toBe(true);
    expect(useGitReviewStore.getState().comments["C:\\Repo#worktree"]).toHaveLength(0);
  });
});

