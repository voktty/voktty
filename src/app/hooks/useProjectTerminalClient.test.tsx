// @vitest-environment happy-dom
import {
  act,
  StrictMode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, assert, expect, it, vi } from "vitest";
import { useProjectTerminalRequests } from "@/app/hooks/useProjectTerminalRequests";
import {
  requestProjectTerminal,
  PROJECT_TERMINAL_REQUEST_EVENT,
  claimProjectTerminalRequest,
} from "@/modules/terminal/lib/projectTerminalRequest";
import { useTabs } from "@/modules/tabs/lib/useTabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { HarnessTab, TerminalTab, Tab } from "@/modules/tabs";
import type { WorkspacePlacement } from "@/modules/spaces/lib/spaceGeometry";
import type { PaneNode } from "@/modules/terminal/lib/panes";
import { ownedPtyTargets } from "@/modules/terminal/lib/ownedPtyTargets";
import { openPty } from "@/modules/terminal/lib/pty-bridge";
import { leafIds } from "@/modules/terminal/lib/panes";
import type { ProjectTerminalTarget } from "@/modules/harness/lib/projectTerminalTarget";
import { useHarnessTerminalCreation } from "@/modules/harness/hooks/useHarnessTerminalCreation";
import { HarnessTerminalOwner } from "@/modules/harness/hooks/harnessTerminalContext";
import {
  createPersistenceAdmission,
  type PersistenceOwner,
} from "@/modules/harness/lib/persistenceAdmission";
import type { ProjectTerminalReference } from "@/modules/terminal/lib/projectTerminalRequest";
import { CanonicalTerminalCatalog } from "@/modules/terminal/CanonicalTerminalCatalog";
import { labelFor } from "@/modules/tabs/lib/tabLabel";
import { serializeTabs, hydrateTabs } from "@/modules/spaces/lib/serialize";
import { useHarnessTerminalRecovery } from "@/modules/harness/hooks/useHarnessTerminalRecovery";
import { HarnessTerminalMigrationContext } from "@/modules/harness/hooks/harnessTerminalMigrationContext";
import { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { createLegacyTerminalMigrations } from "@/modules/harness/lib/legacyTerminalMigrations";
import {
  newTerminalFile,
  newTerminalWorkspaceTab,
} from "@/modules/harness/lib/layout";
import type { ProjectTerminalDock } from "@/modules/harness/lib/projectTerminal";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  invoke: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/modules/harness/lib/projectTerminalTarget", () => ({
  openProjectTerminalTarget: mocks.resolve,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage = () => {};
  },
}));

