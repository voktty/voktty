// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FileExplorer,
  type FileExplorerHandle,
} from "@/modules/explorer/FileExplorer";
import type { DirEntry } from "@/modules/explorer/lib/useFileTree";
import type { WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  remoteRead: vi.fn(),
  scroll: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/modules/remote", () => ({
  isPathInWorkspace: () => true,
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
let handle: React.RefObject<FileExplorerHandle | null>;
const local: WorkspaceEnv = { kind: "local" };
const entry = (name: string, kind: "file" | "dir" = "file"): DirEntry => ({
  name,
  kind,
  size: 1,
  mtime: 1,
  gitignored: false,
});
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function explorer(): FileExplorerHandle {
  const current = handle.current;
  if (!current) throw new Error("Missing explorer handle.");
  return current;
}
async function render(
  rootPath = "/work",
  workspaceEnv = local,
  navigationKey = "main",
) {
  await act(async () =>
    root.render(
      <FileExplorer
        ref={handle}
        rootPath={rootPath}
        navigationKey={navigationKey}
        workspaceEnv={workspaceEnv}
        onOpenFile={() => {}}
      />,
    ),
  );
}
const paths = () =>
  [...node.querySelectorAll<HTMLElement>("[data-fs-path]")].map(
    (row) => row.dataset.fsPath,
  );
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  mocks.scroll.mockReset();
  mocks.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command !== "fs_read_dir") return false;
    return args.path === "/work"
      ? [entry("src", "dir"), entry("old.ts")]
      : args.path === "/work/src"
        ? [entry("a.ts")]
        : [entry("new.ts")];
  });
  mocks.remoteRead
    .mockReset()
    .mockImplementation(async (_workspace, path) =>
      path === "/work" ? [entry("src", "dir")] : [entry("a.ts")],
    );
  handle = createRef<FileExplorerHandle>();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("uses the real tree and handle to expand, select and scroll within the current local root", async () => {
  await render();
  let result!: boolean;
  await act(async () => {
    result = await explorer().reveal("/work/src/a.ts");
  });
  expect(result).toBe(true);
  expect(paths()).toContain("/work/src/a.ts");
  expect(
    node
      .querySelector('[data-fs-path="/work/src/a.ts"]')
      ?.getAttribute("data-selected"),
  ).toBe("true");
  await act(async () => vi.advanceTimersByTimeAsync(20));
  expect(mocks.scroll).toHaveBeenCalled();
});

it("never reads the previous root in a newly selected filesystem", async () => {
  await render("/work");
  mocks.invoke.mockClear();
  const workspace: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
  await render("/next", workspace, "next");
  const reads = mocks.invoke.mock.calls.filter(([command]) => command === "fs_read_dir");
  expect(reads.length).toBeGreaterThan(0);
  for (const [, args] of reads) {
    expect(args).toEqual(expect.objectContaining({ path: "/next", workspace }));
  }
});

it("initializes the visible Explorer root with its own filesystem and no delegated initializer", async () => {
  const workspace: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
  await act(async () => root.render(<FileExplorer
    rootPath="/project" workspaceEnv={workspace} hasGitRepo={false} onOpenFile={() => {}}
  />));
  mocks.invoke.mockClear();
  const button = node.querySelector<HTMLButtonElement>('button[aria-label="Initialize Repository"]');
  expect(button).not.toBeNull();
  expect(button?.disabled).toBe(false);
  await act(async () => button?.click());
  expect(mocks.invoke).toHaveBeenCalledWith("git_init", { cwd: "/project", workspace });
});

it("resets manual navigation when only the filesystem changes", async () => {
  await render("/work");
  const parent = node.querySelector<HTMLButtonElement>('button[aria-label="Go to parent directory"]');
  expect(parent).not.toBeNull();
  await act(async () => parent?.click());
  mocks.invoke.mockClear();
  const workspace: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
  await render("/work", workspace);
  const reads = mocks.invoke.mock.calls.filter(([command]) => command === "fs_read_dir");
  expect(reads.length).toBeGreaterThan(0);
  expect(reads[0][1]).toEqual(expect.objectContaining({ path: "/work", workspace }));
  for (const [, args] of reads) {
    expect(args.workspace).toEqual(workspace);
    expect(args.path === "/work" || args.path.startsWith("/work/")).toBe(true);
  }
});

it("preserves manual navigation across an equivalent filesystem publication", async () => {
  await render("/work");
  const parent = node.querySelector<HTMLButtonElement>('button[aria-label="Go to parent directory"]');
  await act(async () => parent?.click());
  mocks.invoke.mockClear();
  await render("/work", { kind: "local" });
  expect(node.querySelector('span[title="/"]')).not.toBeNull();
  for (const [command, args] of mocks.invoke.mock.calls) {
    if (command === "fs_read_dir") expect(args.path).toBe("/");
  }
});

