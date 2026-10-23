// @vitest-environment happy-dom
import { StrictMode, act, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectTerminalRequests } from "@/app/hooks/useProjectTerminalRequests";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab } from "@/modules/tabs";
import { useTabs } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { ProjectTerminalTarget } from "@/modules/harness/lib/projectTerminalTarget";
import { ownedPtyTargets } from "@/modules/terminal/lib/ownedPtyTargets";
import { disposePtyTarget, openPty } from "@/modules/terminal/lib/pty-bridge";
import type { PtySession } from "@/modules/terminal/lib/pty-bridge";
import { leafIds } from "@/modules/terminal/lib/panes";
import { hydrateTabs, serializeTabs } from "@/modules/spaces/lib/serialize";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@/modules/harness/lib/projectTerminalTarget", () => ({
  openProjectTerminalTarget: mocks.resolve,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class<T> {
    onmessage: (value: T) => void = () => {};
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const uri = "remote://voktty-ssh-build/srv/app";
let root: Root;
let container: HTMLDivElement;
let source: Tab;
let created: Tab | undefined;
let target: ProjectTerminalTarget;
let mountedLeafId: number | undefined;
const siblingLeaves = new Set<number>();
let create: ReturnType<
  typeof vi.fn<
    (cwd?: string, workspace?: WorkspaceEnv, projectCwd?: string) => number
  >
>;
let rollback: ReturnType<typeof vi.fn<(id: number) => void>>;
let error: ReturnType<typeof vi.fn<(error: unknown) => void>>;
let cancelPicker: ReturnType<typeof vi.fn<(owner: object) => void>>;
const setActiveSpaceForNewTabs = vi.fn();

function View({
  selected = source,
  project = uri,
  spaceId = "main",
}: {
  selected?: Tab;
  project?: string;
  spaceId?: string;
}) {
  useProjectTerminalRequests({
    source: selected,
    spaceId,
    projectCwd: project,
    newTab: create,
    getTab: () => created,
    closeTab: rollback,
    setActiveSpaceForNewTabs,
    pick: vi.fn().mockResolvedValue(null),
    cancelPicker,
    onError: error,
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mountedLeafId = undefined;
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "remote_pty_open" ? 91 : undefined,
  );
  source = {
    id: 1,
    kind: "harness",
    title: "Harness",
    cwd: uri,
    spaceId: "main",
    ...createTabIdentity("main", () => "source"),
  };
  target = {
    cwd: "/srv/app",
    workspace: {
      kind: "ssh",
      root: "/srv/app",
      sessionId: 7,
      connection: { id: "build", name: "Build", host: "build.example" },
    },
    lease: {
      info: {
        session_id: 7,
        workspace_root: "/srv/app",
        architecture: "x86_64",
        helper_version: "test",
        capabilities: [],
      },
      release: vi.fn(),
      releaseAndClose: vi.fn().mockResolvedValue(undefined),
    },
  };
  mocks.resolve.mockResolvedValue(target);
  create = vi.fn().mockImplementation((cwd, workspaceEnv, projectCwd) => {
    created = {
      id: 11,
      kind: "terminal",
      title: "shell",
      cwd,
      workspaceEnv,
      projectCwd,
      paneTree: { kind: "leaf", id: 2, cwd },
      activeLeafId: 2,
      spaceId: "main",
      ...createTabIdentity("main", () => "created"),
    };
    return 11;
  });
  rollback = vi.fn();
  error = vi.fn();
  cancelPicker = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await ownedPtyTargets.close(2);
  await ownedPtyTargets.close(4);
  if (mountedLeafId !== undefined) await ownedPtyTargets.close(mountedLeafId);
  await Promise.all([...siblingLeaves].map((id) => ownedPtyTargets.close(id)));
  siblingLeaves.clear();
  expect(ownedPtyTargets.size()).toBe(0);
  container.remove();
  vi.unstubAllGlobals();
});
async function request(cwd = uri) {
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("voktty:open-new-terminal-tab", { detail: { cwd } }),
    );
  });
}

