import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInboxCache,
  githubPrDiff,
  githubWorkItemDetails,
  githubWorkItemThread,
  prefetchGithubWorkItem,
} from "./githubTasks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mocked = vi.mocked(invoke);

describe("github work item freshness", () => {
  beforeEach(() => {
    clearInboxCache();
    mocked.mockReset();
    mocked.mockImplementation(async (command: string) =>
      command === "git_github_pr_diff"
        ? { additions: 0, deletions: 0, files: [], patch: "", truncated: false }
        : command === "git_github_work_item_thread"
          ? { comments: [], commits: [], truncated: false }
          : { body: "", author: "" },
    );
  });

  it("shares an in-flight details request", async () => {
    await Promise.all([
      githubWorkItemDetails("/repo", "pr", 1),
      githubWorkItemDetails("/repo", "pr", 1),
    ]);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("reuses recent data only when the caller allows it", async () => {
    await githubWorkItemDetails("/repo", "pr", 1);
    await githubWorkItemThread("/repo", "pr", 1);
    await githubPrDiff("/repo", 1);
    expect(mocked).toHaveBeenCalledTimes(3);

    await githubWorkItemDetails("/repo", "pr", 1, { maxAgeMs: 30_000 });
    await githubWorkItemThread("/repo", "pr", 1, { maxAgeMs: 30_000 });
    await githubPrDiff("/repo", 1, { maxAgeMs: 30_000 });
    expect(mocked).toHaveBeenCalledTimes(3);

    await githubWorkItemDetails("/repo", "pr", 1);
    expect(mocked).toHaveBeenCalledTimes(4);
  });

  it("prefetches issue activity and PR diffs once for the Inbox hover", async () => {
    const target = { repo: "owner/repo", number: 1 };
    prefetchGithubWorkItem("/repo", { ...target, kind: "issue" });
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledTimes(2));
    expect(mocked.mock.calls.map(([command]) => command)).toEqual([
      "git_github_work_item_details",
      "git_github_work_item_thread",
    ]);

    prefetchGithubWorkItem("/repo", { ...target, kind: "pr" });
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledTimes(5));
    expect(mocked.mock.calls.slice(2).map(([command]) => command)).toEqual([
      "git_github_work_item_details",
      "git_github_work_item_thread",
      "git_github_pr_diff",
    ]);

    prefetchGithubWorkItem("/repo", { ...target, kind: "pr" });
    expect(mocked).toHaveBeenCalledTimes(5);
  });
});
