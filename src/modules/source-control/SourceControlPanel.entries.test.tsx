// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceControlPanel } from "@/modules/source-control/SourceControlPanel";
import type { SourceControlSummary } from "@/modules/source-control/useSourceControl";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import { t } from "@/modules/i18n";
import { SourceControl as HarnessSourceControl } from "@/modules/harness/chrome/SourceControl";
import { DiffPane } from "@/modules/harness/surfaces/DiffPane";

type Item = {
  onSelect?: () => void;
  disabled?: boolean;
  title?: string;
  "aria-description"?: string;
};
const mocks = vi.hoisted(() => ({
  reveal: vi.fn(),
  copy: vi.fn(),
  stage: vi.fn(),
  windows: false,
  realMenu: false,
  summary: null as SourceControlSummary | null,
  items: new Map<string, Item>(),
  close: undefined as undefined | ((open: boolean) => void),
}));
vi.mock("@/modules/source-control/useSourceControl", () => ({
  useSourceControl: () => {
    if (!mocks.summary) throw new Error("Missing project summary");
    return mocks.summary;
  },
}));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  IS_MAC: false,
  get IS_WINDOWS() {
    return mocks.windows;
  },
}));
vi.mock("@/modules/explorer/lib/contextActions", () => ({
  revealInFinder: mocks.reveal,
  copyToClipboard: mocks.copy,
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitStage: mocks.stage },
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
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 30,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 30,
        size: 30,
      })),
    scrollToIndex: vi.fn(),
  }),
}));
vi.mock("@/components/ui/context-menu", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/context-menu")>();
  const Box = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    ContextMenu: ({
      children,
      onOpenChange,
    }: {
      children: ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) => {
      mocks.close = onOpenChange;
      if (mocks.realMenu)
        return (
          <actual.ContextMenu onOpenChange={onOpenChange}>
            {children}
          </actual.ContextMenu>
        );
      return (
        <div
          role="menu"
          tabIndex={-1}
          onContextMenu={() => onOpenChange?.(true)}
        >
          {children}
        </div>
      );
    },
    ContextMenuTrigger: (
      props: Parameters<typeof actual.ContextMenuTrigger>[0],
    ) =>
      mocks.realMenu ? (
        <actual.ContextMenuTrigger {...props} />
      ) : (
        <Box>{props.children}</Box>
      ),
    ContextMenuContent: (
      props: Parameters<typeof actual.ContextMenuContent>[0],
    ) =>
      mocks.realMenu ? (
        <actual.ContextMenuContent {...props} />
      ) : (
        <Box>{props.children}</Box>
      ),
    ContextMenuSeparator: () =>
      mocks.realMenu ? <actual.ContextMenuSeparator /> : null,
    ContextMenuItem: (props: Item & { children: ReactNode }) => {
      if (mocks.realMenu) return <actual.ContextMenuItem {...props} />;
      mocks.items.set(String(props.children), props);
      return (
        <button
          type="button"
          role="menuitem"
          disabled={props.disabled}
          onClick={props.onSelect}
        >
          {props.children}
        </button>
      );
    },
  };
});
let root: Root;
let container: HTMLDivElement;
const openFile = vi.fn();
const openDiff = vi.fn();
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
      changedFiles: [
        {
          path: "file.ts",
          originalPath: null,
          indexStatus: " ",
          worktreeStatus: "M",
          staged: false,
          unstaged: true,
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
        onOpenDiff={openDiff}
        onOpenFile={openFile}
        repositoryTarget={{ mode: "follow-context" }}
        onFollowRepositoryContext={() => {}}
      />,
    ),
  );
}
async function menu() {
  const row = container.querySelector('[role="option"]');
  expect(row).not.toBeNull();
  await act(async () =>
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })),
  );
}
function item(key: string) {
  const result = mocks.items.get(t(key));
  if (!result) throw new Error(`Missing menu item: ${key}`);
  return result;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
  mocks.items.clear();
  mocks.close = undefined;
  mocks.windows = false;
  mocks.realMenu = false;
  mocks.summary = null;
  mocks.reveal.mockReset().mockResolvedValue(undefined);
  mocks.copy.mockReset().mockResolvedValue(undefined);
  mocks.stage.mockReset().mockResolvedValue(undefined);
  openFile.mockReset();
  openDiff.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("keeps native reveal disabled for SSH paths even under forced delivery", async () => {
  useWorkspaceEnvStore.setState({
    env: {
      kind: "ssh",
      connection: { id: "ssh", name: "test", host: "test.example" },
      root: "/project",
      sessionId: 1,
    },
  });
  await render();
  await menu();
  const reveal = item("explorer.revealInFinder");
  expect(reveal.disabled).toBe(true);
  expect(reveal.title).toBe(t("workspace.localMachine"));
  await act(async () => reveal.onSelect?.());
  expect(mocks.reveal).not.toHaveBeenCalled();
});
it("passes the originating filesystem when opening a file", async () => {
  const env: WorkspaceEnv = { kind: "wsl", distro: "test-distro" };
  useWorkspaceEnvStore.setState({ env });
  await render();
  await menu();
  await act(async () => item("common.open").onSelect?.());
  expect(openFile).toHaveBeenCalledExactlyOnceWith("/project/file.ts", true, {
    workspaceEnv: env,
  });
});
it("retires cached file and clipboard actions after a repository change", async () => {
  await render();
  await menu();
  const open = item("common.open");
  const copy = item("explorer.copyPath");
  await render("/replacement");
  await act(async () => {
    open.onSelect?.();
    copy.onSelect?.();
  });
  expect(openFile).not.toHaveBeenCalled();
  expect(mocks.copy).not.toHaveBeenCalled();
});
it("consumes a menu action once and retires it on dismissal", async () => {
  await render();
  await menu();
  const copy = item("explorer.copyPath");
  await act(async () => {
    copy.onSelect?.();
    copy.onSelect?.();
  });
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith("/project/file.ts");
  await menu();
  const open = item("common.open");
  await act(async () => {
    mocks.close?.(false);
    open.onSelect?.();
  });
  expect(openFile).not.toHaveBeenCalled();
});
it("opens a current local file with an explicit local descriptor", async () => {
  await render();
  await menu();
  await act(async () => item("common.open").onSelect?.());
  expect(openFile).toHaveBeenCalledExactlyOnceWith("/project/file.ts", true, {
    workspaceEnv: { kind: "local" },
  });
});
it("allows native reveal for a current local file", async () => {
  await render();
  await menu();
  const reveal = item("explorer.revealInFinder");
  expect(reveal.disabled).toBe(false);
  await act(async () => reveal.onSelect?.());
  expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith("/project/file.ts");
});
it.each<WorkspaceEnv>([
  {
    kind: "docker",
    connection: {
      containerId: "container",
      containerName: "test",
      image: "test",
      shell: "sh",
    },
  },
  { kind: "serial", portName: "test-port", baudRate: 9600 },
])(
  "refuses unsupported $kind file openings without local fallback",
  async (env) => {
    useWorkspaceEnvStore.setState({ env });
    await render();
    await menu();
    const open = item("common.open");
    expect(open.disabled).toBe(true);
    expect(open.title).toBe(t("git.unsupportedFilesystem"));
    expect(open["aria-description"]).toBe(open.title);
    await act(async () => open.onSelect?.());
    expect(openFile).not.toHaveBeenCalled();
  },
);
it("keeps namespaces available for copying without opening them as native files", async () => {
  await render("remote://voktty-ssh-test/project");
  await menu();
  const open = item("common.open");
  expect(open.disabled).toBe(true);
  await act(async () => open.onSelect?.());
  expect(openFile).not.toHaveBeenCalled();
  await menu();
  await act(async () => item("explorer.copyPath").onSelect?.());
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(
    "remote://voktty-ssh-test/project/file.ts",
  );
});
it("does not revive an old menu after a filesystem round trip before commit", async () => {
  await render();
  await menu();
  const open = item("common.open");
  await act(async () => {
    useWorkspaceEnvStore.setState({
      env: { kind: "wsl", distro: "test-distro" },
    });
    useWorkspaceEnvStore.setState({ env: { kind: "local" } });
    open.onSelect?.();
  });
  expect(openFile).not.toHaveBeenCalled();
  await menu();
  await act(async () => item("common.open").onSelect?.());
  expect(openFile).toHaveBeenCalledOnce();
});
it("does not deliver retired actions after unmount", async () => {
  await render();
  await menu();
  const open = item("common.open");
  const reveal = item("explorer.revealInFinder");
  const copy = item("explorer.copyRelativePath");
  await act(async () => root.render(null));
  await act(async () => {
    open.onSelect?.();
    reveal.onSelect?.();
    copy.onSelect?.();
  });
  expect(openFile).not.toHaveBeenCalled();
  expect(mocks.reveal).not.toHaveBeenCalled();
  expect(mocks.copy).not.toHaveBeenCalled();
});
it("retains its original SSH filesystem through file opening", async () => {
  const env: WorkspaceEnv = {
    kind: "ssh",
    connection: {
      id: "ssh",
      name: "test",
      host: "test.example",
      user: "test-user",
    },
    root: "/project",
    sessionId: 7,
  };
  useWorkspaceEnvStore.setState({ env });
  await render();
  await menu();
  await act(async () => item("common.open").onSelect?.());
  expect(openFile).toHaveBeenCalledExactlyOnceWith("/project/file.ts", true, {
    workspaceEnv: env,
  });
});
it("keeps WSL POSIX reveal unavailable on the native Windows machine", async () => {
  mocks.windows = true;
  useWorkspaceEnvStore.setState({
    env: { kind: "wsl", distro: "test-distro" },
  });
  await render();
  await menu();
  const reveal = item("explorer.revealInFinder");
  expect(reveal.disabled).toBe(true);
  await act(async () => reveal.onSelect?.());
  expect(mocks.reveal).not.toHaveBeenCalled();
});
it.each([
  ["C:/project", { kind: "local" } as WorkspaceEnv],
  [
    "//wsl.localhost/test-distro/project",
    { kind: "wsl", distro: "test-distro" } as WorkspaceEnv,
  ],
])("preserves native Windows reveal for %s", async (path, env) => {
  mocks.windows = true;
  useWorkspaceEnvStore.setState({ env });
  await render(path);
  await menu();
  const reveal = item("explorer.revealInFinder");
  expect(reveal.disabled).toBe(false);
  await act(async () => reveal.onSelect?.());
  expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith(`${path}/file.ts`);
});
it("opens a current file through the real Radix menu event ordering", async () => {
  mocks.realMenu = true;
  await render();
  await menu();
  const open = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((element) => element.textContent === t("common.open"));
  expect(open).toBeDefined();
  await act(async () => open?.click());
  expect(openFile).toHaveBeenCalledExactlyOnceWith("/project/file.ts", true, {
    workspaceEnv: { kind: "local" },
  });
});
it("stages a current file through the real Radix menu event ordering", async () => {
  mocks.realMenu = true;
  await render();
  await menu();
  const stage = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((element) => element.textContent === t("git.stage"));
  expect(stage).toBeDefined();
  await act(async () => stage?.click());
  expect(mocks.stage).toHaveBeenCalledExactlyOnceWith("/project", ["file.ts"], {
    kind: "local",
  });
});
it.each([
  ["sidebar", "remote://voktty-ssh-test/project"],
  ["diff-pane", "remote://voktty-ssh-test/project"],
  ["sidebar", "/project"],
  ["diff-pane", "/project"],
])(
  "keeps project opening available in the Harness %s at %s",
  async (surface, path) => {
    mocks.summary = summary(path);
    await act(async () =>
      root.render(
        surface === "sidebar" ? (
          <HarnessSourceControl cwd={path} enabled onOpenFile={openFile} />
        ) : (
          <DiffPane
            cwd={path}
            focused
            onFocus={() => {}}
            onOpenFile={openFile}
          />
        ),
      ),
    );
    await menu();
    const open = item("common.open");
    expect(open.disabled).toBe(false);
    await act(async () => open.onSelect?.());
    expect(openFile).toHaveBeenCalledExactlyOnceWith(`${path}/file.ts`);
    expect(mocks.reveal).not.toHaveBeenCalled();
  },
);