it("preserves a pending revealed selection when focus is requested before React commits it", async () => {
  await render();
  const original = explorer();
  await act(async () => {
    expect(await original.reveal("/work/old.ts")).toBe(true);
    original.focus({ preserveSelection: true });
  });
  expect(node.querySelector('[data-fs-path="/work/old.ts"]')?.getAttribute("data-selected")).toBe("true");
  expect(node.querySelector('[data-fs-path="/work/src"]')?.getAttribute("data-selected")).toBe("false");
});

it.each(["root", "navigation", "unmount"])(
  "rejects a late local read after %s retirement without populating the successor tree",
  async (change) => {
    await render();
    const deferred = pending<DirEntry[]>();
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "fs_read_dir"
        ? args.path === "/work/src"
          ? deferred.promise
          : [entry("new.ts")]
        : false,
    );
    let result!: Promise<boolean>;
    await act(async () => {
      result = explorer().reveal("/work/src/late.ts");
    });
    if (change === "root") await render("/other");
    if (change === "navigation") await render("/work", local, "successor");
    if (change === "unmount") await act(async () => root.render(null));
    deferred.resolve([entry("late.ts")]);
    await act(async () => {
      expect(await result).toBe(false);
    });
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(paths()).not.toContain("/work/src/late.ts");
    expect(node.querySelector('[data-selected="true"]')).toBeNull();
    expect(node.querySelector("[data-status-row]")).toBeNull();
    expect(mocks.scroll).not.toHaveBeenCalled();
  },
);

it("does not reuse authority after the same SSH profile reconnects with a new native session", async () => {
  const first: WorkspaceEnv = {
    kind: "ssh",
    root: "/work",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  };
  await render("/work", first);
  const deferred = pending<DirEntry[]>();
  mocks.remoteRead.mockImplementation(async (workspace, path) =>
    workspace.sessionId === 7 && path === "/work/src"
      ? deferred.promise
      : path === "/work"
        ? [entry("src", "dir")]
        : [entry("current.ts")],
  );
  let result!: Promise<boolean>;
  await act(async () => {
    result = explorer().reveal("/work/src/late.ts");
  });
  await render("/work", { ...first, sessionId: 8 });
  deferred.resolve([entry("late.ts")]);
  await act(async () => {
    expect(await result).toBe(false);
  });
  expect(paths()).not.toContain("/work/src/late.ts");
  expect(mocks.scroll).not.toHaveBeenCalled();
});

it("honors caller cancellation before reading and after a pending read rejects", async () => {
  await render();
  mocks.invoke.mockClear();
  expect(await explorer().reveal("/work/src/a.ts", () => false)).toBe(
    false,
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
  const deferred = pending<DirEntry[]>();
  mocks.invoke.mockReturnValue(deferred.promise);
  let current = true;
  let result!: Promise<boolean>;
  await act(async () => {
    result = explorer().reveal("/work/src/a.ts", () => current);
  });
  current = false;
  deferred.reject(new Error("retired read"));
  await act(async () => {
    expect(await result).toBe(false);
  });
  expect(node.textContent).not.toContain("retired read");
  expect(node.querySelector('[data-selected="true"]')).toBeNull();
});

it.each<WorkspaceEnv>([
  { kind: "wsl", distro: "Ubuntu" },
  {
    kind: "docker",
    connection: { containerId: "box", containerName: "Box", image: "image" },
  },
])(
  "keeps the captured $kind workspace on reveal directory reads",
  async (workspace) => {
    await render("/work", workspace);
    mocks.invoke.mockClear();
    await act(async () => {
      expect(await explorer().reveal("/work/src/a.ts")).toBe(true);
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "fs_read_dir",
      expect.objectContaining({ path: "/work/src", workspace }),
    );
  },
);

it("removes only its own abandoned loading state while retaining a newer read of the same directory", async () => {
  const first = pending<DirEntry[]>();
  const second = pending<DirEntry[]>();
  let reads = 0;
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command !== "fs_read_dir") return false;
    if (args.path === "/cohort") return [entry("src", "dir")];
    return ++reads === 1 ? first.promise : second.promise;
  });
  await render("/cohort");
  let old!: Promise<boolean>;
  let current!: Promise<boolean>;
  await act(async () => {
    old = explorer().reveal("/cohort/src/old.ts");
  });
  await act(async () => {
    current = explorer().reveal("/cohort/src/current.ts");
  });
  first.resolve([entry("old.ts")]);
  await act(async () => {
    expect(await old).toBe(false);
  });
  expect(node.querySelector("[data-status-row]")).not.toBeNull();
  second.resolve([entry("current.ts")]);
  await act(async () => {
    expect(await current).toBe(true);
  });
  expect(paths()).not.toContain("/cohort/src/old.ts");
  expect(
    node
      .querySelector('[data-fs-path="/cohort/src/current.ts"]')
      ?.getAttribute("data-selected"),
  ).toBe("true");
});
