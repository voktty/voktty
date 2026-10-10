// @vitest-environment happy-dom
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CheckpointFile } from "../lib/checkpoint";
import { SessionChangesCommit } from "./SessionChangesCommit";

const mocks = vi.hoisted(() => ({
  gitResolveRepo: vi.fn(),
  gitStatus: vi.fn(),
  gitDiff: vi.fn(),
  gitCompareBranches: vi.fn(),
  gitShowCommit: vi.fn(),
  gitRemoteUrl: vi.fn(),
  gitFetch: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  gitPublish: vi.fn(),
  githubPullRequestBranchStatus: vi.fn(),
  createGithubPullRequest: vi.fn(),
  isGithubConnected: vi.fn(),
  openExternalUrl: vi.fn(),
  keepSessionChanges: vi.fn(),
  notifyReviewChanged: vi.fn(),
  notifyGitChanged: vi.fn(),
  invalidateProjectFiles: vi.fn(),
  invalidateWatchedFiles: vi.fn(),
  generateCommitMessage: vi.fn(),
  generatePrContent: vi.fn(),
}));

vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    gitResolveRepo: mocks.gitResolveRepo,
    gitStatus: mocks.gitStatus,
    gitDiff: mocks.gitDiff,
    gitCompareBranches: mocks.gitCompareBranches,
    gitShowCommit: mocks.gitShowCommit,
    gitRemoteUrl: mocks.gitRemoteUrl,
    gitFetch: mocks.gitFetch,
    gitCommit: mocks.gitCommit,
    gitPush: mocks.gitPush,
    gitPublish: mocks.gitPublish,
  },
}));
vi.mock("../lib/harness/textHarness", () => ({
  generateCommitMessage: mocks.generateCommitMessage,
  generatePrContent: mocks.generatePrContent,
}));
vi.mock("@/modules/git-review/lib/githubProvider", () => ({
  githubPullRequestBranchStatus: mocks.githubPullRequestBranchStatus,
  createGithubPullRequest: mocks.createGithubPullRequest,
  isGithubConnected: mocks.isGithubConnected,
}));
vi.mock("@/lib/external-link", () => ({
  openExternalUrl: mocks.openExternalUrl,
}));
vi.mock("../lib/checkpoint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/checkpoint")>()),
  keepSessionChanges: mocks.keepSessionChanges,
  notifyReviewChanged: mocks.notifyReviewChanged,
}));
vi.mock("../lib/fileIndex", () => ({
  invalidateProjectFiles: mocks.invalidateProjectFiles,
}));
vi.mock("../lib/fileWatch", () => ({
  invalidateWatchedFiles: mocks.invalidateWatchedFiles,
}));
vi.mock("../lib/fs", () => ({ notifyGitChanged: mocks.notifyGitChanged }));

let container: HTMLDivElement;
let root: Root;
const originalLanguage = usePreferencesStore.getState().language;
const originalWorkspace = useWorkspaceEnvStore.getState().env;

