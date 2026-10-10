// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { CheckpointFile } from "../lib/checkpoint";
import { SessionChangesCommit } from "./SessionChangesCommit";

const mocks = vi.hoisted(() => ({
  gitResolveRepo: vi.fn(),
  gitCommit: vi.fn(),
  keepSessionChanges: vi.fn(),
  notifyReviewChanged: vi.fn(),
  notifyGitChanged: vi.fn(),
  invalidateProjectFiles: vi.fn(),
  invalidateWatchedFiles: vi.fn(),
}));

vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    gitResolveRepo: mocks.gitResolveRepo,
    gitCommit: mocks.gitCommit,
  },
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
  mocks.keepSessionChanges.mockResolvedValue({ files: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  usePreferencesStore.setState({ language: originalLanguage });
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