const project = "remote://voktty-ssh-build/srv/app";
let root: Root;
let node: HTMLDivElement;
let tabs: ReturnType<typeof useTabs>;
let source: HarnessTab;
let target: ProjectTerminalTarget;
const leaves = new Set<number>();
let dockOwner: PersistenceOwner;
let dockOpen: ReturnType<typeof useHarnessTerminalCreation>["open"];
let dockReferences: ProjectTerminalReference[];
let migrationViews: ReturnType<typeof createHarnessWindowViews>;
let migrationService: ReturnType<typeof createLegacyTerminalMigrations>;
function ColdMigrationClient({ projectCwd }: { projectCwd: string }) {
  const [modelTabs, setModelTabs] = useState(() => {
    const one = newTerminalWorkspaceTab(
      newTerminalFile(`${projectCwd}/src`, "Hidden build"),
    );
    one.terminalPanes[0].files.unshift({
      id: "editor",
      cwd: projectCwd,
      path: `${projectCwd}/notes.txt`,
    });
    one.terminalPanes[0].activeFileId = "editor";
    return [
      one,
      newTerminalWorkspaceTab(
        newTerminalFile(`${projectCwd}/other`, "Inactive build"),
      ),
    ];
  });
  const [docks, setDocks] = useState<ProjectTerminalDock[]>(() => {
    const file = newTerminalFile(`${projectCwd}/dock`, "Closed dock");
    return [
      {
        projectPath: projectCwd,
        side: "bottom",
        size: 240,
        open: false,
        pane: { id: "cold-dock", files: [file], activeFileId: file.id },
      },
    ];
  });
  const creation = useHarnessTerminalCreation({
    projectCwd,
    focused: true,
    capture: () => dockOwner.capture() ?? undefined,
    projectAvailable: () => true,
    onError: mocks.error,
  });
  useHarnessTerminalRecovery({
    projectCwd,
    activeTabId: modelTabs[0].id,
    tabs: modelTabs,
    docks,
    enabled: true,
    capture: () => dockOwner.capture() ?? undefined,
    open: creation.open,
    setTabs: setModelTabs,
    setDocks,
  });
  const read = () => ({
    tabs: modelTabs,
    projectTerminals: docks,
    activeTabId: modelTabs[0].id,
    projectCwd,
    projectReturnMemory: new Map<string, string>(),
    report: {
      referencedSessionIds: [],
      foregroundSessionIds: [],
      activeSessionId: null,
    },
  });
  const initial = useRef(read());
  const handle = useRef<ReturnType<typeof migrationViews.register> | null>(
    null,
  );
  useLayoutEffect(() => {
    handle.current = migrationViews.register(1, initial.current);
    return () => handle.current?.release();
  }, []);
  useLayoutEffect(() => {
    handle.current?.update(read());
  });
  return null;
}
function DockClient({
  projectCwd,
  focused,
}: {
  projectCwd: string;
  focused: boolean;
}) {
  dockOpen = useHarnessTerminalCreation({
    projectCwd,
    focused,
    capture: () => dockOwner.capture() ?? undefined,
    projectAvailable: () => true,
    onError: mocks.error,
  }).open;
  return null;
}
function NativeLeaf({ tab }: { tab: TerminalTab }) {
  useEffect(() => {
    leaves.add(tab.activeLeafId);
    void openPty(
      80,
      24,
      { onData: vi.fn() },
      tab.cwd,
      false,
      undefined,
      tab.activeLeafId,
      tab.workspaceEnv,
    ).catch(mocks.error);
  }, [tab.activeLeafId, tab.cwd, tab.workspaceEnv]);
  return <div data-native-terminal={tab.tabKey} />;
}
function Desktop({
  projectCwd = project,
  withDock = false,
  budgetTabs = [],
  placements,
  renderNative = true,
  migrate = false,
}: {
  projectCwd?: string;
  withDock?: boolean;
  budgetTabs?: readonly Tab[];
  placements?: readonly WorkspacePlacement[];
  renderNative?: boolean;
  migrate?: boolean;
}) {
  const current = useTabs();
  tabs = current;
  const replaceTabs = current.replaceTabs;
  useLayoutEffect(
    () => replaceTabs([{ ...source, cwd: projectCwd }], source.id),
    [replaceTabs, projectCwd],
  );
  useProjectTerminalRequests({
    source: current.tabs.find((tab) => tab.id === current.activeId),
    projectCwd,
    spaceId: "main",
    newTab: current.newTab,
    getTab: current.getTab,
    closeTab: current.closeTab,
    setActiveSpaceForNewTabs: current.setActiveSpaceForNewTabs,
    pick: vi.fn().mockResolvedValue(null),
    cancelPicker: vi.fn(),
    onError: mocks.error,
  });
  return (
    <CanonicalTerminalCatalog
      tabs={[...current.tabs, ...budgetTabs]}
      activeId={current.activeId}
      placements={placements}
    >
      {current.tabs.map((tab) =>
        renderNative && tab.kind === "terminal" && !tab.cold ? (
          <NativeLeaf key={tab.id} tab={tab} />
        ) : null,
      )}
      {withDock && current.tabs.some((tab) => tab.id === source.id) ? (
        <HarnessTerminalOwner
          value={{
            tabKey: source.tabKey,
            visible: true,
            onFocus: () => current.setActiveId(source.id),
          }}
        >
          <DockClient
            projectCwd={projectCwd}
            focused={current.activeId === source.id}
          />
        </HarnessTerminalOwner>
      ) : null}
      {migrate &&
      current.tabs.some(
        (tab) => tab.id === source.id && tab.kind === "harness",
      ) ? (
        <HarnessTerminalMigrationContext value={migrationService}>
          <HarnessTerminalOwner
            value={{ tabKey: source.tabKey, visible: true }}
          >
            <ColdMigrationClient projectCwd={projectCwd} />
          </HarnessTerminalOwner>
        </HarnessTerminalMigrationContext>
      ) : null}
    </CanonicalTerminalCatalog>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function occupiedComposite(count: number) {
  const paneTree: PaneNode = {
    kind: "split",
    id: 500,
    dir: "row",
    children: Array.from({ length: count }, (_, index) => ({
      kind: "leaf",
      id: 501 + index,
    })),
  };
  const terminal: TerminalTab = {
    ...createTabIdentity("main", () => "budget"),
    id: 500,
    spaceId: "main",
    kind: "terminal",
    title: "busy",
    paneTree,
    activeLeafId: 501,
  };
  const placements: WorkspacePlacement[] = [source.id, terminal.id].map(
    (tabId) => ({
      tabId,
      slotId: "slot" as WorkspacePlacement["slotId"],
      rect: { x: 0, y: 0, width: 1, height: 1 },
      focused: tabId === source.id,
    }),
  );
  return { budgetTabs: [terminal], placements };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  leaves.clear();
  dockOwner = createPersistenceAdmission().createOwner();
  dockReferences = [];
  migrationViews = createHarnessWindowViews();
  migrationService = createLegacyTerminalMigrations(migrationViews);
  source = {
    id: 1,
    ...createTabIdentity("main", () => "owner"),
    kind: "harness",
    spaceId: "main",
    title: "Harness",
    cwd: project,
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
  mocks.invoke.mockImplementation(async (command) =>
    command === "remote_pty_open" || command === "pty_open" ? 91 : undefined,
  );
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const tab of tabs?.getTabs() ?? [])
    if (tab.kind === "terminal")
      for (const leaf of leafIds(tab.paneTree)) leaves.add(leaf);
  await Promise.all([...leaves].map((leaf) => ownedPtyTargets.close(leaf)));
  expect(ownedPtyTargets.size()).toBe(0);
  node.remove();
  dockOwner.retire();
  migrationService.dispose();
  vi.unstubAllGlobals();
});

it.each(["local", "ssh"])(
  "retains a captured %s title in the canonical tab, after shell updates and restore",
  async (kind) => {
    const projectCwd = kind === "ssh" ? project : "C:/Work/App";
    await act(async () =>
      root.render(
        <Desktop projectCwd={projectCwd} withDock renderNative={false} />,
      ),
    );
    const title = "Build / producción";
    await act(async () => {
      expect(
        dockOpen({
          slotKey: "dock",
          cwd: `${projectCwd}/src`,
          title,
          onCreated: (reference) => {
            const created = tabs
              .getTabs()
              .find((tab) => tab.tabKey === reference.tabKey);
            assert(created);
            expect(labelFor(created)).toBe(title);
            dockReferences.push(reference);
          },
        }),
      ).toBe(true);
      await vi.waitFor(() => expect(dockReferences).toHaveLength(1));
    });
    const created = tabs
      .getTabs()
      .find((tab) => tab.tabKey === dockReferences[0].tabKey);
    assert(created?.kind === "terminal");
    expect(created.cwd).toBe(
      kind === "ssh" ? "/srv/app/src" : `${projectCwd}/src`,
    );
    expect(created.projectCwd).toBe(projectCwd);
    expect(created.customTitle).toBe(title);
    await act(async () =>
      tabs.updateTab(created.id, { title: "shell update", cwd: "/another" }),
    );
    const updated = tabs.getTab(created.id);
    assert(updated);
    expect(labelFor(updated)).toBe(title);
    const serialized = serializeTabs([updated]);
    let nextId = 100;
    const restored = hydrateTabs(serialized, "main", () => nextId++);
    expect(restored).toHaveLength(1);
    expect(labelFor(restored[0])).toBe(title);
    expect(tabs.activeId).toBe(source.id);
    expect(mocks.error).not.toHaveBeenCalled();
  },
);

it.each(["", "   ", "x".repeat(4097), "bad\nlabel", "bad\u001blabel"])(
  "rejects an invalid request title before dispatch %#",
  async (title) => {
    await act(async () => root.render(<Desktop />));
    const dispatched = vi.fn();
    window.addEventListener(PROJECT_TERMINAL_REQUEST_EVENT, dispatched);
    try {
      expect(() =>
        requestProjectTerminal({
          ownerTabKey: source.tabKey,
          projectCwd: project,
          title,
        }),
      ).toThrow("Invalid");
      expect(dispatched).not.toHaveBeenCalled();
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(tabs.getTabs()).toHaveLength(1);
    } finally {
      window.removeEventListener(PROJECT_TERMINAL_REQUEST_EVENT, dispatched);
    }
  },
);

it("captures the title before an SSH acquisition can mutate the caller options", async () => {
  const pending = deferred<ProjectTerminalTarget>();
  mocks.resolve.mockReturnValueOnce(pending.promise);
  await act(async () => root.render(<Desktop />));
  const options = {
    ownerTabKey: source.tabKey,
    projectCwd: project,
    title: "Original build",
    onCreated: () => tabs.setActiveId(source.id),
  };
  const request = requestProjectTerminal(options);
  options.title = "Replacement label";
  await act(async () => {
    pending.resolve(target);
    await request.result;
  });
  const reference = await request.result;
  const created = tabs.getTabs().find((tab) => tab.tabKey === reference.tabKey);
  assert(created);
  expect(labelFor(created)).toBe("Original build");
});

it.each(["local", "ssh"])(
  "creates a %s dock terminal through the real client and native ownership bridge",
  async (kind) => {
    const projectCwd = kind === "ssh" ? project : "C:/Work/App";
    await act(async () =>
      root.render(<Desktop projectCwd={projectCwd} withDock />),
    );
    await act(async () => {
      expect(
        dockOpen({
          slotKey: "dock",
          cwd: `${projectCwd}/src`,
          onCreated: (reference) => {
            dockReferences.push(reference);
          },
        }),
      ).toBe(true);
      await vi.waitFor(() => expect(dockReferences).toHaveLength(1));
    });
    expect(tabs.activeId).toBe(source.id);
    expect(node.querySelectorAll("[data-native-terminal]")).toHaveLength(1);
    const created = tabs
      .getTabs()
      .find((tab) => tab.tabKey === dockReferences[0].tabKey);
    expect(created?.kind).toBe("terminal");
    if (created?.kind !== "terminal") throw new Error("Missing dock terminal");
    expect(created.projectCwd).toBe(projectCwd);
    if (kind === "ssh")
      expect(ownedPtyTargets.get(created.activeLeafId)?.isCurrent()).toBe(true);
    expect(mocks.error).not.toHaveBeenCalled();
    await act(async () => tabs.closeTab(source.id));
    expect(node.querySelectorAll("[data-native-terminal]")).toHaveLength(1);
  },
);

it.each(["local", "ssh"])(
  "refuses a %s dock request before native acquisition when the composite is full",
  async (kind) => {
    const projectCwd = kind === "ssh" ? project : "C:/Work/App";
    await act(async () =>
      root.render(
        <Desktop projectCwd={projectCwd} withDock {...occupiedComposite(8)} />,
      ),
    );
    mocks.invoke.mockClear();
    await act(async () => {
      expect(
        dockOpen({
          slotKey: "dock",
          cwd: projectCwd,
          onCreated: (reference) => {
            dockReferences.push(reference);
          },
        }),
      ).toBe(false);
    });
    expect(dockReferences).toEqual([]);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(tabs.getTabs()).toHaveLength(1);
    expect(mocks.error).toHaveBeenCalledOnce();
  },
);

it("retains settled capacity across delayed presentation and focus changes, then releases it on view retirement", async () => {
  const projectCwd = "C:/Work/App";
  const budget = occupiedComposite(7);
  await act(async () =>
    root.render(<Desktop projectCwd={projectCwd} withDock {...budget} />),
  );
  const onCreated = (reference: ProjectTerminalReference) => {
    dockReferences.push(reference);
  };
  await act(async () => {
    expect(dockOpen({ slotKey: "dock", cwd: projectCwd, onCreated })).toBe(
      true,
    );
    await vi.waitFor(() => expect(dockReferences).toHaveLength(1));
  });
  const created = tabs
    .getTabs()
    .find((tab) => tab.tabKey === dockReferences[0].tabKey);
  assert(created);
  await act(async () => tabs.setActiveId(created.id));
  await act(async () => tabs.setActiveId(source.id));
  await act(async () => {
    expect(dockOpen({ slotKey: "other", cwd: projectCwd, onCreated })).toBe(
      false,
    );
  });
  expect(dockReferences).toHaveLength(1);
  await act(async () =>
    root.render(<Desktop projectCwd={projectCwd} {...budget} />),
  );
  await act(async () =>
    root.render(<Desktop projectCwd={projectCwd} withDock {...budget} />),
  );
  await act(async () => {
    expect(dockOpen({ slotKey: "other", cwd: projectCwd, onCreated })).toBe(
      true,
    );
    await vi.waitFor(() => expect(dockReferences).toHaveLength(2));
  });
});

it("retires an SSH admission when the composite fills and does not revive it after capacity returns", async () => {
  const pending = deferred<ProjectTerminalTarget>();
  mocks.resolve.mockReturnValueOnce(pending.promise);
  await act(async () =>
    root.render(<Desktop withDock {...occupiedComposite(7)} />),
  );
  await act(async () => {
    expect(
      dockOpen({
        slotKey: "dock",
        cwd: project,
        onCreated: (reference) => {
          dockReferences.push(reference);
        },
      }),
    ).toBe(true);
    await vi.waitFor(() => expect(mocks.resolve).toHaveBeenCalledOnce());
  });
  await act(async () =>
    root.render(<Desktop withDock {...occupiedComposite(8)} />),
  );
  expect(mocks.resolve.mock.calls[0][2]()).toBe(false);
  await act(async () =>
    root.render(<Desktop withDock {...occupiedComposite(7)} />),
  );
  expect(mocks.resolve.mock.calls[0][2]()).toBe(false);
  await act(async () => {
    pending.resolve(target);
  });
  await vi.waitFor(() =>
    expect(target.lease.releaseAndClose).toHaveBeenCalledOnce(),
  );
  expect(dockReferences).toEqual([]);
  expect(tabs.getTabs().some((tab) => tab.kind === "terminal")).toBe(false);
  expect(mocks.error).not.toHaveBeenCalled();
});

it("releases a late SSH lease when the dock client unmounts during acquisition", async () => {
  const pending = deferred<ProjectTerminalTarget>();
  mocks.resolve.mockReturnValueOnce(pending.promise);
  await act(async () => root.render(<Desktop withDock />));
  await act(async () => {
    dockOpen({
      slotKey: "dock",
      cwd: project,
      onCreated: (reference) => {
        dockReferences.push(reference);
      },
    });
  });
  await act(async () => tabs.closeTab(source.id));
  await act(async () => {
    pending.resolve(target);
  });
  await vi.waitFor(() =>
    expect(target.lease.releaseAndClose).toHaveBeenCalledOnce(),
  );
  expect(dockReferences).toEqual([]);
  expect(tabs.getTabs().some((tab) => tab.kind === "terminal")).toBe(false);
  expect(mocks.error).not.toHaveBeenCalled();
});

it("confirms the stable tabKey after lease registration and preserves Harness focus before the terminal mounts", async () => {
  await act(async () => root.render(<Desktop />));
  const onCreated = vi.fn((reference: { tabKey: string }) => {
    const created = tabs
      .getTabs()
      .find((tab) => tab.tabKey === reference.tabKey);
    if (created?.kind !== "terminal")
      throw new Error("Missing canonical terminal.");
    expect(ownedPtyTargets.get(created.activeLeafId)?.isCurrent()).toBe(true);
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "remote_pty_open",
      ),
    ).toBe(false);
    tabs.setActiveId(source.id);
  });
  let request!: ReturnType<typeof requestProjectTerminal>;
  await act(async () => {
    request = requestProjectTerminal({
      ownerTabKey: source.tabKey,
      projectCwd: project,
      cwd: `${project}/src`,
      onCreated,
    });
    await request.result;
  });
  const reference = await request.result;
  expect(reference).toEqual({ tabKey: expect.any(String) });
  expect(reference).not.toHaveProperty("tabId");
  expect(tabs.activeId).toBe(source.id);
  expect(onCreated).toHaveBeenCalledOnce();
  expect(mocks.resolve).toHaveBeenCalledWith(
    project,
    expect.any(Function),
    expect.any(Function),
  );
  expect(mocks.invoke).toHaveBeenCalledWith(
    "remote_pty_open",
    expect.objectContaining({ sessionId: 7, cwd: "/srv/app/src" }),
  );
  expect(node.querySelectorAll("[data-native-terminal]")).toHaveLength(1);
  await act(async () => tabs.closeTab(source.id));
  expect(node.querySelectorAll("[data-native-terminal]")).toHaveLength(1);
  expect(target.lease.releaseAndClose).not.toHaveBeenCalled();
});