const files: CheckpointFile[] = [
  {
    path: "/repo/src/a.ts",
    relative: "src/a.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    exact: true,
    undoable: true,
  },
  {
    path: "/repo/src/b.ts",
    relative: "src/b.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    exact: true,
    undoable: true,
  },
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  usePreferencesStore.setState({ language: "en" });
  mocks.gitResolveRepo.mockResolvedValue({
    repoRoot: "/repo",
    branch: "main",
    upstream: null,
    isDetached: false,
  });
  mocks.gitCommit.mockResolvedValue({
    commitSha: "abcdef123456",
    summary: "Update session changes",
  });
  mocks.gitStatus.mockResolvedValue({
    repoRoot: "/repo",
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: [],
  });
  mocks.gitDiff.mockImplementation(
    async (_repoRoot: string, path: string, staged: boolean) => ({
      diffText: `${staged ? "staged" : "working"}: ${path}`,
      truncated: false,
    }),
  );
  mocks.generateCommitMessage.mockResolvedValue("feat: update selected files");
  mocks.generatePrContent.mockResolvedValue(null);
  mocks.gitCompareBranches.mockResolvedValue({
    ahead: [
      {
        sha: "abcdef1234567890",
        shortSha: "abcdef1",
        author: "A. Developer",
        authorEmail: "dev@example.com",
        timestampSecs: 1,
        parents: [],
        subject: "Update session changes",
        filesChanged: 1,
        insertions: 2,
        deletions: 0,
      },
      {
        sha: "123456abcdef7890",
        shortSha: "123456a",
        author: "A. Developer",
        authorEmail: "dev@example.com",
        timestampSecs: 2,
        parents: [],
        subject: "Polish session changes",
        filesChanged: 1,
        insertions: 1,
        deletions: 0,
      },
    ],
    behind: [],
    files: [
      {
        path: "src/a.ts",
        originalPath: null,
        status: "M",
        statusLabel: "Modified",
        added: 3,
        removed: 0,
        isBinary: false,
      },
    ],
  });
  mocks.gitShowCommit.mockResolvedValue({
    diffText: "diff --git a/src/a.ts b/src/a.ts",
    truncated: false,
  });
  mocks.gitRemoteUrl.mockResolvedValue(null);
  mocks.gitFetch.mockResolvedValue(undefined);
  mocks.gitPush.mockResolvedValue({
    pushed: true,
    remote: "origin",
    branch: "feature",
  });
  mocks.gitPublish.mockResolvedValue({
    pushed: true,
    remote: "origin",
    branch: "feature",
  });
  mocks.githubPullRequestBranchStatus.mockResolvedValue({
    defaultBranch: "main",
    pullRequest: null,
    aheadBy: 2,
    behindBy: 0,
  });
  mocks.generatePrContent.mockResolvedValue({
    title: "Improve session change handling",
    body: "## Summary\n- Improve handling",
    base: "main",
    head: "feature/session",
  });
  mocks.createGithubPullRequest.mockResolvedValue(
    "https://github.com/acme/widgets/pull/42",
  );
  mocks.isGithubConnected.mockResolvedValue(true);
  mocks.openExternalUrl.mockResolvedValue(undefined);
  mocks.keepSessionChanges.mockResolvedValue({ files: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  usePreferencesStore.setState({ language: originalLanguage });
  useWorkspaceEnvStore.setState({ env: originalWorkspace });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("commits only the checked session file and refreshes its checkpoint", async () => {
  const onNotice = vi.fn();
  await act(async () => {
    root.render(
      <SessionChangesCommit
        cwd="/repo"
        sessionId="session-a"
        files={files}
        onNotice={onNotice}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const checkboxes = container.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  expect(checkboxes).toHaveLength(2);
  await act(async () => checkboxes[0].click());

  const commitButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("Commit 1 file"),
  );
  expect(commitButton).toBeDefined();
  await act(async () => commitButton?.click());

  expect(mocks.gitCommit).toHaveBeenCalledWith(
    "/repo",
    "Update session changes",
    { kind: "local" },
    ["/repo/src/b.ts"],
  );
  expect(mocks.keepSessionChanges).toHaveBeenCalledWith(
    "session-a",
    "/repo",
    "src/b.ts",
  );
  expect(mocks.notifyReviewChanged).toHaveBeenCalledWith("session-a");
  expect(onNotice).toHaveBeenCalledWith({
    kind: "success",
    message: "Committed as abcdef1",
  });
});

it("lists project changes without selecting or checkpointing them by default", async () => {
  mocks.gitStatus.mockResolvedValue({
    repoRoot: "/repo",
    branch: "main",
    upstream: null,
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: [
      {
        path: "src/a.ts",
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
        path: "src/b.ts",
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
  });

  await act(async () => {
    root.render(
      <SessionChangesCommit
        cwd="/repo"
        sessionId="session-a"
        files={[files[0], { ...files[1], exact: false }]}
        onNotice={vi.fn()}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const checkboxes = container.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  expect(checkboxes).toHaveLength(3);
  expect(checkboxes[0].checked).toBe(true);
  expect(checkboxes[1].checked).toBe(false);
  expect(checkboxes[1].disabled).toBe(true);
  expect(container.textContent).toContain("README.md");

  await act(async () => checkboxes[2].click());
  const commitButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("Commit 2 files"),
  );
  await act(async () => commitButton?.click());

  expect(mocks.gitCommit).toHaveBeenCalledWith(
    "/repo",
    "Update session changes",
    { kind: "local" },
    ["/repo/src/a.ts", "/repo/README.md"],
  );
  expect(mocks.keepSessionChanges).toHaveBeenCalledTimes(1);
  expect(mocks.keepSessionChanges).toHaveBeenCalledWith(
    "session-a",
    "/repo",
    "src/a.ts",
  );
});

it("blocks scoped commits when the native Git status is truncated", async () => {
  mocks.gitStatus.mockResolvedValue({
    repoRoot: "/repo",
    branch: "main",
    upstream: null,
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: true,
    changedFiles: [],
  });

  await act(async () => {
    root.render(
      <SessionChangesCommit
        cwd="/repo"
        sessionId="session-a"
        files={[files[0]]}
        onNotice={vi.fn()}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const commitButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("Commit 1 file"),
  );
  expect(commitButton?.disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "incomplete",
  );
  expect(mocks.gitCommit).not.toHaveBeenCalled();
});

it("generates a commit message from selected diffs through the active remote workspace", async () => {
  const sshWorkspace = {
    kind: "ssh" as const,
    connection: { id: "server-1", name: "Build", host: "build.example" },
    root: "/repo",
    sessionId: 17,
  };
  useWorkspaceEnvStore.setState({ env: sshWorkspace });
  mocks.gitStatus.mockResolvedValue({
    repoRoot: "/repo",
    branch: "feature/session",
    upstream: null,
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: [],
  });

  await act(async () => {
    root.render(
      <SessionChangesCommit
        cwd="/repo"
        sessionId="session-a"
        harness="codex"
        files={files}
        onNotice={vi.fn()}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const generateButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("Generate with AI"),
  );
  expect(generateButton).toBeDefined();
  await act(async () => {
    generateButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(mocks.gitDiff).toHaveBeenCalledWith(
    "/repo",
    "/repo/src/a.ts",
    true,
    sshWorkspace,
  );
  expect(mocks.gitDiff).toHaveBeenCalledWith(
    "/repo",
    "/repo/src/a.ts",
    false,
    sshWorkspace,
  );
  expect(mocks.gitDiff).toHaveBeenCalledTimes(4);
  expect(mocks.generateCommitMessage).toHaveBeenCalledWith(
    ".",
    "codex",
    expect.any(AbortSignal),
    expect.objectContaining({
      branch: "feature/session",
      summary: expect.stringContaining("src/a.ts"),
      patch: expect.stringContaining("src/a.ts (staged)"),
    }),
  );
  expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
    "feat: update selected files",
  );
});

it("commits, publishes through the native workspace, and opens the pull request", async () => {
  const sshWorkspace = {
    kind: "ssh" as const,
    connection: { id: "server-1", name: "Build", host: "build.example" },
    root: "/repo",
    sessionId: 17,
  };
  useWorkspaceEnvStore.setState({ env: sshWorkspace });
  mocks.gitStatus.mockResolvedValue({
    repoRoot: "/repo",
    branch: "feature/session",
    upstream: null,
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: [],
  });
  mocks.gitRemoteUrl.mockResolvedValue("git@github.com:acme/widgets.git");

  const onNotice = vi.fn();
  await act(async () => {
    root.render(
      <SessionChangesCommit
        cwd="/repo"
        sessionId="session-a"
        harness="codex"
        files={files}
        onNotice={onNotice}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const createButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("Commit, Push & Create PR"),
  );
  expect(createButton).toBeDefined();
  await act(async () => {
    createButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(mocks.gitCommit).toHaveBeenCalledWith(
    "/repo",
    "Update session changes",
    sshWorkspace,
    ["/repo/src/a.ts", "/repo/src/b.ts"],
  );
  expect(mocks.gitStatus).toHaveBeenCalledWith("/repo", sshWorkspace);
  expect(mocks.gitCompareBranches).toHaveBeenCalledWith(
    "/repo",
    "origin/main",
    "feature/session",
    sshWorkspace,
  );
  expect(mocks.gitShowCommit).toHaveBeenCalledTimes(2);
  expect(mocks.generatePrContent).toHaveBeenCalledWith(
    ".",
    "codex",
    expect.objectContaining({
      base: "main",
      head: "feature/session",
      commitSummary: expect.stringContaining("Update session changes"),
      diffPatch: expect.stringContaining("abcdef1 Update session changes"),
    }),
  );
  expect(mocks.gitPublish).toHaveBeenCalledWith("/repo", "origin", {
    ...sshWorkspace,
  });
  expect(mocks.gitFetch).toHaveBeenCalledWith("/repo", sshWorkspace);
  expect(mocks.githubPullRequestBranchStatus).toHaveBeenCalledWith(
    "acme/widgets",
    "feature/session",
  );
  expect(mocks.createGithubPullRequest).toHaveBeenCalledWith({
    ownerRepo: "acme/widgets",
    title: "Improve session change handling",
    body: "## Summary\n- Improve handling",
    base: "main",
    head: "feature/session",
  });
  expect(mocks.openExternalUrl).toHaveBeenCalledWith(
    "https://github.com/acme/widgets/pull/42",
  );
  expect(onNotice).toHaveBeenCalledWith({
    kind: "success",
    message: "Create PR: https://github.com/acme/widgets/pull/42",
  });
});

it("does not offer pull request creation while the branch is behind", async () => {
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
  mocks.gitStatus.mockResolvedValue({
    repoRoot: "/repo",
    branch: "feature/session",
    upstream: "origin/feature/session",
    ahead: 1,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: [],
  });
  mocks.gitRemoteUrl.mockResolvedValue("git@github.com:acme/widgets.git");
  mocks.githubPullRequestBranchStatus.mockResolvedValue({
    defaultBranch: "main",
    pullRequest: null,
    aheadBy: 2,
    behindBy: 1,
  });

  await act(async () => {
    root.render(
      <SessionChangesCommit
        cwd="/repo"
        sessionId="session-a"
        files={files}
        onNotice={vi.fn()}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(
    [...container.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Create PR"),
    ),
  ).toBe(false);
});

it("fetches before commit and rejects a branch that became behind", async () => {
  const freshStatus = {
    repoRoot: "/repo",
    branch: "feature/session",
    upstream: "origin/feature/session",
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: [],
  };
  mocks.gitStatus.mockResolvedValue(freshStatus);
  mocks.gitRemoteUrl.mockResolvedValue("https://github.com/acme/widgets.git");

  await act(async () => {
    root.render(
      <SessionChangesCommit
        cwd="/repo"
        sessionId="session-a"
        files={files}
        onNotice={vi.fn()}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  mocks.gitStatus
    .mockResolvedValueOnce(freshStatus)
    .mockResolvedValueOnce({ ...freshStatus, behind: 1 });

  const commitPushButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("Commit & Push"),
  );
  expect(commitPushButton).toBeDefined();
  await act(async () => {
    commitPushButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(mocks.gitFetch).toHaveBeenCalledWith("/repo", { kind: "local" });
  expect(mocks.gitCommit).not.toHaveBeenCalled();
});

it("keeps push available after the session changes have been committed", async () => {
  mocks.gitStatus.mockResolvedValue({
    repoRoot: "/repo",
    branch: "feature/session",
    upstream: "origin/feature/session",
    ahead: 1,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: [
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
  });
  mocks.gitRemoteUrl.mockResolvedValue("git@github.com:acme/widgets.git");
  mocks.isGithubConnected.mockResolvedValue(false);

  await act(async () => {
    root.render(
      <SessionChangesCommit
        cwd="/repo"
        sessionId="session-a"
        files={[]}
        onNotice={vi.fn()}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.textContent).toContain("README.md");
  expect(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.checked,
  ).toBe(false);
  const pushButton = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Push"),
  );
  expect(pushButton).toBeDefined();
  await act(async () => {
    pushButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mocks.gitPush).toHaveBeenCalledWith("/repo", { kind: "local" });
});