it("connects the real event receiver to one native remote terminal with the original lease", async () => {
  await act(async () => root.render(<View />));
  await request();
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledWith(
    "/srv/app",
    target.workspace,
    uri,
    undefined,
  );
  expect(setActiveSpaceForNewTabs).toHaveBeenCalledExactlyOnceWith("main");
  const session = await openPty(
    80,
    24,
    { onData: vi.fn() },
    target.cwd,
    false,
    undefined,
    2,
    target.workspace,
  );
  expect(mocks.invoke).toHaveBeenCalledWith(
    "remote_pty_open",
    expect.objectContaining({ sessionId: 7, cwd: "/srv/app" }),
  );
  await act(async () => root.render(null));
  expect(target.lease.releaseAndClose).not.toHaveBeenCalled();
  await session.write("still running\r");
  expect(
    mocks.invoke.mock.calls.some(([command]) => command === "remote_pty_write"),
  ).toBe(true);
  disposePtyTarget(2);
  await ownedPtyTargets.close(2);
  expect(target.lease.releaseAndClose).toHaveBeenCalledOnce();
});

it.each(["project", "space", "tab"])(
  "retires requests when the original %s changes, even after returning to it",
  async (change) => {
    const pending = deferred<ProjectTerminalTarget>();
    mocks.resolve.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<View />));
    await request();
    await vi.waitFor(() => expect(mocks.resolve).toHaveBeenCalledOnce());
    await act(async () =>
      root.render(
        <View
          project={
            change === "project" ? "remote://voktty-ssh-build/srv/other" : uri
          }
          spaceId={change === "space" ? "other" : "main"}
          selected={change === "tab" ? { ...source, id: 3 } : source}
        />,
      ),
    );
    await act(async () => root.render(<View />));
    await act(async () => pending.resolve(target));
    await vi.waitFor(() =>
      expect(target.lease.releaseAndClose).toHaveBeenCalledOnce(),
    );
    expect(create).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(cancelPicker).toHaveBeenCalled();
  },
);

it("retires unresolved requests on unmount without creating a tab or error", async () => {
  const pending = deferred<ProjectTerminalTarget>();
  mocks.resolve.mockReturnValueOnce(pending.promise);
  await act(async () => root.render(<View />));
  await request();
  await vi.waitFor(() => expect(mocks.resolve).toHaveBeenCalledOnce());
  await act(async () => root.render(null));
  await act(async () => pending.resolve(target));
  await vi.waitFor(() =>
    expect(target.lease.releaseAndClose).toHaveBeenCalledOnce(),
  );
  expect(create).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

it("does not duplicate event subscriptions under StrictMode", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <View />
      </StrictMode>,
    ),
  );
  await request();
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(mocks.resolve).toHaveBeenCalledOnce();
});

it("preserves the local creation path without loading a remote destination", async () => {
  await act(async () => root.render(<View />));
  await request("C:/work/app");
  expect(create).toHaveBeenCalledExactlyOnceWith(
    "C:/work/app",
    { kind: "local" },
    undefined,
    undefined,
  );
  expect(mocks.resolve).not.toHaveBeenCalled();
});

it("registers before the canonical tab mounts and releases only when that tab closes", async () => {
  let tabsApi: ReturnType<typeof useTabs> | undefined;
  let createdId: number | undefined;
  function NativeLeaf({ tab }: { tab: Extract<Tab, { kind: "terminal" }> }) {
    useEffect(() => {
      mountedLeafId = tab.activeLeafId;
      void openPty(
        80,
        24,
        { onData: vi.fn() },
        tab.cwd,
        false,
        undefined,
        tab.activeLeafId,
        tab.workspaceEnv,
      ).catch(error);
    }, [tab.activeLeafId, tab.cwd, tab.workspaceEnv]);
    return <div data-native-terminal={tab.id} />;
  }
  function Desktop() {
    const api = useTabs();
    tabsApi = api;
    useLayoutEffect(() => {
      api.replaceTabs([source], source.id);
    }, [api.replaceTabs]);
    useProjectTerminalRequests({
      source: api.tabs.find((tab) => tab.kind === "harness"),
      projectCwd: uri,
      spaceId: "main",
      newTab: (...args) => {
        createdId = api.newTab(...args);
        return createdId;
      },
      getTab: api.getTab,
      closeTab: api.closeTab,
      setActiveSpaceForNewTabs: api.setActiveSpaceForNewTabs,
      pick: vi.fn().mockResolvedValue(null),
      cancelPicker,
      onError: error,
    });
    return api.tabs.map((tab) =>
      tab.kind === "terminal" && !tab.cold ? (
        <NativeLeaf key={tab.id} tab={tab} />
      ) : null,
    );
  }
  await act(async () => root.render(<Desktop />));
  await request();
  await vi.waitFor(() =>
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "remote_pty_open",
      ),
    ).toHaveLength(1),
  );
  expect(createdId).toBeDefined();
  expect(tabsApi?.getTabs()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: createdId,
        kind: "terminal",
        spaceId: "main",
        cwd: "/srv/app",
        projectCwd: uri,
        workspaceEnv: expect.objectContaining({ kind: "ssh", sessionId: 7 }),
      }),
    ]),
  );
  await act(async () => tabsApi?.closeTab(source.id));
  expect(container.querySelectorAll("[data-native-terminal]")).toHaveLength(1);
  expect(target.lease.releaseAndClose).not.toHaveBeenCalled();
  await act(async () => {
    if (createdId !== undefined) tabsApi?.closeTab(createdId);
  });
  await vi.waitFor(() =>
    expect(target.lease.releaseAndClose).toHaveBeenCalledOnce(),
  );
  expect(mocks.invoke).toHaveBeenCalledWith("remote_pty_close", {
    sessionId: 7,
    ptyId: 91,
  });
  expect(error).not.toHaveBeenCalled();
});