it("keeps local admission synchronous and does not steal Harness focus", async () => {
  const local = "C:/Work/App";
  await act(async () => root.render(<Desktop projectCwd={local} />));
  let request!: ReturnType<typeof requestProjectTerminal>;
  const onCreated = vi.fn(() => tabs.setActiveId(source.id));
  await act(async () => {
    request = requestProjectTerminal({
      ownerTabKey: source.tabKey,
      projectCwd: local,
      cwd: "C:/Work/App/src",
      onCreated,
    });
    expect(onCreated).toHaveBeenCalledOnce();
    await request.result;
  });
  expect(tabs.activeId).toBe(source.id);
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(
    tabs
      .getTabs()
      .some((tab) => tab.kind === "terminal" && tab.projectCwd === local),
  ).toBe(true);
});

it.each(["caller", "view"])(
  "cleans late leases after retiring the %s before creation",
  async (reason) => {
    const pending = deferred<ProjectTerminalTarget>();
    mocks.resolve.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<Desktop />));
    const onCreated = vi.fn();
    const request = requestProjectTerminal({
      ownerTabKey: source.tabKey,
      projectCwd: project,
      onCreated,
    });
    const retired = expect(request.result).rejects.toMatchObject({
      name: "AbortError",
    });
    if (reason === "caller") request.cancel();
    else await act(async () => tabs.closeTab(source.id));
    await act(async () => {
      pending.resolve(target);
      await retired;
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(tabs.getTabs().some((tab) => tab.kind === "terminal")).toBe(false);
    expect(target.lease.releaseAndClose).toHaveBeenCalledOnce();
    expect(mocks.error).not.toHaveBeenCalled();
  },
);

