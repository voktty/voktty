import { beforeEach, expect, it, vi } from "vitest";
import {
  clearInboxCache,
  githubPrDiff,
  peekGithubPrDiff,
} from "@/modules/harness/lib/githubTasks";
import { LOCAL_WORKSPACE } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), invoke: vi.fn() }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitResolveRepo: mocks.resolve },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
const payload = {
  additions: 1,
  deletions: 0,
  files: [{ path: "src/main.ts", additions: 1, deletions: 0 }],
  patch: "",
  truncated: false,
};
beforeEach(() => {
  clearInboxCache();
  mocks.resolve.mockReset().mockResolvedValue({ repoRoot: "/repo" });
  mocks.invoke.mockReset().mockResolvedValue(payload);
});
it("loads and caches repository-relative PR paths under the resolved root", async () => {
  const result = await githubPrDiff("/repo/packages/app", 7);
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(
    "/repo/packages/app",
    LOCAL_WORKSPACE,
  );
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("git_github_pr_diff", {
    cwd: "/repo",
    number: 7,
  });
  expect(result).toEqual({ ...payload, repoRoot: "/repo" });
  expect(peekGithubPrDiff("/repo/packages/app", 7)).toBe(result);
  expect(await githubPrDiff("/repo/packages/app", 7, { maxAgeMs: 30000 })).toBe(
    result,
  );
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
});
it("coalesces pending repository lookup before starting another fetch", async () => {
  let resolve!: (value: { repoRoot: string }) => void;
  mocks.resolve.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const first = githubPrDiff("/repo/sub", 7);
  const second = githubPrDiff("/repo/sub", 7);
  await Promise.resolve();
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).not.toHaveBeenCalled();
  resolve({ repoRoot: "/repo" });
  expect(await first).toBe(await second);
});
it("refuses a missing repository instead of guessing the project root", async () => {
  mocks.resolve.mockResolvedValue(null);
  await expect(githubPrDiff("/folder", 7)).rejects.toThrow();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(peekGithubPrDiff("/folder", 7)).toBeNull();
});
it("does not cache a retired lookup after cache invalidation", async () => {
  let resolve!: (value: { repoRoot: string }) => void;
  mocks.resolve.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const retired = githubPrDiff("/repo/sub", 7);
  await Promise.resolve();
  clearInboxCache();
  const current = await githubPrDiff("/repo/sub", 7);
  resolve({ repoRoot: "/older" });
  await retired;
  expect(peekGithubPrDiff("/repo/sub", 7)).toBe(current);
});
