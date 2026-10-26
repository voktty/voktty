// @vitest-environment happy-dom
import {
  act,
  StrictMode,
  type InputHTMLAttributes,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExplorerSearch } from "@/modules/explorer/ExplorerSearch";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  rememberRemoteProject,
  REMOTE_PROJECTS_CHANGED,
} from "@/modules/connections/model/remoteProjects";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  reveal: vi.fn(),
  acquire: vi.fn(),
  change: null as ((value: string) => void) | null,
  menuActions: [] as (() => void)[],
}));
vi.mock("@/components/ui/context-menu", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    ContextMenu: Wrapper,
    ContextMenuTrigger: Wrapper,
    ContextMenuContent: Wrapper,
    ContextMenuSeparator: () => null,
    ContextMenuItem: ({
      children,
      onSelect,
    }: {
      children?: ReactNode;
      onSelect: () => void;
    }) => {
      io.menuActions.push(onSelect);
      return (
        <button type="button" onClick={onSelect}>
          {children}
        </button>
      );
    },
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: io.reveal }));
vi.mock("@/modules/explorer/lib/iconResolver", () => ({
  fileIconUrl: () => "",
}));
vi.mock("@/components/ui/input", async () => {
  const { forwardRef } = await import("react");
  return {
    Input: forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
      (props, ref) => {
        io.change = (value) =>
          props.onChange?.({
            target: { value },
          } as ChangeEvent<HTMLInputElement>);
        return <input {...props} ref={ref} />;
      },
    ),
  };
});
let root: Root;
let node: HTMLDivElement;
async function render(
  workspace: WorkspaceEnv = { kind: "local" },
  path = "/repo",
  onOpenFile: (path: string) => void = () => {},
  open = true,
) {
  await act(async () =>
    root.render(
      <ExplorerSearch
        rootPath={path}
        workspace={workspace}
        open={open}
        onRequestClose={() => {}}
        onOpenFile={onOpenFile}
      />,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    () => {},
  );
  io.invoke.mockReset();
  io.reveal.mockReset();
  io.acquire.mockReset();
  io.menuActions = [];
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
});

it("searches the original local filesystem while the global workspace is WSL", async () => {
  useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "unrelated" } });
  io.invoke.mockResolvedValue({ hits: [], truncated: false });
  await render();
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(io.invoke).toHaveBeenCalledWith(
    "fs_search",
    expect.objectContaining({ root: "/repo", workspace: { kind: "local" } }),
  );
});

it("explains an older SSH helper without falling back to local IO", async () => {
  io.invoke.mockResolvedValue({
    protocol: 2,
    id: "old",
    ok: false,
    error: { code: "method_not_found", message: "unknown method" },
  });
  await render({
    kind: "ssh",
    root: "/repo",
    sessionId: 1,
    connection: { id: "fixture", name: "Fixture", host: "a.test" },
  });
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () => vi.dynamicImportSettled());
  expect(io.invoke).toHaveBeenCalledExactlyOnceWith(
    "remote_request",
    expect.objectContaining({
      sessionId: 1,
      request: expect.objectContaining({ method: "fs.searchNames" }),
    }),
  );
  expect(node.textContent).toContain(
    "This action is unavailable for this filesystem.",
  );
});

it("opens SSH file results on the original host and refuses native reveal", async () => {
  const opened = vi.fn();
  io.invoke.mockResolvedValue({
    protocol: 2,
    id: "search",
    ok: true,
    result: {
      hits: [
        { rel: "src/file.ts", name: "file.ts", is_dir: false },
        { rel: "src/files", name: "files", is_dir: true },
      ],
      truncated: false,
    },
  });
  await render(
    {
      kind: "ssh",
      root: "/repo",
      sessionId: 7,
      connection: { id: "original", name: "Original", host: "original.test" },
    },
    "/repo",
    opened,
  );
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () => vi.dynamicImportSettled());
  const file = [...node.querySelectorAll("button")].find(
    (button) => button.title === "/repo/src/file.ts",
  );
  expect(file).toBeDefined();
  await act(async () => {
    file?.click();
  });
  expect(opened).toHaveBeenCalledExactlyOnceWith("/repo/src/file.ts");
  expect(node.textContent).toContain("files");
  for (const action of io.menuActions) await act(async () => action());
  expect(io.reveal).not.toHaveBeenCalled();
  expect(io.invoke).toHaveBeenCalledTimes(1);
});

