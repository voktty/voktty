import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  assertWorktreeFilesClosed,
  detachSessionWorktree,
  namedWorktreeBranch,
  orchestrationWorktreeBranchName,
  temporaryWorktreeBranchName,
  worktreeSessionIds,
  type Worktree,
} from "../lib/worktrees";
import { sessionInWorktree } from "../lib/sessionWorktrees";
import { newFileTab, newTerminalFile } from "../lib/layout";
import { newSession, type Session } from "../lib/session";
import { CreateWorktreeDialog } from "../chrome/CreateWorktreeDialog";
import { DeleteWorktreeDialog } from "../chrome/DeleteWorktreeDialog";
import { WorktreePicker } from "../chrome/WorktreePicker";
import { WorktreesPage } from "./WorktreesPage";

const sampleTree: Worktree = {
  path: "/repo-worktrees/feature",
  branch: "feature",
  head: "abc1234",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: true,
  unpushed: 2,
  sessionIds: ["session-1"],
};

describe("worktree model & helpers", () => {
  it("builds temporary and generated worktree branch names", () => {
    expect(
      temporaryWorktreeBranchName("12345678-90ab-cdef-1234-567890abcdef"),
    ).toBe("mc/12345678");
    expect(namedWorktreeBranch("feature/faster-worktrees")).toBe(
      "mc/feature/faster-worktrees",
    );
    expect(namedWorktreeBranch("monocode/already-prefixed")).toBe(
      "mc/already-prefixed",
    );
    expect(namedWorktreeBranch("mc/already-short")).toBe("mc/already-short");
    expect(namedWorktreeBranch("  ")).toBeNull();
    expect(orchestrationWorktreeBranchName("orch-1234567890ab")).toContain(
      "mc/orch-",
    );
  });

  it("checks open worktree files and throws when tab is active in worktree", () => {
    const fileTab = newFileTab(
      "/repo-worktrees/feature/index.ts",
      "/repo-worktrees/feature",
    );
    expect(() =>
      assertWorktreeFilesClosed("/repo-worktrees/feature", [fileTab]),
    ).toThrow("Close the files and terminals open in this worktree first.");

    const terminalTab = newTerminalFile("/repo-worktrees/feature");
    expect(() =>
      assertWorktreeFilesClosed("/repo-worktrees/feature", [terminalTab]),
    ).toThrow("Close the files and terminals open in this worktree first.");

    const outsideTab = newFileTab("/repo/other.ts", "/repo");
    expect(() =>
      assertWorktreeFilesClosed("/repo-worktrees/feature", [outsideTab]),
    ).not.toThrow();
  });

  it("aggregates session IDs matched to worktrees", () => {
    const sessions = [
      {
        id: "session-1",
        cwd: "/repo-worktrees/feature",
        worktreeCwd: undefined,
        worktreeRemoved: false,
      },
      {
        id: "session-2",
        cwd: "/repo",
        worktreeCwd: "/repo-worktrees/feature",
        worktreeRemoved: false,
      },
      {
        id: "session-3",
        cwd: "/repo",
        worktreeCwd: "/repo-worktrees/other",
        worktreeRemoved: false,
      },
      {
        id: "session-4",
        cwd: "/repo-worktrees/feature",
        worktreeCwd: undefined,
        worktreeRemoved: true,
      },
    ];

    const ids = worktreeSessionIds(sampleTree, sessions);
    expect(ids).toContain("session-1");
    expect(ids).toContain("session-2");
    expect(ids).not.toContain("session-3");
    expect(ids).not.toContain("session-4");
  });

  it("detaches session worktree cleanly when worktree is deleted", () => {
    const session: Session = {
      ...newSession("claude", "/repo-worktrees/feature"),
      worktreeCwd: "/repo-worktrees/feature",
      branch: "feature",
      providerSessionId: "ps-1",
    };

    const detached = detachSessionWorktree(
      session,
      "/repo",
      "/repo-worktrees/feature",
    );
    expect(detached.cwd).toBe("/repo");
    expect(detached.worktreeRemoved).toBe(true);
    expect(detached.branch).toBeUndefined();
    expect(detached.providerSessionId).toBeUndefined();
    expect(detached.queueStatus).toBe("paused");
  });

  it("attaches session to target worktree", () => {
    const session: Session = {
      ...newSession("claude", "/repo"),
      worktreeRemoved: true,
      blocks: [{ id: "m1", role: "user", text: "Fix the bug" }],
    };

    const updated = sessionInWorktree(session, sampleTree);
    expect(updated.worktreeRemoved).toBeUndefined();
    expect(updated.worktreeCwd).toBe(sampleTree.path);
    expect(updated.branch).toBe(sampleTree.branch);
  });
});

