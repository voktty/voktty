// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileExplorer } from "@/modules/explorer/FileExplorer";
import type { WorkspaceEnv } from "@/modules/workspace";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@/modules/explorer/lib/useFileTree", () => ({
  useFileTree: (root: string) => ({
    nodes: {
      [root]: {
        status: "loaded",
        entries: ["a.ts", "b.ts"].map((name) => ({
          name,
          kind: "file",
          size: 1,
          mtime: 1,
          gitignored: false,
        })),
      },
    },
    expanded: new Set(),
    renaming: null,
    pendingCreate: null,
    joinPath: (parent: string, name: string) => `${parent}/${name}`,
    reveal: vi.fn(async () => false),
    toggle: vi.fn(),
    beginRename: vi.fn(),
    commitRename: vi.fn(),
    cancelRename: vi.fn(),
    refresh: vi.fn(),
    movePath: vi.fn(),
  }),
}));
vi.mock("@/modules/explorer/lib/useGitStatus", () => ({
  useGitStatus: () => ({ lookup: () => null }),
}));
vi.mock("@/modules/explorer/lib/useIconCatalogVersion", () => ({
  useIconCatalogVersion: () => 0,
}));
vi.mock("@/modules/explorer/lib/iconResolver", () => ({
  fileIconUrl: () => "",
  folderIconUrl: () => "",
}));
vi.mock("@/modules/explorer/lib/useExplorerDnd", () => ({
  useExplorerDnd: () => ({ dropTargetDir: null }),
}));
vi.mock("@/modules/explorer/lib/useExplorerFileDrop", () => ({
  useExplorerFileDrop: () => ({ externalTargetDir: null }),
}));
vi.mock("@/modules/explorer/ExplorerSearch", () => ({
  ExplorerSearch: () => null,
}));
vi.mock("@/modules/remote", () => ({ isPathInWorkspace: () => true }));
vi.mock("@/modules/shortcuts", () => ({ useGlobalShortcuts: () => {} }));
vi.mock("@/modules/explorer/TreeRow", () => ({
  EntryRow: ({
    path,
    onSelectPath,
  }: {
    path: string;
    onSelectPath: (path: string, event: React.MouseEvent) => void;
  }) => (
    <button
      type="button"
      data-fs-path={path}
      onClick={(event) => onSelectPath(path, event)}
    >
      {path}
    </button>
  ),
  PendingRow: () => null,
  StatusRow: () => null,
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 22,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 22,
        size: 22,
      })),
    scrollToIndex: vi.fn(),
  }),
}));
let root: Root;
let node: HTMLDivElement;
const send = vi.fn();
const original: WorkspaceEnv = {
  kind: "ssh",
  root: "/repo",
  sessionId: 7,
  connection: { id: "fixture", name: "Fixture", host: "a.test" },
};
async function render(
  workspace = original,
  navigationKey = "first",
  rootPath = "/repo",
) {
  await act(async () =>
    root.render(
      <FileExplorer
        rootPath={rootPath}
        navigationKey={navigationKey}
        workspaceEnv={workspace}
        onOpenFile={() => {}}
        onAttachToAgent={send}
      />,
    ),
  );
}
async function menu(path = "/repo/a.ts") {
  const row = node.querySelector(`[data-fs-path="${path}"]`);
  await act(async () =>
    row?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: 20,
        clientY: 20,
      }),
    ),
  );
}
const attach = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Attach file or selection",
  );
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  send.mockClear();
  localStorage.clear();
  usePreferencesStore.setState({ sshConnections: [] });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

it("passes the pointed file's filesystem and keeps its admitted guard after menu close", async () => {
  await render();
  await menu();
  const action = attach();
  expect(action).toBeDefined();
  await act(async () => action?.click());
  expect(send).toHaveBeenCalledExactlyOnceWith(
    "/repo/a.ts",
    original,
    expect.any(Function),
  );
  const guard = send.mock.calls[0][2];
  expect(guard()).toBe(true);
  await render({ ...original, sessionId: 8 });
  expect(guard()).toBe(false);
});

it("explains and rejects a menu whose Explorer source was replaced", async () => {
  await render();
  await menu();
  await render(original, "successor");
  const action = attach();
  expect(action?.getAttribute("aria-disabled")).toBe("true");
  expect(action?.getAttribute("aria-description")).toBe(
    "The target changed. Open the menu again.",
  );
  await act(async () => action?.click());
  expect(send).not.toHaveBeenCalled();
});

it("keeps unsupported attachment actions visible with a filesystem reason", async () => {
  await render({ kind: "serial", portName: "fixture", baudRate: 9600 });
  await menu();
  const action = attach();
  expect(action?.getAttribute("aria-disabled")).toBe("true");
  expect(action?.getAttribute("aria-description")).toBe(
    "This action is unavailable for this filesystem.",
  );
  await act(async () => action?.click());
  expect(send).not.toHaveBeenCalled();
});

it("enables registered project attachments independently of the ambient filesystem", async () => {
  const rootPath = "remote://voktty-ssh-fixture/srv/project";
  const local: WorkspaceEnv = { kind: "local" };
  usePreferencesStore.setState({
    sshConnections: [{ id: "fixture", name: "Fixture", host: "a.test" }],
  });
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Project",
    cwd: "/srv/project",
  });
  await render(local, "project", rootPath);
  await menu(`${rootPath}/a.ts`);
  const action = attach();
  expect(action).toBeDefined();
  expect(action?.getAttribute("aria-disabled")).not.toBe("true");
  await act(async () => action?.click());
  expect(send).toHaveBeenCalledExactlyOnceWith(
    `${rootPath}/a.ts`,
    local,
    expect.any(Function),
  );
});
