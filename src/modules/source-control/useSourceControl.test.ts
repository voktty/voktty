import { describe, expect, it, vi } from "vitest";
import {
  beginSourceControlRefresh,
  loadSharedSourceControlSnapshot,
  ownsSourceControlRefresh,
  planSourceControlRefresh,
  repositoryContainsContext,
  repositoryInfoFromStatus,
} from "./useSourceControl";

const sharedSnapshot = {
  repo: {
    repoRoot: "/repo",
    branch: "main",
    upstream: null,
    isDetached: false,
  },
  status: {
    repoRoot: "/repo",
    branch: "main",
    upstream: null,
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: [],
  },
  remoteError: null,
};

describe("loadSharedSourceControlSnapshot", () => {
  it("shares one in-flight load between consumers of the same repository", async () => {
    const load = vi.fn(async () => sharedSnapshot);
    const key = "test-shared-inflight\0repo:/repo";

    const [first, second] = await Promise.all([
      loadSharedSourceControlSnapshot(key, "test-shared-inflight", false, load),
      loadSharedSourceControlSnapshot(key, "test-shared-inflight", false, load),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toEqual(sharedSnapshot);
    expect(second).toEqual(sharedSnapshot);
  });

  it("reuses a fresh snapshot only when the caller permits ambient caching", async () => {
    const key = "test-shared-cache\0repo:/repo";
    const firstLoad = vi.fn(async () => sharedSnapshot);
    const secondLoad = vi.fn(async () => ({ ...sharedSnapshot, repo: null }));

    await loadSharedSourceControlSnapshot(
      key,
      "test-shared-cache",
      false,
      firstLoad,
    );
    const cached = await loadSharedSourceControlSnapshot(
      key,
      "test-shared-cache",
      true,
      secondLoad,
    );

    expect(firstLoad).toHaveBeenCalledTimes(1);
    expect(secondLoad).not.toHaveBeenCalled();
    expect(cached).toEqual(sharedSnapshot);
  });
});

describe("planSourceControlRefresh", () => {
  it("reuses an identical in-flight refresh without invalidating its request", () => {
    expect(
      planSourceControlRefresh(
        7,
        { contextKey: "local\0/repo", mode: "never" },
        "local\0/repo",
        "never",
      ),
    ).toEqual({ kind: "reuse", requestId: 7 });
  });

  it("starts a new request when the context or mode requires different work", () => {
    expect(
      planSourceControlRefresh(
        7,
        { contextKey: "local\0/repo", mode: "never" },
        "local\0/other",
        "never",
      ),
    ).toEqual({ kind: "start", requestId: 8 });
    expect(
      planSourceControlRefresh(
        8,
        { contextKey: "local\0/repo", mode: "never" },
        "local\0/repo",
        "always",
      ),
    ).toEqual({ kind: "start", requestId: 9 });
  });
});

describe("ownsSourceControlRefresh", () => {
  it("prevents an older request from clearing a newer in-flight refresh", () => {
    const current = {
      contextKey: "local\0/repo",
      mode: "always" as const,
      requestId: 9,
    };

    expect(ownsSourceControlRefresh(current, "local\0/repo", 8)).toBe(false);
    expect(ownsSourceControlRefresh(current, "local\0/repo", 9)).toBe(true);
  });
});

describe("repositoryContainsContext", () => {
  it("matches a repository root and its descendants", () => {
    expect(repositoryContainsContext("/repo", "/repo")).toBe(true);
    expect(repositoryContainsContext("/repo", "/repo/packages/app")).toBe(true);
  });

  it("rejects sibling paths that only share a string prefix", () => {
    expect(repositoryContainsContext("/repo", "/repo-other/app")).toBe(false);
    expect(repositoryContainsContext("/Repo", "/repo/app")).toBe(false);
  });

  it("normalizes Windows separators and drive-letter casing", () => {
    expect(repositoryContainsContext("C:\\Repo", "c:/repo/packages/app")).toBe(
      true,
    );
  });

  it("normalizes UNC server and share casing", () => {
    expect(
      repositoryContainsContext(
        "\\\\SERVER\\Share\\Repo",
        "//server/share/repo/packages/app",
      ),
    ).toBe(true);
  });

  it("handles filesystem roots", () => {
    expect(repositoryContainsContext("/", "/workspace")).toBe(true);
    expect(repositoryContainsContext("C:/", "C:/workspace")).toBe(true);
  });
});

describe("beginSourceControlRefresh", () => {
  const loaded = {
    contextPath: "/old/repo",
    repo: {
      repoRoot: "/old/repo",
      branch: "main",
      upstream: null,
      isDetached: false,
    },
    status: {
      repoRoot: "/old/repo",
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles: [],
    },
    hasRepo: true,
    isLoading: false,
    localError: "old error",
    lastRemoteError: "old remote error",
    untouched: 42,
  };

  it("clears stale repository data when the context changes repositories", () => {
    expect(beginSourceControlRefresh(loaded, "/new/repo", false)).toEqual({
      contextPath: "/new/repo",
      repo: null,
      status: null,
      hasRepo: false,
      isLoading: true,
      localError: null,
      lastRemoteError: null,
      untouched: 42,
    });
  });

  it("preserves fresh repository data for a context inside the same repo", () => {
    expect(
      beginSourceControlRefresh(loaded, "/old/repo/packages/app", true),
    ).toEqual({
      ...loaded,
      contextPath: "/old/repo/packages/app",
      isLoading: true,
      localError: null,
    });
  });
});

describe("repositoryInfoFromStatus", () => {
  it("builds repository metadata without a second repository discovery", () => {
    expect(
      repositoryInfoFromStatus({
        repoRoot: "//server/share/repo",
        branch: "main",
        upstream: "origin/main",
        ahead: 1,
        behind: 0,
        isDetached: false,
        truncated: false,
        changedFiles: [],
      }),
    ).toEqual({
      repoRoot: "//server/share/repo",
      branch: "main",
      upstream: "origin/main",
      isDetached: false,
    });
  });
});