it("rolls back a failed synchronous binding without leaving a canonical terminal or lease", async () => {
  await act(async () => root.render(<Desktop />));
  await act(async () => {
    const request = requestProjectTerminal({
      ownerTabKey: source.tabKey,
      projectCwd: project,
      onCreated: () => {
        throw new Error("binding failed");
      },
    });
    await expect(request.result).rejects.toThrow("binding failed");
  });
  expect(tabs.getTabs().filter((tab) => tab.kind === "terminal")).toHaveLength(
    0,
  );
  expect(target.lease.releaseAndClose).toHaveBeenCalledOnce();
  expect(mocks.error).not.toHaveBeenCalled();
});

it("rejects another view or project and ignores forged creation events", async () => {
  await act(async () => root.render(<Desktop />));
  await expect(
    requestProjectTerminal({
      ownerTabKey: createTabIdentity("main", () => "other").tabKey,
      projectCwd: project,
    }).result,
  ).rejects.toThrow("unavailable");
  await expect(
    requestProjectTerminal({
      ownerTabKey: source.tabKey,
      projectCwd: "remote://voktty-ssh-other/srv/app",
    }).result,
  ).rejects.toThrow("unavailable");
  window.dispatchEvent(
    new CustomEvent(PROJECT_TERMINAL_REQUEST_EVENT, {
      detail: { ownerTabKey: source.tabKey, projectCwd: project, cwd: project },
    }),
  );
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(tabs.getTabs()).toHaveLength(1);
});

