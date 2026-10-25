import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInboxCache,
  githubPrDiff,
  githubWorkItemDetails,
  githubWorkItemThread,
} from "./githubTasks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const resolveRepo = vi.hoisted(() =>
  vi.fn(async () => ({ repoRoot: "/repo" })),
);
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitResolveRepo: resolveRepo },
}));

const mocked = vi.mocked(invoke);

describe("github work item freshness", () => {
  beforeEach(() => {
    clearInboxCache();
    mocked.mockReset();
    resolveRepo.mockClear();
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
    expect(resolveRepo).toHaveBeenCalledTimes(1);

    await githubWorkItemDetails("/repo", "pr", 1, { maxAgeMs: 30_000 });
    await githubWorkItemThread("/repo", "pr", 1, { maxAgeMs: 30_000 });
    await githubPrDiff("/repo", 1, { maxAgeMs: 30_000 });
    expect(mocked).toHaveBeenCalledTimes(3);
    expect(resolveRepo).toHaveBeenCalledTimes(1);

    await githubWorkItemDetails("/repo", "pr", 1);
    expect(mocked).toHaveBeenCalledTimes(4);
  });
});
