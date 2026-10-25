// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceControlPanel } from "@/modules/source-control/SourceControlPanel";
import type { SourceControlSummary } from "@/modules/source-control/useSourceControl";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  checkout: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitListBranches: mocks.list, gitCheckoutBranch: mocks.checkout },
}));
vi.mock("@/modules/ai/lib/runtimeAvailability", () => ({
  useAiAvailable: () => false,
  isAiRuntimeAvailable: () => false,
}));
vi.mock("@/modules/source-control/ConflictsPanel", () => ({
  ConflictsPanel: () => null,
}));
vi.mock("@/modules/source-control/BranchCompareDialog", () => ({
  BranchCompareDialog: () => null,
}));
vi.mock("@/modules/source-control/GitStashAndTags", () => ({
  StashDropdown: () => null,
  TagDropdown: () => null,
}));
vi.mock("@/modules/source-control/GitCloneModal", () => ({
  GitCloneModal: () => null,
}));
let root: Root;
let container: HTMLDivElement;
const refresh = vi.fn(async () => {});
function summary(path: string): SourceControlSummary {
  const repo = {
    repoRoot: path,
    branch: "main",
    upstream: null,
    isDetached: false,
  };
  return {
    contextPath: path,
    repo,
    status: {
      ...repo,
      ahead: 0,
      behind: 0,
      truncated: false,
      changedFiles: [],
    },
    changedCount: 0,
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
    refresh,
    trustRepository: vi.fn(async () => true),
    initRepository: vi.fn(async () => true),
    undoCommit: vi.fn(async () => true),
    runRemoteAction: vi.fn(async () => ({ ok: false, action: null })),
  };
}
async function render(path = "/project") {
  await act(async () =>
    root.render(
      <SourceControlPanel
        open
        sourceControl={summary(path)}
        onOpenDiff={() => {}}
        repositoryTarget={{ mode: "follow-context" }}
        onFollowRepositoryContext={() => {}}
      />,
    ),
  );
}
async function checkout() {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[title="/project"]',
  );
  expect(trigger).not.toBeNull();
  await act(async () =>
    trigger?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((element) => element.textContent === "feature");
  expect(item).toBeDefined();
  await act(async () => item?.click());
  expect(mocks.checkout).toHaveBeenCalledOnce();
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.list.mockReset().mockResolvedValue({
    branches: [
      {
        name: "feature",
        kind: "local",
        worktreePath: null,
        isHead: false,
        isDetached: false,
      },
    ],
  });
  mocks.checkout.mockReset();
  mocks.error.mockReset();
  refresh.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("does not report a checkout failure after its panel unmounts", async () => {
  let fail!: (error: Error) => void;
  mocks.checkout.mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  await render();
  await checkout();
  await act(async () => root.render(null));
  await act(async () => fail(new Error("Retired checkout")));
  expect(mocks.error).not.toHaveBeenCalled();
});
it("does not lend an old checkout's busy state to the successor repository", async () => {
  let done!: () => void;
  mocks.checkout.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  await render();
  await checkout();
  await render("/successor");
  expect(
    container.querySelector<HTMLButtonElement>('button[title="/successor"]')
      ?.disabled,
  ).toBe(false);
  await act(async () => done());
  expect(refresh).not.toHaveBeenCalled();
});