it("keeps retired client requests counted until claimed work actually settles", async () => {
  const claimed: Array<
    NonNullable<ReturnType<typeof claimProjectTerminalRequest>>
  > = [];
  const listener = (event: Event) => {
    const ticket = claimProjectTerminalRequest(event, source.tabKey, project);
    if (ticket) claimed.push(ticket);
  };
  window.addEventListener(PROJECT_TERMINAL_REQUEST_EVENT, listener);
  const requests = Array.from({ length: 256 }, () =>
    requestProjectTerminal({ ownerTabKey: source.tabKey, projectCwd: project }),
  );
  const outcomes = Promise.allSettled(
    requests.map((request) => request.result),
  );
  try {
    expect(claimed).toHaveLength(256);
    for (const request of requests) request.cancel();
    expect(claimed.every((ticket) => !ticket.isCurrent())).toBe(true);
    expect(() =>
      requestProjectTerminal({
        ownerTabKey: source.tabKey,
        projectCwd: project,
      }),
    ).toThrow("limit");
  } finally {
    for (const request of requests) request.cancel();
    for (const ticket of claimed) ticket.finish();
    await outcomes;
    window.removeEventListener(PROJECT_TERMINAL_REQUEST_EVENT, listener);
  }
  for (const outcome of await outcomes) {
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected")
      expect(outcome.reason).toMatchObject({ name: "AbortError" });
  }
  await act(async () => root.render(<Desktop />));
  const next = requestProjectTerminal({
    ownerTabKey: source.tabKey,
    projectCwd: project,
  });
  next.cancel();
  await expect(next.result).rejects.toMatchObject({ name: "AbortError" });
});