it("duplicates and splits canonical project terminals with independent leases and closes only their own leaves", async () => {
  let api!: ReturnType<typeof useTabs>;
  const opened = new Map<number, PtySession>();
  const leases: ProjectTerminalTarget[] = [];
  let helperId = 7;
  target.acquireSibling = vi.fn(async (cwd) => {
    const sessionId = ++helperId;
    const sibling: ProjectTerminalTarget = {
      cwd,
      workspace: { ...target.workspace, sessionId },
      lease: {
        ...target.lease,
        info: { ...target.lease.info, session_id: sessionId },
        releaseAndClose: vi.fn().mockResolvedValue(undefined),
      },
    };
    leases.push(sibling);
    return sibling;
  });
  function Leaf({
    id,
    tab,
  }: {
    id: number;
    tab: Extract<Tab, { kind: "terminal" }>;
  }) {
    useEffect(() => {
      siblingLeaves.add(id);
      void openPty(
        80,
        24,
        { onData: vi.fn() },
        tab.cwd,
        false,
        undefined,
        id,
        tab.workspaceEnv,
      )
        .then((session) => opened.set(id, session))
        .catch(error);
    }, [id, tab.cwd, tab.workspaceEnv]);
    return <div data-leaf={id} />;
  }
  function Desktop() {
    const tabs = useTabs();
    api = tabs;
    useLayoutEffect(
      () => tabs.replaceTabs([source], source.id),
      [tabs.replaceTabs],
    );
    useProjectTerminalRequests({
      source: api.tabs.find((tab) => tab.kind === "harness"),
      projectCwd: uri,
      spaceId: "main",
      newTab: api.newTab,
      getTab: api.getTab,
      closeTab: api.closeTab,
      setActiveSpaceForNewTabs: api.setActiveSpaceForNewTabs,
      pick: vi.fn().mockResolvedValue(null),
      cancelPicker,
      onError: error,
    });
    return api.tabs.flatMap((tab) =>
      tab.kind === "terminal" && !tab.cold
        ? leafIds(tab.paneTree).map((id) => <Leaf key={id} id={id} tab={tab} />)
        : [],
    );
  }
  await act(async () => root.render(<Desktop />));
  await request();
  await vi.waitFor(() => expect(opened.size).toBe(1));
  const original = api.getTabs().find((tab) => tab.kind === "terminal");
  if (!original) throw new Error("Expected the original terminal");
  let duplicateId = -1;
  await act(async () => {
    const id = api.duplicateTab(original.id);
    if (id === null) throw new Error("Expected a duplicate terminal");
    duplicateId = id;
  });
  await vi.waitFor(() => expect(opened.size).toBe(2));
  const duplicate = api.getTab(duplicateId);
  if (!duplicate) throw new Error("Expected a duplicate terminal");
  expect(duplicate.kind).toBe("terminal");
  expect(duplicate).toMatchObject({ projectCwd: uri });
  await act(async () => {
    api.splitActivePane(original.id, "row");
  });
  await vi.waitFor(() => expect(opened.size).toBe(3));
  expect(target.acquireSibling).toHaveBeenCalledTimes(2);
  expect(
    mocks.invoke.mock.calls
      .filter(([command]) => command === "remote_pty_open")
      .map(([, args]) => args.sessionId),
  ).toEqual([7, 8, 9]);
  await act(async () => api.closeTab(source.id));
  expect(target.lease.releaseAndClose).not.toHaveBeenCalled();
  await act(async () => api.closeTab(original.id));
  await vi.waitFor(() =>
    expect(target.lease.releaseAndClose).toHaveBeenCalledOnce(),
  );
  expect(leases[0].lease.releaseAndClose).not.toHaveBeenCalled();
  expect(leases[1].lease.releaseAndClose).toHaveBeenCalledOnce();
  if (duplicate.kind !== "terminal") throw new Error("Expected a terminal");
  const live = opened.get(duplicate.activeLeafId);
  if (!live) throw new Error("Expected the duplicate PTY");
  expect(live.workspace).toMatchObject({ kind: "ssh", sessionId: 8 });
  await live.write("still running\r");
  expect(mocks.invoke).toHaveBeenCalledWith(
    "remote_pty_write",
    expect.any(Uint8Array),
    { headers: { "x-pty-id": "91", "x-remote-session-id": "8" } },
  );
  await act(async () => api.closeTab(duplicate.id));
  await vi.waitFor(() =>
    expect(leases[0].lease.releaseAndClose).toHaveBeenCalledOnce(),
  );
  expect(error).not.toHaveBeenCalled();
});

