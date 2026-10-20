import { describe, expect, it, vi } from "vitest";
import {
  createRemoteGitPanel,
  statusSnapshotFromIndex,
  type RemoteGitPanelOps,
} from "./remoteGitPanel";

const index = {
  branch: "main",
  upstream: "origin/main",
  ahead: 2,
  behind: 1,
  files: [
    { path: "/r/a.ts", relative: "a.ts", status: "modified", additions: 1, deletions: 0, staged: true, unstaged: false },
    { path: "/r/b.ts", relative: "b.ts", status: "modified", additions: 3, deletions: 1, staged: false, unstaged: true },
    { path: "/r/c.ts", relative: "c.ts", status: "untracked", additions: 4, deletions: 0, staged: false, unstaged: true },
    { path: "/r/d.ts", relative: "d.ts", status: "deleted", additions: 0, deletions: 2, staged: true, unstaged: true },
  ],
  additions: 8,
  deletions: 3,
  remote: "origin",
  defaultBranch: "main",
  aheadOfDefault: 0,
} as never;

describe("status snapshot from the remote change index", () => {
  it("maps branch, tracking and each file's staged and unstaged state", () => {
    const snapshot = statusSnapshotFromIndex("remote://voktty-ssh-p/srv/app", index);
    expect(snapshot).toMatchObject({
      repoRoot: "remote://voktty-ssh-p/srv/app",
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      isDetached: false,
      truncated: false,
    });
    expect(
      snapshot.changedFiles.map((file) => [
        file.path,
        file.indexStatus,
        file.worktreeStatus,
        file.staged,
        file.unstaged,
        file.untracked,
      ]),
    ).toEqual([
      ["a.ts", "M", " ", true, false, false],
      ["b.ts", " ", "M", false, true, false],
      ["c.ts", "?", "?", false, true, true],
      ["d.ts", "D", "D", true, true, false],
    ]);
  });

  it("reports a repository without a branch as detached", () => {
    const snapshot = statusSnapshotFromIndex("r", { ...(index as object), branch: null } as never);
    expect(snapshot.isDetached).toBe(true);
    expect(snapshot.branch).toBe("");
  });
});

function ops(): { [K in keyof RemoteGitPanelOps]: ReturnType<typeof vi.fn> } {
  return {
    index: vi.fn(async () => index),
    fileDiff: vi.fn(async () => ({
      path: "p",
      relative: "a.ts",
      status: "modified",
      original: "old",
      current: "new",
      binary: false,
      tooLarge: true,
    })),
    patch: vi.fn(async () => ({ diffText: "diff", truncated: false })),
    stage: vi.fn(async () => undefined),
    unstage: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    stageContents: vi.fn(async () => undefined),
    init: vi.fn(async () => undefined),
  } as never;
}

describe("remote Source Control operations", () => {
  const root = "remote://voktty-ssh-p/srv/app";

  it("runs each file operation against the repository root", async () => {
    const mock = ops();
    const panel = createRemoteGitPanel(mock as never);
    await panel.stage(root, ["a.ts", "dir/b.ts"]);
    await panel.unstage(root, ["a.ts"]);
    await panel.discard(root, [{ path: "c.ts", untracked: true }]);
    await panel.stageHunk(root, "a.ts", "text");
    await panel.init(root);
    expect(mock.stage.mock.calls).toEqual([[root, "a.ts"], [root, "dir/b.ts"]]);
    expect(mock.unstage).toHaveBeenCalledWith(root, "a.ts");
    expect(mock.discard).toHaveBeenCalledWith(root, "c.ts");
    expect(mock.stageContents).toHaveBeenCalledWith(root, "a.ts", "text");
    expect(mock.init).toHaveBeenCalledWith(root);
  });

  it("stops at the first failing file instead of reporting a partial success", async () => {
    const mock = ops();
    mock.stage.mockRejectedValueOnce(new Error("pathspec did not match"));
    const panel = createRemoteGitPanel(mock as never);
    await expect(panel.stage(root, ["a.ts", "b.ts"])).rejects.toThrow("pathspec");
    expect(mock.stage).toHaveBeenCalledTimes(1);
  });

  it("bounds how many files one action may touch", async () => {
    const panel = createRemoteGitPanel(ops() as never);
    await expect(
      panel.stage(root, Array.from({ length: 513 }, (_, i) => `f${i}`)),
    ).rejects.toThrow("At most 512");
  });

  it("maps a file diff to the editor model and passes patches through", async () => {
    const panel = createRemoteGitPanel(ops() as never);
    expect(await panel.diffContent(root, "a.ts", false)).toEqual({
      originalContent: "old",
      modifiedContent: "new",
      isBinary: false,
      fallbackPatch: "",
      truncated: true,
    });
    expect(await panel.diff(root, null, true)).toEqual({ diffText: "diff", truncated: false });
  });
});