it.each(["C:/Work/App", "//files/share/app", project])(
  "creates cold metadata for %s without selecting a tab, opening a PTY or resolving SSH",
  async (projectCwd) => {
    await act(async () => root.render(<Desktop projectCwd={projectCwd} />));
    let reference!: ProjectTerminalReference;
    await act(async () => {
      reference = await requestProjectTerminal({
        ownerTabKey: source.tabKey,
        projectCwd,
        cwd: `${projectCwd}/src`,
        title: "Hidden build",
        cold: true,
      }).result;
    });
    const created = tabs
      .getTabs()
      .find((tab) => tab.tabKey === reference.tabKey);
    assert(created?.kind === "terminal");
    expect(created).toMatchObject({
      cold: true,
      cwd: `${projectCwd}/src`,
      projectCwd,
      title: "Hidden build",
      customTitle: "Hidden build",
    });
    expect(tabs.activeId).toBe(source.id);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(ownedPtyTargets.size()).toBe(0);
    expect(node.querySelectorAll("[data-native-terminal]")).toHaveLength(0);
    if (projectCwd === project) {
      expect(created.workspaceEnv).toMatchObject({
        kind: "ssh",
        restoredProjectCwd: project,
        root: "/srv/app",
        connection: { id: "build", host: "" },
      });
      expect(created.workspaceEnv).not.toHaveProperty("sessionId");
    }
  },
);