describe("CreateWorktreeDialog", () => {
  it("renders creation dialog with branch selection and submit action", () => {
    const markup = renderToStaticMarkup(
      createElement(CreateWorktreeDialog, {
        cwd: "/repo",
        baseCwd: "/repo",
        defaultRoot: "/repo-worktrees",
        onCreated: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(markup).toContain("Create worktree");
    expect(markup).toContain("An independent working copy of");
    expect(markup).toContain("Branch");
    expect(markup).toContain("New branch name");
    expect(markup).toContain("Start from");
    expect(markup).toContain("Created in");
    expect(markup).toContain("/repo-worktrees");
    expect(markup).toContain("Cancel");
  });
});

describe("DeleteWorktreeDialog", () => {
  it("renders delete dialog with consequences for uncommitted changes and unpushed commits", () => {
    const markup = renderToStaticMarkup(
      createElement(DeleteWorktreeDialog, {
        cwd: "/repo",
        tree: sampleTree,
        sessionCount: 2,
        onRemove: vi.fn(),
        onClose: vi.fn(),
        onDeleted: vi.fn(),
      }),
    );

    expect(markup).toContain("Delete worktree?");
    expect(markup).toContain("This permanently deletes the working copy");
    expect(markup).toContain("/repo-worktrees/feature");
    expect(markup).toContain("2 sessions using this worktree are kept.");
    expect(markup).toContain(
      "All uncommitted and untracked changes here are discarded.",
    );
    expect(markup).toContain("branch and its commits are kept.");
    expect(markup).toContain("feature");
    expect(markup).toContain("2 commits are not on a remote.");
    expect(markup).toContain("Also delete associated sessions");
    expect(markup).toContain("Delete worktree");
  });
});

describe("WorktreePicker", () => {
  it("renders trigger with working copy branch info", () => {
    const markup = renderToStaticMarkup(
      createElement(WorktreePicker, {
        cwd: "/repo",
        executionCwd: "/repo",
        onSelect: vi.fn(),
      }),
    );

    expect(markup).toContain('aria-label="Choose working copy"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="false"');
  });

  it("indicates worktree mode when execution cwd is inside worktree", () => {
    const markup = renderToStaticMarkup(
      createElement(WorktreePicker, {
        cwd: "/repo",
        executionCwd: "/repo-worktrees/feature",
        onSelect: vi.fn(),
      }),
    );

    expect(markup).toContain("Worktree");
  });
});

describe("WorktreesPage", () => {
  it("renders worktree management container and project picker", () => {
    const markup = renderToStaticMarkup(
      createElement(WorktreesPage, {
        cwd: "/repo",
        recents: [{ path: "/repo", openedAt: Date.now() }],
        onRemove: vi.fn(),
      }),
    );

    expect(markup).toContain('data-setting-id="project-worktrees"');
    expect(markup).toContain('id="setting-project-worktrees"');
    expect(markup).toContain("Create worktree");
    expect(markup).toContain("Refresh");
    expect(markup).toContain("Sessions can share a worktree");
  });
});
