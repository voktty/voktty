// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GitReviewTab } from "@/modules/notes-board/components/GitReviewTab";
import type { ExplorerMenuItem } from "@/modules/harness/chrome/ExplorerMenu";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  root: "/project",
  path: "file.ts",
  windows: false,
  open: vi.fn(async () => {}),
  reveal: vi.fn(async () => {}),
  copy: vi.fn(async () => {}),
  pick: (_action: string) => {},
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: mocks.open }));
vi.mock("@/modules/harness/lib/fs", () => ({
  basename: (path: string) => path.split(/[/\\]/).pop(),
  revealPath: mocks.reveal,
}));
vi.mock("@/modules/harness/lib/clipboard", () => ({ copyText: mocks.copy }));
vi.mock("@/modules/harness/lib/platform", () => ({
  get IS_WIN() {
    return mocks.windows;
  },
  IS_MAC: false,
}));
vi.mock("@/modules/editor/GitDiffPane", () => ({ GitDiffPane: () => null }));
vi.mock("@/modules/source-control/useSourceControl", () => ({
  useSourceControl: () => ({
    hasRepo: true,
    status: {
      repoRoot: mocks.root,
      branch: "main",
      changedFiles: [
        {
          path: mocks.path,
          originalPath: null,
          indexStatus: " ",
          worktreeStatus: "M",
          staged: false,
          unstaged: true,
          untracked: false,
          statusLabel: "Modified",
        },
      ],
    },
  }),
}));
vi.mock("@/modules/git-review", () => {
  const state = {
    overviews: {},
    comments: {},
    loadOverview: async () => {},
    loadComments: async () => {},
    markFile: async () => {},
  };
  return {
    EMPTY_COMMENTS: [],
    GitHubReviewDialog: () => null,
    GitWalkthroughDialog: () => null,
    ReviewHandoffDialog: () => null,
    sessionKey: (path: string) => path,
    useGitReviewStore: (select: (value: typeof state) => unknown) =>
      select(state),
  };
});
vi.mock("@/modules/harness/chrome/ExplorerMenu", () => ({
  ExplorerMenu: ({
    items,
    onPick,
  }: {
    items: ExplorerMenuItem[];
    onPick: (action: string) => void;
  }) => {
    mocks.pick = onPick;
    return (
      <>
        {items.map((item) =>
          item.kind === "item" ? (
            <button
              key={item.id}
              type="button"
              data-action={item.id}
              disabled={item.disabled}
              title={item.description}
              onClick={() => onPick(item.id)}
            >
              {item.label}
            </button>
          ) : null,
        )}
      </>
    );
  },
}));
let node: HTMLDivElement;
let root: Root;
const originalWorkspace = useWorkspaceEnvStore.getState().env;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.root = "/project";
  mocks.path = "file.ts";
  mocks.windows = false;
  mocks.open.mockClear();
  mocks.reveal.mockClear();
  mocks.copy.mockClear();
  useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  useWorkspaceEnvStore.setState({ env: originalWorkspace });
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<GitReviewTab cwd={mocks.root} />));
}
async function menu() {
  const target = [...node.querySelectorAll<HTMLElement>("[title]")].find(
    (element) => element.title === mocks.path,
  );
  if (!target) throw new Error("Missing review file");
  await act(async () =>
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })),
  );
}
const ssh: WorkspaceEnv = {
  kind: "ssh",
  root: "/project",
  connection: { id: "build", name: "Build", host: "build.example" },
};
it.each<[string, WorkspaceEnv]>([
  ["/project", ssh],
  ["/project", { kind: "wsl", distro: "Ubuntu" }],
  [
    "/project",
    {
      kind: "docker",
      connection: { containerId: "box", containerName: "box", image: "image" },
    },
  ],
  ["/project", { kind: "serial", portName: "COM1", baudRate: 9600 }],
  ["remote://host/project", LOCAL_WORKSPACE],
  ["", LOCAL_WORKSPACE],
])(
  "refuses native IO for the review filesystem: %s",
  async (path, workspace) => {
    mocks.root = path;
    useWorkspaceEnvStore.setState({ env: workspace });
    await render();
    for (const action of ["open-default", "reveal"]) {
      await menu();
      const button = node.querySelector<HTMLButtonElement>(
        `[data-action="${action}"]`,
      );
      expect(button?.disabled).toBe(true);
      expect(button?.title).toBeTruthy();
      await act(async () => mocks.pick(action));
    }
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.reveal).not.toHaveBeenCalled();
  },
);
it.each<[string, string, WorkspaceEnv, string]>([
  ["/project", "file.ts", LOCAL_WORKSPACE, "/project/file.ts"],
  ["C:/project", "file.ts", LOCAL_WORKSPACE, "C:/project/file.ts"],
  [
    "/other",
    "\\\\server\\share\\file.ts",
    LOCAL_WORKSPACE,
    "\\\\server\\share\\file.ts",
  ],
  [
    "/other",
    "\\\\wsl.localhost\\Ubuntu\\file.ts",
    { kind: "wsl", distro: "Ubuntu" },
    "\\\\wsl.localhost\\Ubuntu\\file.ts",
  ],
])(
  "preserves native file destinations: %s %s",
  async (repoRoot, path, workspace, expected) => {
    mocks.root = repoRoot;
    mocks.path = path;
    mocks.windows = !expected.startsWith("/");
    useWorkspaceEnvStore.setState({ env: workspace });
    await render();
    await menu();
    await act(async () => mocks.pick("open-default"));
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(expected);
    await menu();
    await act(async () => mocks.pick("reveal"));
    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith(expected);
  },
);
it("preserves an absolute namespace when copying a path", async () => {
  mocks.path = "remote://host/project/file.ts";
  await render();
  await menu();
  await act(async () => mocks.pick("copy-path"));
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(mocks.path);
});
it.each(["root", "filesystem", "unmount"])(
  "retires cached native actions after %s changes and return",
  async (change) => {
    await render();
    await menu();
    const oldPick = mocks.pick;
    if (change === "unmount") await act(async () => root.render(null));
    else if (change === "filesystem") {
      await act(async () => useWorkspaceEnvStore.setState({ env: ssh }));
      await act(async () =>
        useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE }),
      );
    } else {
      mocks.root = "/other";
      await render();
      mocks.root = "/project";
      await render();
    }
    await act(async () => oldPick("open-default"));
    expect(mocks.open).not.toHaveBeenCalled();
  },
);
