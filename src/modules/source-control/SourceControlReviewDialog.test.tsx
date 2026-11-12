// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceControlReviewDialog } from "@/modules/source-control/SourceControlReviewDialog";
import type { GitDiffPane } from "@/modules/editor/GitDiffPane";
import type { SourceControlSummary } from "@/modules/source-control/useSourceControl";
import type { WorkspaceEnv } from "@/modules/workspace";

type PaneProps = ComponentProps<typeof GitDiffPane>;
const panes = vi.hoisted(() => [] as PaneProps[]);
vi.mock("@/modules/editor/GitDiffPane", () => ({
  GitDiffPane: (props: PaneProps) => {
    panes.push(props);
    return <div data-diff-path={props.source.path} />;
  },
}));
vi.mock("@/components/ui/dialog", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Box,
    DialogContent: Box,
    DialogDescription: Box,
    DialogHeader: Box,
    DialogTitle: Box,
  };
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  panes.length = 0;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function summary(repoRoot: string): SourceControlSummary {
  const repo = { repoRoot, branch: "main", upstream: null, isDetached: false };
  return {
    contextPath: repoRoot,
    repo,
    status: {
      ...repo,
      ahead: 0,
      behind: 0,
      truncated: false,
      changedFiles: ["first.ts", "second.ts"].map((path) => ({
        path,
        originalPath: null,
        indexStatus: " ",
        worktreeStatus: "M",
        staged: false,
        unstaged: true,
        untracked: false,
        conflicted: false,
        statusLabel: "Modified",
      })),
    },
    changedCount: 2,
    upstream: null,
    ahead: 0,
    behind: 0,
    hasRepo: true,
    isLoading: false,
    localError: null,
    dubiousOwnershipPath: null,
    busyAction: null,
    lastRemoteError: null,
    applyStatus: vi.fn(),
    refresh: vi.fn(async () => {}),
    trustRepository: vi.fn(async () => true),
    initRepository: vi.fn(async () => true),
    undoCommit: vi.fn(async () => true),
    runRemoteAction: vi.fn(async () => ({ ok: false, action: null })),
  };
}

it.each([
  { repoRoot: "/work/repo", workspaceEnv: { kind: "local" } as WorkspaceEnv },
  {
    repoRoot: "remote://voktty-ssh-build/work/repo",
    workspaceEnv: { kind: "local" } as WorkspaceEnv,
  },
  {
    repoRoot: "/work/repo",
    workspaceEnv: {
      kind: "ssh",
      root: "/work/repo",
      connection: { id: "build", name: "Build", host: "build.example" },
    } as WorkspaceEnv,
  },
])("keeps the review queue and diff on the captured target $repoRoot", async ({ repoRoot, workspaceEnv }) => {
  const sourceControl = summary(repoRoot);
  const dirtyPaths = [`${repoRoot}/first.ts`];
  await act(async () => root.render(
    <SourceControlReviewDialog
      repoRoot={repoRoot}
      workspaceEnv={workspaceEnv}
      sourceControl={sourceControl}
      dirtyPaths={dirtyPaths}
      onClose={() => {}}
    />,
  ));
  const first = panes[panes.length - 1];
  expect(first.source).toMatchObject({ kind: "working", repoRoot, path: "first.ts", workspaceEnv });
  expect(first.review).toMatchObject({ sourceControl, dirtyPaths, workspaceEnv });
  await act(async () => first.review?.onOpenDiff({ repoRoot, path: "second.ts", mode: "-", originalPath: null }));
  expect(panes[panes.length - 1].source).toMatchObject({ repoRoot, path: "second.ts", workspaceEnv });
  const current = panes[panes.length - 1];
  await act(async () => current.review?.onOpenDiff({ repoRoot: "/other", path: "first.ts", mode: "-", originalPath: null }));
  expect(container.querySelector("[data-diff-path]")?.getAttribute("data-diff-path")).toBe("second.ts");
});

it("shows the clean state without opening a diff reader", async () => {
  const sourceControl = summary("/repo");
  sourceControl.status!.changedFiles = [];
  await act(async () => root.render(
    <SourceControlReviewDialog
      repoRoot="/repo"
      workspaceEnv={{ kind: "local" }}
      sourceControl={sourceControl}
      dirtyPaths={[]}
      onClose={() => {}}
    />,
  ));
  expect(panes).toHaveLength(0);
  expect(container.textContent).not.toBe("");
});