it("restores a cold SSH terminal and acquires its independent helper only when warmed", async () => {
  await act(async () => root.render(<Desktop />));
  let reference!: ProjectTerminalReference;
  await act(async () => {
    reference = await requestProjectTerminal({
      ownerTabKey: source.tabKey,
      projectCwd: project,
      cwd: `${project}/src`,
      title: "Hidden build",
      cold: true,
    }).result;
  });
  const created = tabs.getTabs().find((tab) => tab.tabKey === reference.tabKey);
  assert(created?.kind === "terminal");
  const serialized = serializeTabs([created]);
  let id = 700;
  const restored = hydrateTabs(serialized, "main", () => id++);
  expect(restored[0]).toMatchObject({
    cold: true,
    customTitle: "Hidden build",
    projectCwd: project,
  });
  await act(async () => tabs.replaceTabs([source, ...restored], source.id));
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
  await act(async () => tabs.warmTabs([restored[0].id]));
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith(
      "remote_pty_open",
      expect.objectContaining({ sessionId: 7, cwd: "/srv/app/src" }),
    ),
  );
  expect(mocks.resolve).toHaveBeenCalledOnce();
  assert(restored[0]?.kind === "terminal");
  expect(ownedPtyTargets.get(restored[0].activeLeafId)?.isCurrent()).toBe(true);
  expect(mocks.error).not.toHaveBeenCalled();
});

it.each(["yes", 1, null])(
  "rejects invalid cold mode %# before dispatch or allocation",
  async (cold) => {
    await act(async () => root.render(<Desktop />));
    const input = {
      ownerTabKey: source.tabKey,
      projectCwd: project,
      cold: true,
    };
    Object.assign(input, { cold });
    expect(() => requestProjectTerminal(input)).toThrow("Invalid");
    expect(tabs.getTabs()).toHaveLength(1);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  },
);

