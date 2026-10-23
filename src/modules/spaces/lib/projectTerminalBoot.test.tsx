// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useSpacesBoot } from "@/modules/spaces/lib/useSpacesBoot";
import { repairSessionSnapshot } from "@/modules/spaces/lib/sessionSnapshot";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import type { Tab } from "@/modules/tabs";
import { terminalCwdTarget } from "@/app/lib/terminalCwd";
import type { WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({ load: vi.fn(), authorize: vi.fn() }));
vi.mock("@/modules/tabs/lib/useTabs", () => ({
  DEFAULT_SPACE_ID: "default",
  NO_ACTIVE_TAB_ID: -1,
}));
vi.mock("@/modules/terminal", async () => ({
  hasLeaf: (await import("@/modules/terminal/lib/panes")).hasLeaf,
}));
vi.mock("@/modules/spaces/lib/store", () => ({ loadAll: mocks.load }));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { workspaceAuthorize: mocks.authorize },
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ init: async () => {}, startupSurface: "terminal" }),
  },
}));
vi.mock("@/lib/launchRequest", async (original) => ({
  ...(await original<typeof import("@/lib/launchRequest")>()),
  refreshLaunchBootstrap: async () => ({ instanceId: "test", requests: [] }),
}));

it("boots a saved SSH terminal as a cold remote descriptor without local host-path authorization", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const snapshot = repairSessionSnapshot({
    schemaVersion: 2,
    workspaceContexts: [
      {
        id: "main",
        name: "Main",
        root: "/local/project",
        env: { kind: "local" },
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    activeWorkspaceContextId: "main",
    tabs: [
      {
        kind: "terminal",
        tabKey: "remote-tab",
        workspaceScopeId: "main",
        remoteProject: "remote://voktty-ssh-build/srv/app",
        tree: {
          kind: "split",
          dir: "row",
          children: [
            { kind: "leaf", cwd: "/srv/app/src", active: true },
            { kind: "leaf", cwd: "/srv/app/test" },
          ],
        },
      },
    ],
    activeTabKey: asTabKey("remote-tab"),
    viewSpaces: [],
    stripEntries: [{ kind: "standalone", tabKey: asTabKey("remote-tab") }],
    activeStripItem: null,
  });
  mocks.load.mockResolvedValue({
    spaces: snapshot.workspaceContexts,
    activeId: "main",
    states: new Map([["main", { tabs: snapshot.tabs, activeTabIndex: 0 }]]),
    session: snapshot,
    migratedLegacy: false,
  });
  const replaced = vi.fn<(tabs: Tab[], activeId: number) => void>();
  const markBooted = vi.fn();
  const adopt = vi
    .fn<(env: WorkspaceEnv) => Promise<WorkspaceEnv | null>>()
    .mockResolvedValue(null);
  let nextId = 100;
  let boot: ReturnType<typeof useSpacesBoot> | undefined;
  function Host() {
    boot = useSpacesBoot({
      ready: true,
      initialRequest: null,
      launchCwd: "/local/launch",
      home: "/local/home",
      allocId: () => nextId++,
      replaceTabs: replaced,
      markBooted,
      setActiveSpaceForNewTabs: vi.fn(),
      adoptWorkspaceEnv: adopt,
    });
    return null;
  }
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () => root.render(createElement(Host)));
    expect(boot?.bootError).toBe(false);
    expect(markBooted).toHaveBeenCalledOnce();
    expect(replaced).toHaveBeenCalledOnce();
    const [tabs, active] = replaced.mock.calls[0];
    expect(tabs).toHaveLength(1);
    const tab = tabs[0];
    if (tab.kind !== "terminal") throw new Error("Missing restored terminal.");
    expect(active).toBe(tab.id);
    expect(tab).toMatchObject({
      cold: true,
      cwd: "remote://voktty-ssh-build/srv/app/src",
      workspaceEnv: {
        kind: "ssh",
        restoredProjectCwd: "remote://voktty-ssh-build/srv/app",
      },
    });
    expect(tab.workspaceEnv).not.toHaveProperty("sessionId");
    expect(
      terminalCwdTarget(tabs, tab.activeLeafId, { kind: "local" })
        ?.authorizeLocally,
    ).toBe(false);
    expect(
      mocks.authorize.mock.calls.some(
        ([path]) => path.startsWith("/srv") || path.startsWith("remote://"),
      ),
    ).toBe(false);
    expect(adopt).toHaveBeenCalledExactlyOnceWith({ kind: "local" });
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});
