// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UnifiedDiffView } from "@/modules/harness/surfaces/UnifiedDiffView";
import { SessionChangesDiff } from "@/modules/harness/surfaces/SessionChangesDiff";
import type { ExplorerMenuItem } from "@/modules/harness/chrome/ExplorerMenu";
import { planCommitHistoryOpen, type Tab } from "@/modules/tabs/lib/useTabs";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  diff: vi.fn(),
  pick: (_action: string) => {},
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@/modules/harness/surfaces/syntaxTokens", () => ({
  highlightDiffFile: async () => null,
}));
vi.mock("@/modules/harness/hooks/useColorScheme", () => ({
  useColorScheme: () => "dark",
}));
vi.mock("@/modules/harness/lib/checkpoint", () => ({
  sessionCheckpointStatus: mocks.status,
  sessionCheckpointFileDiff: mocks.diff,
  subscribeReviewChanged: () => () => {},
}));
vi.mock("@/modules/harness/surfaces/SessionChangesCommit", () => ({
  SessionChangesCommit: () => null,
}));
vi.mock("@/modules/harness/chrome/ExplorerMenu", () => ({
  ExplorerMenu: ({
    items,
    onPick,
  }: {
    items: ExplorerMenuItem[];
    onPick: (action: string) => void;
  }) => {
    mocks.pick = onPick;
    const history = items.find(
      (item) => item.kind === "item" && item.id === "open-git-history",
    );
    if (history?.kind !== "item") throw new Error("Missing history action");
    return (
      <button
        type="button"
        data-history
        disabled={history.disabled}
        title={history.description}
        onClick={() => onPick("open-git-history")}
      >
        {history.label}
        <span>{history.description}</span>
      </button>
    );
  },
}));

const files = [
  {
    id: "file.ts",
    path: "file.ts",
    label: "file.ts",
    additions: 1,
    deletions: 1,
    blocks: [],
  },
];
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/project",
  sessionId: 7,
  connection: { id: "build", name: "Build", host: "build.example" },
};
const wsl: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
let node: HTMLDivElement;
let root: Root;
let requests: {
  repoRoot?: string;
  workspaceEnv?: WorkspaceEnv;
  branch?: string;
}[];
let tabs: Tab[];
let nextId: number;
const originalWorkspace = useWorkspaceEnvStore.getState().env;
const originalLanguage = usePreferencesStore.getState().language;
const receive = (event: Event) => {
  const input = (event as CustomEvent<(typeof requests)[number]>).detail;
  requests.push(input);
  if (input.repoRoot)
    tabs = planCommitHistoryOpen(
      tabs,
      { ...input, repoRoot: input.repoRoot },
      "main",
      () => nextId++,
    ).tabs;
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  usePreferencesStore.setState({ language: "en" });
  useWorkspaceEnvStore.setState({ env: wsl });
  requests = [];
  tabs = [];
  nextId = 1;
  mocks.status.mockReset().mockResolvedValue({
    files: [
      {
        path: "/session/project/file.ts",
        relative: "file.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        exact: true,
        undoable: true,
      },
    ],
  });
  mocks.diff.mockReset().mockResolvedValue({
    binary: false,
    tooLarge: false,
    original: "old\n",
    current: "new\n",
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  window.addEventListener("voktty:open-git-graph", receive);
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.removeEventListener("voktty:open-git-graph", receive);
  node.remove();
  useWorkspaceEnvStore.setState({ env: originalWorkspace });
  usePreferencesStore.setState({ language: originalLanguage });
  vi.unstubAllGlobals();
});
async function render(
  repoRoot?: string,
  workspaceEnv?: WorkspaceEnv,
  onOpenGitHistory?: (path?: string) => void,
) {
  await act(async () =>
    root.render(
      <UnifiedDiffView
        files={files}
        repoRoot={repoRoot}
        workspaceEnv={workspaceEnv}
        onOpenGitHistory={onOpenGitHistory}
      />,
    ),
  );
}
async function menu() {
  const target = [...node.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("file.ts"),
  );
  if (!target) throw new Error("Missing file header");
  await act(async () =>
    target.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    ),
  );
}
function historyButton() {
  const button = node.querySelector<HTMLButtonElement>("[data-history]");
  if (!button) throw new Error("Missing history menu");
  return button;
}
it.each<[string, WorkspaceEnv, WorkspaceEnv]>([
  ["/project", LOCAL_WORKSPACE, wsl],
  ["/project", wsl, LOCAL_WORKSPACE],
  ["/project", ssh, wsl],
  ["C:/project", LOCAL_WORKSPACE, ssh],
  ["//server/share/project", LOCAL_WORKSPACE, wsl],
  ["remote://voktty-ssh-build/project", LOCAL_WORKSPACE, wsl],
])(
  "opens history with the diff's own filesystem rather than the selected workspace: %s",
  async (repoRoot, workspaceEnv, ambient) => {
    useWorkspaceEnvStore.setState({ env: ambient });
    await render(repoRoot, workspaceEnv);
    await menu();
    await act(async () => historyButton().click());
    expect(requests).toEqual([{ repoRoot, workspaceEnv, branch: undefined }]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      kind: "git-history",
      repoRoot,
      workspaceEnv,
    });
    expect(useWorkspaceEnvStore.getState().env).toBe(ambient);
  },
);
it("keeps the implicit native diff filesystem explicit at the event boundary", async () => {
  await render("/native");
  await menu();
  await act(async () => historyButton().click());
  expect(tabs[0]).toMatchObject({
    repoRoot: "/native",
    workspaceEnv: LOCAL_WORKSPACE,
  });
});
it.each([undefined, "", "   "])(
  "disables rootless history with a reason and refuses forced delivery: %s",
  async (repoRoot) => {
    await render(repoRoot);
    await menu();
    expect(historyButton().disabled).toBe(true);
    expect(historyButton().title).toBeTruthy();
    await act(async () => mocks.pick("open-git-history"));
    expect(requests).toEqual([]);
    expect(tabs).toEqual([]);
  },
);
it("preserves an explicit history callback without requiring a generic project root", async () => {
  const open = vi.fn();
  await render(undefined, ssh, open);
  await menu();
  expect(historyButton().disabled).toBe(false);
  await act(async () => historyButton().click());
  expect(open).toHaveBeenCalledExactlyOnceWith("file.ts");
  expect(requests).toEqual([]);
});
it.each(["root", "filesystem"])(
  "retires an open history menu on %s replacement",
  async (change) => {
    await render("/project", LOCAL_WORKSPACE);
    await menu();
    await render(
      change === "root" ? "/replacement" : "/project",
      change === "filesystem" ? ssh : LOCAL_WORKSPACE,
    );
    expect(node.querySelector("[data-history]")).toBeNull();
    expect(requests).toEqual([]);
  },
);
it("carries the checkpoint session's folder into history rather than borrowing Explorer's repository", async () => {
  await act(async () =>
    root.render(
      <SessionChangesDiff sessionId="session" cwd="/session/project" />,
    ),
  );
  await menu();
  await act(async () => historyButton().click());
  expect(requests).toEqual([
    {
      repoRoot: "/session/project",
      workspaceEnv: LOCAL_WORKSPACE,
      branch: undefined,
    },
  ]);
  expect(tabs[0]).toMatchObject({
    repoRoot: "/session/project",
    workspaceEnv: LOCAL_WORKSPACE,
  });
});
