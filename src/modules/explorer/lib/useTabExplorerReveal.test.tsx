// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTabExplorerReveal } from "@/modules/explorer/lib/useTabExplorerReveal";
import type { FileExplorerHandle } from "@/modules/explorer/FileExplorer";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { EditorTab, Tab } from "@/modules/tabs/lib/useTabs";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";

const mocks = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: mocks.info, error: mocks.error } }));
let root: Root;
let node: HTMLDivElement;
let revealTab: ReturnType<typeof useTabExplorerReveal>;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let explorerRef: { current: FileExplorerHandle | null };
let read: ReturnType<typeof vi.fn<FileExplorerHandle["reveal"]>>;
let focus: ReturnType<typeof vi.fn<FileExplorerHandle["focus"]>>;
let open: ReturnType<typeof vi.fn<() => void>>;
const source = (
  path = "/work/a.ts",
  workspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE,
): EditorTab => ({
  ...createTabIdentity("main", () => "source"),
  id: 1,
  kind: "editor",
  spaceId: "main",
  path,
  title: "file",
  workspaceEnv,
  dirty: false,
  preview: false,
});
const other = source("/work/b.ts");
other.id = 2;
other.tabKey = createTabIdentity("main", () => "other").tabKey;
type Props = {
  tabs: Tab[];
  selected?: Tab["tabKey"];
  workspace?: WorkspaceEnv;
  rootPath?: string;
  ready?: boolean;
};
function Probe({
  tabs,
  selected = other.tabKey,
  workspace = LOCAL_WORKSPACE,
  rootPath = "/work",
  ready = true,
}: Props) {
  revealTab = useTabExplorerReveal({
    tabs,
    selectedTabKey: selected,
    spaceId: "main",
    workspace,
    root: rootPath,
    ready,
    explorerRef,
    openExplorer: open,
  });
  return null;
}
async function render(props: Props) {
  await act(async () =>
    root.render(
      <StrictMode>
        <Probe {...props} />
      </StrictMode>,
    ),
  );
}
async function request(tab: Tab) {
  await act(async () => revealTab(tab));
}
async function flushFrames() {
  const current = [...frames.values()];
  frames.clear();
  await act(async () => {
    for (const frame of current) frame(0);
  });
}
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function capturedGuard() {
  const guard = read.mock.calls[0]?.[1];
  if (!guard) throw new Error("Missing original guard.");
  return guard;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
    frames.set(++frameId, frame);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  mocks.info.mockReset();
  mocks.error.mockReset();
  read = vi.fn<FileExplorerHandle["reveal"]>().mockResolvedValue(true);
  focus = vi.fn<FileExplorerHandle["focus"]>();
  open = vi.fn<() => void>();
  explorerRef = {
    current: {
      reveal: read,
      focus,
      isFocused: () => false,
      focusSearch: () => {},
    },
  };
  useSpaces.setState({
    activeId: "main",
    spaces: [
      {
        id: "main",
        name: "Main",
        root: "/work",
        env: LOCAL_WORKSPACE,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(frames.size).toBe(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("delivers the pointed background tab and waits for the committed Explorer mount", async () => {
  const tab = source();
  await render({ tabs: [tab, other], ready: false });
  await request(tab);
  expect(open).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  await render({ tabs: [tab, other], ready: true });
  await flushFrames();
  expect(read).toHaveBeenCalledWith("/work/a.ts", expect.any(Function));
  expect(capturedGuard()()).toBe(true);
  expect(focus).toHaveBeenCalledOnce();
  expect(focus).toHaveBeenCalledWith({ preserveSelection: true });
});

it.each([
  "selection",
  "root",
  "workspace",
  "removed",
  "replaced",
  "path",
  "hidden",
  "unmount",
])(
  "retires the original request after %s without focus, fallback or stale notification",
  async (change) => {
    const tab = source();
    const props = { tabs: [tab, other] };
    await render(props);
    const deferred = pending<boolean>();
    read.mockReturnValueOnce(deferred.promise);
    await request(tab);
    await flushFrames();
    const guard = capturedGuard();
    if (change === "selection") {
      await render({ ...props, selected: tab.tabKey });
      await render(props);
    }
    if (change === "root") {
      await render({ ...props, rootPath: "/other" });
      await render(props);
    }
    if (change === "workspace")
      await render({ ...props, workspace: { kind: "wsl", distro: "Ubuntu" } });
    if (change === "removed") {
      await render({ tabs: [other] });
      await render(props);
    }
    if (change === "replaced")
      await render({
        tabs: [
          { ...tab, ...createTabIdentity("main", () => "replacement") },
          other,
        ],
      });
    if (change === "path") {
      await render({ tabs: [{ ...tab, path: "/work/moved.ts" }, other] });
      await render(props);
    }
    if (change === "hidden") {
      await render({ ...props, ready: false });
      await render(props);
    }
    if (change === "unmount") await act(async () => root.render(null));
    expect(guard()).toBe(false);
    deferred.resolve(false);
    await act(async () => {
      await deferred.promise;
    });
    expect(focus).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
  },
);

it("rejects retired source metadata and old context callbacks before delivery", async () => {
  const tab = source();
  await render({ tabs: [tab, other] });
  const cached = revealTab;
  await render({ tabs: [tab, other], selected: tab.tabKey });
  await act(async () => cached(tab));
  await flushFrames();
  expect(open).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  await request({ ...tab, path: "/wrong/path" });
  expect(open).not.toHaveBeenCalled();
});

it("supersedes the previous request while keeping its already admitted read isolated", async () => {
  const tab = source();
  await render({ tabs: [tab, other] });
  const deferred = pending<boolean>();
  read.mockReturnValueOnce(deferred.promise);
  await request(tab);
  await flushFrames();
  const old = capturedGuard();
  await request(other);
  await flushFrames();
  expect(old()).toBe(false);
  deferred.resolve(false);
  await act(async () => {
    await deferred.promise;
  });
  expect(focus).toHaveBeenCalledOnce();
  expect(mocks.info).not.toHaveBeenCalled();
  expect(read.mock.calls.map(([path]) => path)).toEqual([tab.path, other.path]);
});

it("offers the original remote folder without reading a same-named local path and retires the toast on context change", async () => {
  const env: WorkspaceEnv = {
    kind: "ssh",
    root: "/work",
    sessionId: 7,
    connection: { id: "build", name: "Build", host: "build.example" },
  };
  const tab = source("/work/src/a.ts", env);
  await render({ tabs: [tab, other] });
  await request(tab);
  await flushFrames();
  expect(read).not.toHaveBeenCalled();
  expect(mocks.info).toHaveBeenCalledOnce();
  const action = mocks.info.mock.calls[0][1].action.onClick;
  const setRoot = vi.spyOn(useSpaces.getState(), "setRoot");
  const setEnv = vi.spyOn(useSpaces.getState(), "setEnv");
  await act(async () => action());
  expect(setRoot).toHaveBeenCalledWith("main", "/work/src");
  expect(setEnv).toHaveBeenCalledWith("main", env);
  expect(useWorkspaceEnvStore.getState().env).toBe(env);
  await render({ tabs: [tab, other], selected: tab.tabKey });
  setRoot.mockClear();
  setEnv.mockClear();
  await act(async () => action());
  expect(setRoot).not.toHaveBeenCalled();
  expect(setEnv).not.toHaveBeenCalled();
});

it("does not focus a replacement Explorer after the original read settles", async () => {
  const tab = source();
  await render({ tabs: [tab, other] });
  const deferred = pending<boolean>();
  read.mockReturnValueOnce(deferred.promise);
  await request(tab);
  await flushFrames();
  const replacement = vi.fn();
  explorerRef.current = {
    reveal: read,
    focus: replacement,
    isFocused: () => false,
    focusSearch: () => {},
  };
  await render({ tabs: [tab, other], rootPath: "/successor" });
  deferred.resolve(true);
  await act(async () => {
    await deferred.promise;
  });
  expect(focus).not.toHaveBeenCalled();
  expect(replacement).not.toHaveBeenCalled();
});

it("observes read and sidebar failures only for their current request", async () => {
  const tab = source();
  await render({ tabs: [tab, other] });
  read.mockRejectedValueOnce(new Error("read failed"));
  await request(tab);
  await flushFrames();
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(focus).not.toHaveBeenCalled();
  mocks.error.mockClear();
  open.mockImplementationOnce(() => {
    throw new Error("panel failed");
  });
  await request(tab);
  await flushFrames();
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
});

it("stops a containing-folder action between stages if workspace selection changes reentrantly", async () => {
  const env: WorkspaceEnv = {
    kind: "ssh",
    root: "/work",
    connection: { id: "build", name: "Build", host: "build.example" },
  };
  const tab = source("/work/src/a.ts", env);
  await render({ tabs: [tab, other] });
  await request(tab);
  await flushFrames();
  const action = mocks.info.mock.calls[0][1].action.onClick;
  const setEnv = vi.spyOn(useSpaces.getState(), "setEnv");
  vi.spyOn(useSpaces.getState(), "setRoot").mockImplementationOnce(() =>
    useSpaces.setState({ activeId: "other" }),
  );
  await act(async () => action());
  expect(setEnv).not.toHaveBeenCalled();
  expect(useWorkspaceEnvStore.getState().env).toBe(LOCAL_WORKSPACE);
});

it("does not adopt a new reader in the same desktop context or offer a folder after the old one retires", async () => {
  const tab = source();
  await render({ tabs: [tab, other] });
  const deferred = pending<boolean>();
  read.mockReturnValueOnce(deferred.promise);
  await request(tab);
  await flushFrames();
  const guard = capturedGuard();
  const replacement = vi.fn();
  explorerRef.current = {
    reveal: vi.fn().mockResolvedValue(true),
    focus: replacement,
    isFocused: () => false,
    focusSearch: () => {},
  };
  expect(guard()).toBe(false);
  deferred.resolve(false);
  await act(async () => {
    await deferred.promise;
  });
  expect(focus).not.toHaveBeenCalled();
  expect(replacement).not.toHaveBeenCalled();
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});
