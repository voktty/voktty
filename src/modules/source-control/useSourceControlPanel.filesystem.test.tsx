// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSourceControlPanel } from "@/modules/source-control/useSourceControlPanel";
import type { SourceControlSummary } from "@/modules/source-control/useSourceControl";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({ stage: vi.fn(), unstage: vi.fn() }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitStage: mocks.stage, gitUnstage: mocks.unstage },
}));
let root: Root;
let panel: ReturnType<typeof useSourceControlPanel>;
const previousEnv = useWorkspaceEnvStore.getState().env;
const environments: WorkspaceEnv[] = [
  { kind: "local" },
  { kind: "wsl", distro: "Ubuntu" },
  {
    kind: "ssh",
    root: "/project",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  },
  {
    kind: "docker",
    connection: {
      containerId: "container",
      containerName: "Build",
      image: "dev",
    },
  },
];
function summary(staged: boolean): SourceControlSummary {
  return {
    contextPath: "/project",
    repo: {
      repoRoot: "/project",
      branch: "main",
      upstream: null,
      isDetached: false,
    },
    status: {
      repoRoot: "/project",
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles: [
        {
          path: "src/file.ts",
          originalPath: null,
          indexStatus: staged ? "M" : " ",
          worktreeStatus: staged ? " " : "M",
          staged,
          unstaged: !staged,
          untracked: false,
          conflicted: false,
          statusLabel: "Modified",
        },
      ],
    },
    changedCount: 1,
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
    trustRepository: vi.fn(async () => {}),
    initRepository: vi.fn(async () => {}),
    undoCommit: vi.fn(async () => {}),
    runRemoteAction: vi.fn(async () => ({ ok: false, action: null })),
  };
}
function Probe({ value }: { value: SourceControlSummary }) {
  panel = useSourceControlPanel(true, value, null);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.stage.mockReset().mockResolvedValue(undefined);
  mocks.unstage.mockReset().mockResolvedValue(undefined);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  useWorkspaceEnvStore.setState({ env: previousEnv });
  vi.unstubAllGlobals();
});
it.each(environments)(
  "routes file checkbox staging through $kind",
  async (env) => {
    useWorkspaceEnvStore.setState({ env });
    await act(async () => root.render(<Probe value={summary(false)} />));
    await act(async () => panel.toggleStageFile(panel.fileEntries[0]));
    expect(mocks.stage).toHaveBeenCalledExactlyOnceWith(
      "/project",
      ["src/file.ts"],
      env,
    );
    expect(mocks.unstage).not.toHaveBeenCalled();
  },
);
it.each(environments)(
  "routes file checkbox unstaging through $kind",
  async (env) => {
    useWorkspaceEnvStore.setState({ env });
    await act(async () => root.render(<Probe value={summary(true)} />));
    await act(async () => panel.toggleStageFile(panel.fileEntries[0]));
    expect(mocks.unstage).toHaveBeenCalledExactlyOnceWith(
      "/project",
      ["src/file.ts"],
      env,
    );
    expect(mocks.stage).not.toHaveBeenCalled();
  },
);
it("refreshes the checkbox destination when only the filesystem changes", async () => {
  const value = summary(false);
  useWorkspaceEnvStore.setState({ env: environments[0] });
  await act(async () => root.render(<Probe value={value} />));
  await act(async () => panel.toggleStageFile(panel.fileEntries[0]));
  await act(async () =>
    useWorkspaceEnvStore.setState({ env: environments[2] }),
  );
  await act(async () => panel.toggleStageFile(panel.fileEntries[0]));
  expect(mocks.stage).toHaveBeenLastCalledWith(
    "/project",
    ["src/file.ts"],
    environments[2],
  );
  expect(mocks.stage).toHaveBeenCalledTimes(2);
});
