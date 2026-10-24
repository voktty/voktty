// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNativeFolderOpening } from "@/modules/explorer/lib/useNativeFolderOpening";
import {
  isNativeFolderPath,
  nativeFolderDefaultPath,
} from "@/modules/explorer/lib/nativeFolderSelection";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { EditorTab, Tab, TerminalTab } from "@/modules/tabs/lib/useTabs";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), error: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
const remote: WorkspaceEnv = {
  kind: "ssh",
  root: "/project",
  sessionId: 7,
  connection: { id: "build", name: "Build", host: "build.example" },
};
const source = (env: WorkspaceEnv = remote): EditorTab => ({
  ...createTabIdentity("main", () => "source"),
  id: 1,
  kind: "editor",
  spaceId: "main",
  path: "/project/a.ts",
  title: "File",
  workspaceEnv: env,
  dirty: false,
  preview: false,
});
let root: Root;
let node: HTMLDivElement;
let open: ReturnType<typeof useNativeFolderOpening>;
function Probe({ tab }: { tab?: Tab }) {
  open = useNativeFolderOpening({
    source: tab,
    spaceId: "main",
    localLaunchCwd: "/native",
    localHome: "/home/tester",
  });
  return null;
}
async function render(tab?: Tab) {
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe tab={tab} />
      </StrictMode>,
    ),
  );
}
function pending() {
  let resolve!: (value: string | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string | null>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.invoke.mockReset();
  mocks.error.mockReset();
  useSpaces.setState({
    activeId: "main",
    spaces: [
      {
        id: "main",
        name: "Main",
        root: "/project",
        env: remote,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  useWorkspaceEnvStore.setState({ env: remote });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

it.each([
  "/native/new folder",
  "C:\\work\\new",
  "\\\\server\\share\\folder",
  "\\\\?\\C:\\work",
])(
  "commits native selection %s atomically without changing the live resource environment",
  async (path) => {
    const tab = source();
    await render(tab);
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValue(path);
    const contexts: unknown[] = [];
    const unsubscribe = useSpaces.subscribe((state) =>
      contexts.push([state.spaces[0].root, state.spaces[0].env]),
    );
    await act(async () => expect(await open()).toBe(true));
    unsubscribe();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("fs_pick_folder", {
      defaultPath: "/native",
    });
    expect(contexts).toEqual([[path, LOCAL_WORKSPACE]]);
    expect(useWorkspaceEnvStore.getState().env).toBe(remote);
    expect(tab.workspaceEnv).toBe(remote);
  },
);

it.each(["source", "root", "env", "selection", "remove", "replace", "unmount"])(
  "retires a pending result after %s changes, even when restored",
  async (change) => {
    const tab = source();
    await render(tab);
    const deferred = pending();
    mocks.invoke.mockReturnValue(deferred.promise);
    let result!: Promise<boolean>;
    await act(async () => {
      result = open();
    });
    const original = useSpaces.getState();
    await act(async () => {
      if (change === "root") original.setRoot("main", "/changed");
      if (change === "env") original.setEnv("main", LOCAL_WORKSPACE);
      if (change === "selection") useSpaces.setState({ activeId: "other" });
      if (change === "remove") useSpaces.setState({ spaces: [] });
      if (change === "replace")
        useSpaces.setState({
          spaces: [{ ...original.spaces[0], createdAt: 2 }],
        });
      if (change === "unmount") root.render(null);
    });
    if (change === "source") {
      await render({ ...tab, path: "/project/b.ts" });
      await render(tab);
    }
    if (change !== "unmount")
      await act(async () =>
        useSpaces.setState({
          spaces: original.spaces,
          activeId: original.activeId,
        }),
      );
    await act(async () => {
      deferred.resolve("/late");
      expect(await result).toBe(false);
    });
    expect(useSpaces.getState().spaces).toEqual(original.spaces);
    expect(mocks.error).not.toHaveBeenCalled();
  },
);

it("retains one dialog slot through retirement and permits retry only after settlement", async () => {
  const tab = source();
  await render(tab);
  const deferred = pending();
  mocks.invoke
    .mockReturnValueOnce(deferred.promise)
    .mockResolvedValue("/retry");
  let first!: Promise<boolean>;
  await act(async () => {
    first = open();
  });
  await render({ ...tab, path: "/different/a.ts" });
  await act(async () => expect(await open()).toBe(false));
  expect(mocks.invoke).toHaveBeenCalledOnce();
  await act(async () => {
    deferred.reject(new Error("private failure"));
    expect(await first).toBe(false);
  });
  expect(mocks.error).not.toHaveBeenCalled();
  await act(async () => expect(await open()).toBe(true));
  expect(useSpaces.getState().spaces[0].root).toBe("/retry");
});

it("allows unrelated metadata changes while the dialog is pending", async () => {
  const tab = source();
  await render(tab);
  const deferred = pending();
  mocks.invoke.mockReturnValue(deferred.promise);
  let result!: Promise<boolean>;
  await act(async () => {
    result = open();
    useSpaces.getState().rename("main", "Renamed");
  });
  await render({ ...tab, dirty: true, title: "Renamed" });
  await act(async () => {
    deferred.resolve("/chosen");
    expect(await result).toBe(true);
  });
  expect(useSpaces.getState().spaces[0].name).toBe("Renamed");
});

it("suppresses cancellation and reports current failures without exposing their content", async () => {
  await render(source());
  mocks.invoke
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error("private failure"));
  await act(async () => {
    expect(await open()).toBe(false);
    expect(await open()).toBe(false);
  });
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(JSON.stringify(mocks.error.mock.calls)).not.toContain(
    "private failure",
  );
  expect(useSpaces.getState().spaces[0].env).toBe(remote);
});

it.each([
  "relative",
  "remote://host/project",
  "file:///work",
  "/bad\npath",
  "\\\\?\\C:relative",
  "\\\\.\\device",
  "x".repeat(32769),
])("rejects invalid native results", async (path) => {
  await render(source());
  mocks.invoke.mockResolvedValue(path);
  await act(async () => expect(await open()).toBe(false));
  expect(useSpaces.getState().spaces[0].root).toBe("/project");
  expect(mocks.error).toHaveBeenCalledOnce();
});

it("checks admission in the atomic store update and leaves denied or missing spaces untouched", () => {
  const previous = useSpaces.getState();
  const notify = vi.fn();
  const unsubscribe = useSpaces.subscribe(notify);
  expect(
    previous.setContext("main", "/denied", LOCAL_WORKSPACE, () => false),
  ).toBe(false);
  expect(previous.setContext("missing", "/missing", LOCAL_WORKSPACE)).toBe(
    false,
  );
  expect(useSpaces.getState()).toBe(previous);
  expect(notify).not.toHaveBeenCalled();
  unsubscribe();
});

it("selects only native default directories and preserves Windows document ownership", () => {
  const local = { root: "/fallback", env: LOCAL_WORKSPACE };
  expect(
    nativeFolderDefaultPath(
      source(LOCAL_WORKSPACE),
      local,
      "/launch",
      "/home/tester",
    ),
  ).toBe("/project");
  expect(
    nativeFolderDefaultPath(
      source(),
      { root: "/remote", env: remote },
      "/launch",
      "/home/tester",
    ),
  ).toBe("/launch");
  expect(
    nativeFolderDefaultPath(
      source({ kind: "wsl", distro: "Ubuntu" }),
      local,
      "/launch",
      null,
    ),
  ).toBe("/fallback");
  expect(
    nativeFolderDefaultPath(
      { ...source(), path: "C:\\work\\a.ts" },
      local,
      null,
      null,
    ),
  ).toBe("C:/work");
  expect(
    nativeFolderDefaultPath(
      undefined,
      undefined,
      "remote://host/folder",
      "/home/tester",
    ),
  ).toBe("/home/tester");
  expect(isNativeFolderPath("/native path ")).toBe(true);
  expect(isNativeFolderPath(null)).toBe(false);
});

const terminal = (
  workspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE,
): TerminalTab => ({
  ...createTabIdentity("main", () => "terminal"),
  id: 2,
  spaceId: "main",
  kind: "terminal",
  title: "Terminal",
  cwd: "/original",
  workspaceEnv,
  activeLeafId: 1,
  paneTree: { kind: "leaf", id: 1, cwd: "/leaf" },
});

it.each([
  remote,
  { kind: "wsl", distro: "Ubuntu" } as WorkspaceEnv,
  { kind: "serial", portName: "COM1", baudRate: 9600 } as WorkspaceEnv,
  {
    kind: "docker",
    connection: {
      containerId: "container",
      containerName: "Build",
      image: "test",
    },
  } as WorkspaceEnv,
])(
  "does not offer a foreign terminal directory to the native picker",
  (env) => {
    expect(
      nativeFolderDefaultPath(
        terminal(env),
        { root: "/remote", env },
        "/launch",
        null,
      ),
    ).toBe("/launch");
  },
);

it("uses the local active leaf but excludes guests and Harness namespaces", () => {
  expect(nativeFolderDefaultPath(terminal(), undefined, "/launch", null)).toBe(
    "/leaf",
  );
  expect(
    nativeFolderDefaultPath(
      { ...terminal(), collaboration: { mode: "guest" } },
      undefined,
      "/launch",
      null,
    ),
  ).toBe("/launch");
  expect(
    nativeFolderDefaultPath(
      {
        ...createTabIdentity("main", () => "harness"),
        id: 3,
        kind: "harness",
        spaceId: "main",
        title: "Harness",
        cwd: "remote://host/project",
      },
      undefined,
      "/launch",
      null,
    ),
  ).toBe("/launch");
  expect(
    nativeFolderDefaultPath(
      {
        ...terminal({ kind: "wsl", distro: "Ubuntu" }),
        paneTree: {
          kind: "leaf",
          id: 1,
          cwd: "\\\\wsl.localhost\\Ubuntu\\project",
        },
      },
      undefined,
      null,
      null,
    ),
  ).toBe("\\\\wsl.localhost\\Ubuntu\\project");
});

it.each(["leaf", "cwd", "connection"])(
  "retires selection when the terminal %s changes",
  async (change) => {
    const tab = terminal(remote);
    await render(tab);
    const deferred = pending();
    mocks.invoke.mockReturnValue(deferred.promise);
    let result!: Promise<boolean>;
    await act(async () => {
      result = open();
    });
    await render({
      ...tab,
      activeLeafId: change === "leaf" ? 2 : 1,
      paneTree:
        change === "cwd"
          ? { kind: "leaf", id: 1, cwd: "/changed" }
          : tab.paneTree,
      workspaceEnv:
        change === "connection"
          ? ({ ...remote, sessionId: 8 } as WorkspaceEnv)
          : remote,
    });
    await render(tab);
    await act(async () => {
      deferred.resolve("/late");
      expect(await result).toBe(false);
    });
    expect(useSpaces.getState().spaces[0].root).toBe("/project");
  },
);
