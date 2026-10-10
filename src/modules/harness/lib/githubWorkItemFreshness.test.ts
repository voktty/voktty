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

  it("warms a hovered pull request once for the Inbox detail view", async () => {
    const item = {
      provider: "github" as const,
      kind: "pr" as const,
      projectPath: "/repo",
      number: 17,
    };

    prefetchGithubWorkItem(item);
    await vi.waitFor(() => expect(mocked).toHaveBeenCalledTimes(3));

    expect(mocked).toHaveBeenCalledWith("git_github_work_item_details", {
      cwd: "/repo",
      kind: "pr",
      number: 17,
    });
    expect(mocked).toHaveBeenCalledWith("git_github_work_item_thread", {
      cwd: "/repo",
      kind: "pr",
      number: 17,
    });
    expect(mocked).toHaveBeenCalledWith("git_github_pr_diff", {
      cwd: "/repo",
      number: 17,
    });

    prefetchGithubWorkItem(item);
    await Promise.resolve();
    expect(mocked).toHaveBeenCalledTimes(3);
  });

  it("does not prefetch non-GitHub Inbox items", () => {
    prefetchGithubWorkItem({
      provider: "linear",
      kind: "linear",
      projectPath: "/repo",
      number: 17,
    });

    expect(mocked).not.toHaveBeenCalled();
  });
});
