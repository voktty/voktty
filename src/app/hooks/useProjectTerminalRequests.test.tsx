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
let create: ReturnType<
  typeof vi.fn<(cwd?: string, workspace?: WorkspaceEnv) => number>
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
  create = vi.fn().mockImplementation((cwd, workspaceEnv) => {
    created = {
      id: 11,
      kind: "terminal",
      title: "shell",
      cwd,
      workspaceEnv,
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
  expect(create).toHaveBeenCalledWith("/srv/app", target.workspace);
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
  expect(create).toHaveBeenCalledExactlyOnceWith("C:/work/app", {
    kind: "local",
  });
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
