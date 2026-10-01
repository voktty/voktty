import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QuickWorkspaceControls } from "./QuickWorkspaceControls";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@/modules/harness/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({
    settled: true,
    branches: { current: "main" },
  }),
}));

describe("QuickWorkspaceControls", () => {
  it("renders workspace mode and branch trigger buttons", () => {
    const markup = renderToStaticMarkup(
      createElement(QuickWorkspaceControls, {
        value: { cwd: "/repo", mode: "current" },
        enabled: true,
        onChange: vi.fn(),
        onOpenChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('aria-label="Workspace Current checkout"');
    expect(markup).toContain("Current checkout");
    expect(markup).toContain('aria-label="Choose branch"');
  });

  it("renders worktree mode with base branch trigger", () => {
    const markup = renderToStaticMarkup(
      createElement(QuickWorkspaceControls, {
        value: { cwd: "/repo", mode: "worktree", base: "develop" },
        enabled: true,
        onChange: vi.fn(),
        onOpenChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('aria-label="Workspace New worktree"');
    expect(markup).toContain("New worktree");
    expect(markup).toContain('aria-label="Create worktree from develop"');
  });
});