it("keeps the originating local project through cd, clone, split, move and session hydration", async () => {
  if (source.kind !== "harness") throw new Error("Expected the Harness source");
  source = { ...source, cwd: "/srv/app" };
  let api!: ReturnType<typeof useTabs>;
  function Desktop() {
    const tabs = useTabs();
    api = tabs;
    useLayoutEffect(
      () => tabs.replaceTabs([source], source.id),
      [tabs.replaceTabs],
    );
    useProjectTerminalRequests({
      source,
      projectCwd: "/srv/app",
      spaceId: "main",
      newTab: tabs.newTab,
      getTab: tabs.getTab,
      closeTab: tabs.closeTab,
      setActiveSpaceForNewTabs: tabs.setActiveSpaceForNewTabs,
      pick: vi.fn().mockResolvedValue(null),
      cancelPicker,
      onError: error,
    });
    return null;
  }
  await act(async () => root.render(<Desktop />));
  await request("/srv/app/src");
  const original = api.getTabs().find((tab) => tab.kind === "terminal");
  if (original?.kind !== "terminal")
    throw new Error("Expected project terminal");
  expect(original).toMatchObject({
    projectCwd: "/srv/app",
    cwd: "/srv/app/src",
  });
  await act(async () => api.setLeafCwd(original.activeLeafId, "/tmp/else"));
  let copyId = -1;
  await act(async () => {
    const id = api.duplicateTab(original.id);
    if (id === null) throw new Error("Expected a duplicate");
    copyId = id;
  });
  expect(api.getTab(copyId)).toMatchObject({
    projectCwd: "/srv/app",
    cwd: "/tmp/else",
  });
  await act(async () => {
    api.splitActivePane(original.id, "row");
    api.moveTabToSpace(copyId, "other");
  });
  expect(api.getTab(copyId)).toMatchObject({
    projectCwd: "/srv/app",
    spaceId: "other",
  });
  const split = api.getTab(original.id);
  if (split?.kind !== "terminal") throw new Error("Expected a split terminal");
  expect(leafIds(split.paneTree)).toHaveLength(2);
  let id = 100;
  const restored = hydrateTabs(
    serializeTabs(api.getTabs()),
    "restored",
    () => id++,
  );
  expect(restored.filter((tab) => tab.kind === "terminal")).toHaveLength(2);
  for (const tab of restored.filter((tab) => tab.kind === "terminal"))
    expect(tab.projectCwd).toBe("/srv/app");
  let standaloneId = -1;
  let differentEnvId: number | null = null;
  await act(async () => {
    standaloneId = api.newTab("/srv/app/src");
    differentEnvId = api.duplicateTab(copyId, {
      kind: "wsl",
      distro: "Ubuntu",
    });
  });
  expect(api.getTab(standaloneId)).not.toHaveProperty("projectCwd");
  if (differentEnvId === null) throw new Error("Expected a copied terminal");
  expect(api.getTab(differentEnvId)).not.toHaveProperty("projectCwd");
  await act(async () =>
    api.updateTab(original.id, {
      workspaceEnv: { kind: "wsl", distro: "Ubuntu" },
    }),
  );
  expect(api.getTab(original.id)).toMatchObject({ projectCwd: undefined });
  expect(api.getTab(copyId)).toMatchObject({ projectCwd: "/srv/app" });
  expect(error).not.toHaveBeenCalled();
});