it("rejects a late SSH result after another filesystem owns the search", async () => {
  let finish!: (value: unknown) => void;
  io.invoke
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ hits: [], truncated: false });
  await render({
    kind: "ssh",
    root: "/repo",
    sessionId: 7,
    connection: { id: "original", name: "Original", host: "original.test" },
  });
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () => vi.dynamicImportSettled());
  await render();
  await act(async () =>
    finish({
      protocol: 2,
      id: "old",
      ok: true,
      result: {
        hits: [{ rel: "old.ts", name: "old.ts", is_dir: false }],
        truncated: false,
      },
    }),
  );
  expect(node.textContent).not.toContain("old.ts");
});

it("searches a registered project in StrictMode and retires menus before a profile round trip commits", async () => {
  const profile = { id: "fixture", name: "Fixture", host: "original.test" };
  const path = "remote://voktty-ssh-fixture/srv/project/src";
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Fixture",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  const opened = vi.fn();
  io.acquire.mockImplementation(async () => ({
    info: {
      session_id: 7,
      workspace_root: "/canonical/project",
      architecture: "x86_64",
      helper_version: "1",
      capabilities: ["fs.searchNames"],
    },
    release: vi.fn(),
    releaseAndClose: vi.fn(async () => {}),
  }));
  io.invoke.mockResolvedValue({
    protocol: 2,
    id: "search",
    ok: true,
    result: {
      hits: [{ rel: "file.ts", name: "file.ts", is_dir: false }],
      truncated: false,
    },
  });
  await act(async () =>
    root.render(
      <StrictMode>
        <ExplorerSearch
          rootPath={path}
          workspace={{ kind: "local" }}
          open
          onRequestClose={() => {}}
          onOpenFile={opened}
        />
      </StrictMode>,
    ),
  );
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () => vi.dynamicImportSettled());
  const file = [...node.querySelectorAll("button")].find(
    (button) => button.title === `${path}/file.ts`,
  );
  expect(file).toBeDefined();
  await act(async () => file?.click());
  expect(opened).toHaveBeenCalledExactlyOnceWith(`${path}/file.ts`);
  expect(io.acquire).toHaveBeenCalledExactlyOnceWith(
    { profileId: "fixture", root: "/srv/project" },
    expect.objectContaining({ host: "original.test" }),
  );
  expect(io.invoke).toHaveBeenCalledExactlyOnceWith(
    "remote_request",
    expect.objectContaining({
      sessionId: 7,
      request: expect.objectContaining({
        method: "fs.searchNames",
        params: expect.objectContaining({ cwd: "src" }),
      }),
    }),
  );
  const oldActions = [...io.menuActions];
  opened.mockClear();
  await act(async () => {
    usePreferencesStore.setState({
      sshConnections: [{ ...profile, host: "replacement.test" }],
    });
    usePreferencesStore.setState({ sshConnections: [profile] });
    for (const action of oldActions) action();
  });
  expect(opened).not.toHaveBeenCalled();
  expect(io.reveal).not.toHaveBeenCalled();
  expect(node.textContent).not.toContain("file.ts");
});

it("observes project metadata only while namespace search is open", async () => {
  const path = "remote://voktty-ssh-fixture/srv/project";
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Fixture",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({
    sshConnections: [{ id: "fixture", name: "Fixture", host: "original.test" }],
  });
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  await render({ kind: "local" }, path, () => {}, false);
  expect(
    add.mock.calls.filter(([event]) => event === REMOTE_PROJECTS_CHANGED),
  ).toHaveLength(0);
  await render({ kind: "local" }, path, () => {}, true);
  expect(
    add.mock.calls.filter(([event]) => event === REMOTE_PROJECTS_CHANGED),
  ).toHaveLength(1);
  await render({ kind: "local" }, path, () => {}, false);
  expect(
    remove.mock.calls.filter(([event]) => event === REMOTE_PROJECTS_CHANGED),
  ).toHaveLength(1);
  expect(io.acquire).not.toHaveBeenCalled();
});

