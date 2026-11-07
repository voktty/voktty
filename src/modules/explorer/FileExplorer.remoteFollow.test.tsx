// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileExplorer } from "@/modules/explorer/FileExplorer";
import type { WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  remoteRead: vi.fn(),
  scroll: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/modules/remote", () => ({
  isPathInWorkspace: () => true,
  isPathWithinRemoteRoot: (env: { root: string }, path: string) =>
    path === env.root || path.startsWith(`${env.root}/`),
  remoteReadDir: mocks.remoteRead,
}));
vi.mock("@/modules/explorer/lib/watch", () => ({
  isNetworkFilesystemPath: () => false,
  watchAdd: vi.fn(),
  watchRemove: vi.fn(),
  listenFsChanged: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@/modules/explorer/lib/useIconCatalogVersion", () => ({
  useIconCatalogVersion: () => 0,
}));
vi.mock("@/modules/explorer/lib/iconResolver", () => ({
  fileIconUrl: () => "/synthetic.svg",
  folderIconUrl: () => "/synthetic.svg",
}));
vi.mock("@/modules/explorer/lib/useGitStatus", () => ({
  useGitStatus: () => ({ lookup: () => null }),
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
vi.mock("@/modules/explorer/TreeRow", () => ({
  EntryRow: ({ path, isSelected }: { path: string; isSelected: boolean }) => (
    <div data-fs-path={path} data-selected={isSelected} />
  ),
  PendingRow: () => null,
  StatusRow: ({ message }: { message: string }) => (
    <span data-status-row>{message}</span>
  ),
}));
vi.mock("@/modules/shortcuts", () => ({ useGlobalShortcuts: () => {} }));
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
    scrollToIndex: mocks.scroll,
  }),
}));


let root: Root;
let node: HTMLDivElement;
const ssh = {
  kind: "ssh",
  root: "/home/u/app",
  sessionId: 1,
  connection: { id: "c", name: "c", host: "h" },
} as unknown as WorkspaceEnv;

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function render(
  rootPath: string,
  onPrepareNavigationRoot: (path: string) => Promise<boolean>,
) {
  await act(async () =>
    root.render(
      <FileExplorer
        rootPath={rootPath}
        navigationKey="ssh:c"
        workspaceEnv={ssh}
        onPrepareNavigationRoot={onPrepareNavigationRoot}
        onOpenFile={() => {}}
      />,
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.invoke.mockReset().mockResolvedValue(null);
  mocks.remoteRead.mockReset().mockResolvedValue([]);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

it("lists a cd outside the session root only after the session is prepared", async () => {
  const ready = pending<boolean>();
  const prepare = vi.fn().mockImplementation(() => ready.promise);
  await render("/home/u/app", prepare);
  expect(prepare).not.toHaveBeenCalled();
  await render("/etc", prepare);
  expect(prepare).toHaveBeenCalledWith("/etc");
  const listed = () =>
    mocks.remoteRead.mock.calls.filter(([, path]) => path === "/etc");
  expect(listed()).toHaveLength(0);
  await act(async () => ready.resolve(true));
  expect(listed().length).toBeGreaterThan(0);
});

it("does not prepare a cd that stays inside the session root", async () => {
  const prepare = vi.fn().mockResolvedValue(true);
  await render("/home/u/app", prepare);
  await render("/home/u/app/src", prepare);
  expect(prepare).not.toHaveBeenCalled();
});

it("keeps the last cd made while a session is still being prepared", async () => {
  const first = pending<boolean>();
  const prepare = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValue(true);
  await render("/home/u/app", prepare);
  await render("/etc", prepare);
  await render("/var", prepare);
  expect(prepare).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve(true));
  expect(prepare).toHaveBeenLastCalledWith("/var");
});

it("retries a folder whose follow failed the next time it is reported", async () => {
  const prepare = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(true);
  await render("/home/u/app", prepare);
  await render("/etc", prepare);
  expect(prepare).toHaveBeenCalledTimes(1);
  await render("/home/u/app", prepare);
  await render("/etc", prepare);
  expect(prepare).toHaveBeenCalledTimes(2);
});