it("rolls back a cold descriptor when its original permission retires during confirmation", async () => {
  await act(async () => root.render(<Desktop />));
  let current = true;
  await act(async () => {
    const request = requestProjectTerminal({
      ownerTabKey: source.tabKey,
      projectCwd: project,
      cold: true,
      isCurrent: () => current,
      onCreated: () => {
        current = false;
      },
    });
    await expect(request.result).rejects.toThrow("retired");
  });
  expect(tabs.getTabs()).toHaveLength(1);
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("does not spend visible renderer capacity for a cold hidden descriptor", async () => {
  await act(async () =>
    root.render(<Desktop withDock {...occupiedComposite(8)} />),
  );
  await act(async () => {
    expect(
      dockOpen({
        slotKey: "hidden-migration",
        cwd: `${project}/src`,
        cold: true,
        onCreated: (reference) => {
          dockReferences.push(reference);
        },
      }),
    ).toBe(true);
  });
  expect(dockReferences).toHaveLength(1);
  const created = tabs
    .getTabs()
    .find((tab) => tab.tabKey === dockReferences[0].tabKey);
  expect(created).toMatchObject({ cold: true, projectCwd: project });
  expect(tabs.activeId).toBe(source.id);
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});

it.each(["C:/Work/App", project])(
  "migrates hidden panes, inactive tabs and closed docks for %s through the real desktop client without connecting",
  async (projectCwd) => {
    await act(async () =>
      root.render(<Desktop projectCwd={projectCwd} migrate />),
    );
    const terminals = tabs.getTabs().filter((tab) => tab.kind === "terminal");
    expect(terminals).toHaveLength(3);
    expect(
      terminals.every((tab) => tab.cold && tab.projectCwd === projectCwd),
    ).toBe(true);
    expect(terminals.map((tab) => tab.customTitle)).toEqual([
      "Hidden build",
      "Inactive build",
      "Closed dock",
    ]);
    expect(tabs.activeId).toBe(source.id);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    const capture = migrationViews.capture([]);
    const files = [
      ...capture.tabs.flatMap((tab) =>
        tab.terminalPanes.flatMap((pane) => pane.files),
      ),
      ...capture.projectTerminals.flatMap((dock) => dock.pane.files),
    ].filter((file) => file.terminal);
    expect(files).toHaveLength(3);
    expect(
      files.every((file) => file.canonicalTerminal?.projectCwd === projectCwd),
    ).toBe(true);
    expect(capture.projectTerminals[0]).toMatchObject({
      open: false,
      side: "bottom",
      size: 240,
    });
    expect(mocks.error).not.toHaveBeenCalled();
  },
);

it("does not duplicate hidden metadata during StrictMode replay", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Desktop migrate />
      </StrictMode>,
    ),
  );
  expect(tabs.getTabs().filter((tab) => tab.kind === "terminal")).toHaveLength(
    3,
  );
  expect(
    migrationViews.capture([]).projectTerminals[0].pane.files[0]
      .canonicalTerminal,
  ).toBeDefined();
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});

it("retires a claimed cold batch when its originating Harness view closes", async () => {
  const claimed: Array<
    NonNullable<ReturnType<typeof claimProjectTerminalRequest>>
  > = [];
  const listener = (event: Event) => {
    const ticket = claimProjectTerminalRequest(event, source.tabKey, project);
    if (ticket) claimed.push(ticket);
  };
  window.addEventListener(PROJECT_TERMINAL_REQUEST_EVENT, listener);
  try {
    await act(async () => root.render(<Desktop migrate />));
    expect(claimed).toHaveLength(1);
    expect(claimed[0].cold).toBe(true);
    await act(async () => tabs.closeTab(source.id));
    expect(claimed[0].signal.aborted).toBe(true);
    await act(async () => claimed[0].finish());
    expect(tabs.getTabs()).toEqual([]);
    expect(
      migrationViews.capture([]).projectTerminals[0].pane.files[0]
        .canonicalTerminal,
    ).toBeUndefined();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  } finally {
    for (const ticket of claimed) ticket.finish();
    window.removeEventListener(PROJECT_TERMINAL_REQUEST_EVENT, listener);
  }
});