it("does not publish a late result from a replaced search root", async () => {
  let finish!: (result: { hits: unknown[]; truncated: boolean }) => void;
  io.invoke
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({
      hits: [
        {
          path: "/current/new.ts",
          rel: "new.ts",
          name: "new.ts",
          is_dir: false,
        },
      ],
      truncated: false,
    });
  await render();
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await render({ kind: "local" }, "/current");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await act(async () =>
    finish({
      hits: [
        { path: "/repo/old.ts", rel: "old.ts", name: "old.ts", is_dir: false },
      ],
      truncated: false,
    }),
  );
  expect(node.textContent).toContain("new.ts");
  expect(node.textContent).not.toContain("old.ts");
});

it("withdraws accepted results before a replacement root finishes searching", async () => {
  const original = vi.fn();
  const replacement = vi.fn();
  let finish!: (result: { hits: unknown[]; truncated: boolean }) => void;
  io.invoke
    .mockResolvedValueOnce({
      hits: [
        { path: "/repo/old.ts", rel: "old.ts", name: "old.ts", is_dir: false },
      ],
      truncated: false,
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  await render({ kind: "local" }, "/repo", original);
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(node.textContent).toContain("old.ts");
  await render({ kind: "local" }, "/current", replacement);
  const stale = [...node.querySelectorAll("button")].find(
    (button) => button.title === "/repo/old.ts",
  );
  await act(async () => {
    stale?.click();
  });
  expect(replacement).not.toHaveBeenCalled();
  expect(node.textContent).not.toContain("old.ts");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(node.textContent).not.toContain("old.ts");
  await act(async () => finish({ hits: [], truncated: false }));
});

it("permanently retires cached result menus across a filesystem round trip", async () => {
  const opened = vi.fn();
  io.invoke.mockResolvedValueOnce({
    hits: [
      { path: "/repo/old.ts", rel: "old.ts", name: "old.ts", is_dir: false },
    ],
    truncated: false,
  });
  await render({ kind: "local" }, "/repo", opened);
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(node.textContent).toContain("old.ts");
  const actions = [...io.menuActions];
  expect(actions.length).toBeGreaterThan(0);
  await render({
    kind: "ssh",
    root: "/repo",
    sessionId: 1,
    connection: { id: "fixture", name: "Fixture", host: "a.test" },
  });
  await render({ kind: "local" }, "/repo", opened);
  io.invoke.mockClear();
  await act(async () => {
    for (const action of actions) action();
  });
  expect(opened).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
  expect(node.textContent).not.toContain("old.ts");
});

it("retires accepted results and their menus as soon as the query changes", async () => {
  const opened = vi.fn();
  io.invoke.mockResolvedValue({
    hits: [
      { path: "/repo/old.ts", rel: "old.ts", name: "old.ts", is_dir: false },
    ],
    truncated: false,
  });
  await render({ kind: "local" }, "/repo", opened);
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  const actions = [...io.menuActions];
  expect(node.textContent).toContain("old.ts");
  await act(async () => {
    actions[0]();
  });
  expect(opened).toHaveBeenCalledWith("/repo/old.ts");
  opened.mockClear();
  await act(async () => {
    io.change?.("other");
  });
  expect(node.textContent).not.toContain("old.ts");
  await act(async () => {
    for (const action of actions) action();
  });
  expect(opened).not.toHaveBeenCalled();
});

it("retires cached result menus when search closes", async () => {
  const opened = vi.fn();
  io.invoke.mockResolvedValue({
    hits: [
      { path: "/repo/old.ts", rel: "old.ts", name: "old.ts", is_dir: false },
    ],
    truncated: false,
  });
  await render({ kind: "local" }, "/repo", opened);
  await act(async () => {
    io.change?.("file");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  const actions = [...io.menuActions];
  expect(actions.length).toBeGreaterThan(0);
  await render({ kind: "local" }, "/repo", opened, false);
  io.invoke.mockClear();
  await act(async () => {
    for (const action of actions) action();
  });
  expect(opened).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
  expect(node.textContent).not.toContain("old.ts");
});
