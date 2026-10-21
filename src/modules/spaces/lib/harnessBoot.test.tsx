// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LaunchRequest } from "@/lib/launchRequest";
import { useSpacesBoot } from "./useSpacesBoot";
import { freshHarnessTab, serializeTabs } from "./serialize";
import { snapshotFromRuntime } from "./sessionSnapshot";
import { asSlotId, asViewSpaceId } from "./spaceLayout";
import type { LoadedSpaces } from "./store";
import { useSpaces } from "./useSpaces";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  load: vi.fn(),
  init: vi.fn(),
  authorize: vi.fn(),
  prefs: { startupSurface: "harness", defaultWorkspaceEnv: "local" },
}));
vi.mock("@/lib/launchRequest", async (original) => ({
  ...(await original<typeof import("@/lib/launchRequest")>()),
  refreshLaunchBootstrap: mocks.refresh,
}));
vi.mock("./store", () => ({ loadAll: mocks.load }));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ ...mocks.prefs, init: mocks.init }),
  },
}));
vi.mock("@/modules/tabs/lib/useTabs", () => ({
  DEFAULT_SPACE_ID: "default",
  NO_ACTIVE_TAB_ID: -1,
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { workspaceAuthorize: mocks.authorize },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let boot!: ReturnType<typeof useSpacesBoot>;
const empty = (): LoadedSpaces => ({
  spaces: [],
  activeId: null,
  states: new Map(),
  session: null,
  migratedLegacy: false,
});
const space = (id: string) => ({
  id,
  name: id,
  root: `/${id}`,
  env: { kind: "local" as const },
  createdAt: 1,
  updatedAt: 1,
});
const request = (
  intent: LaunchRequest["intent"],
  source: LaunchRequest["source"] = "coldStart",
): LaunchRequest => ({
  requestId: intent,
  intent,
  source,
  paths: intent === "openFilesOnly" ? ["/repo/file.ts"] : ["/repo"],
  sourceCwd: "/launch",
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.prefs.startupSurface = "harness";
  mocks.prefs.defaultWorkspaceEnv = "local";
  mocks.init.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue({ instanceId: "test", requests: [] });
  mocks.load.mockResolvedValue(empty());
  mocks.authorize.mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function mount(initialRequest: LaunchRequest | null = null) {
  let nextId = 100;
  const replaceTabs = vi.fn();
  const markBooted = vi.fn();
  const adoptWorkspaceEnv = vi.fn(async () => null);
  function Host() {
    boot = useSpacesBoot({
      ready: true,
      initialRequest,
      launchCwd: "/launch",
      home: "/home",
      allocId: () => ++nextId,
      replaceTabs,
      markBooted,
      setActiveSpaceForNewTabs: vi.fn(),
      adoptWorkspaceEnv,
    });
    return null;
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(Host));
  });
  return { replaceTabs, markBooted, adoptWorkspaceEnv };
}

describe("Harness-first boot", () => {
  it.each(["wsl", "ssh"] as const)(
    "does not reinterpret a saved %s project root as local authority on migration",
    async (kind) => {
      const env =
        kind === "wsl"
          ? { kind: "wsl" as const, distro: "Ubuntu" }
          : {
              kind: "ssh" as const,
              root: "/repo",
              connection: { id: "ssh", name: "SSH", host: "host.test" },
            };
      mocks.load.mockResolvedValue({
        ...empty(),
        spaces: [{ ...space("project"), root: "/repo", env }],
        activeId: "project",
        states: new Map([["project", { tabs: [], activeTabIndex: 0 }]]),
      });
      const result = await mount();
      const [tabs] = result.replaceTabs.mock.calls[0];
      expect(tabs).toHaveLength(1);
      expect(tabs[0].kind).toBe("harness");
      expect(tabs[0].cwd).toBeUndefined();
      expect(tabs[0]).not.toHaveProperty("paneTree");
      expect(mocks.authorize).not.toHaveBeenCalled();
    },
  );

  it("opens an ordinary empty cold start as a local Harness without terminal panes", async () => {
    mocks.prefs.defaultWorkspaceEnv = "wsl:Unrelated";
    const result = await mount();
    const [tabs, active] = result.replaceTabs.mock.calls[0];
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      kind: "harness",
      cwd: "/launch",
      id: active,
    });
    expect(tabs[0]).not.toHaveProperty("paneTree");
    expect(useSpaces.getState().spaces[0].env).toEqual({ kind: "local" });
    expect(mocks.authorize).toHaveBeenCalledWith("/launch");
    expect(result.markBooted).toHaveBeenCalledOnce();
  });

  it.each(["coldStart", "opened"] as const)(
    "opens %s directory at the project's cwd without restoring or creating a terminal",
    async (source) => {
      const directory = request("openDirectoryOnly", source);
      mocks.refresh.mockResolvedValue({
        instanceId: "test",
        requests: [directory],
      });
      const result = await mount();
      expect(mocks.load).not.toHaveBeenCalled();
      expect(result.replaceTabs.mock.calls[0][0]).toEqual([
        expect.objectContaining({ kind: "harness", cwd: "/repo" }),
      ]);
      expect(boot.wasDirectoryRequestAppliedAtBoot(directory.requestId)).toBe(
        true,
      );
      expect(boot.wasDirectoryRequestAppliedAtBoot("different-request")).toBe(
        false,
      );
    },
  );

  it("does not consume a directory request on failure and keeps the predicate stable through retry", async () => {
    const directory = request("openDirectoryOnly", "opened");
    mocks.authorize.mockRejectedValue(new Error("root not authorized"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await mount(directory);
      const predicate = boot.wasDirectoryRequestAppliedAtBoot;
      expect(predicate(directory.requestId)).toBe(false);
      expect(result.replaceTabs).not.toHaveBeenCalled();
      expect(result.markBooted).not.toHaveBeenCalled();
      mocks.authorize.mockResolvedValue(undefined);
      await act(async () => {
        boot.retryBoot();
      });
      expect(boot.wasDirectoryRequestAppliedAtBoot).toBe(predicate);
      expect(predicate(directory.requestId)).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("leaves file-only boot empty for the editor request handler, without hidden Harness", async () => {
    const result = await mount(request("openFilesOnly"));
    expect(result.replaceTabs).toHaveBeenCalledWith([], -1);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(boot.wasDirectoryRequestAppliedAtBoot("openFilesOnly")).toBe(false);
  });

  it("waits for settings before reading the startup mode", async () => {
    let resolve!: () => void;
    mocks.init.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const result = await mount();
    expect(result.replaceTabs).not.toHaveBeenCalled();
    mocks.prefs.startupSurface = "terminal";
    await act(async () => {
      resolve();
    });
    expect(result.replaceTabs.mock.calls[0][0][0].kind).toBe("terminal");
  });

  it("waits for settings on restore before deciding whether to migrate", async () => {
    mocks.load.mockResolvedValue({
      ...empty(),
      spaces: [space("project")],
      activeId: "project",
      states: new Map([
        [
          "project",
          {
            tabs: [{ kind: "editor", path: "/project/file.ts" }],
            activeTabIndex: 0,
          },
        ],
      ]),
    });
    let resolve!: () => void;
    mocks.init.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const result = await mount();
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.prefs.startupSurface = "terminal";
    await act(async () => {
      resolve();
    });
    expect(
      result.replaceTabs.mock.calls[0][0].map(
        (tab: { kind: string }) => tab.kind,
      ),
    ).toEqual(["editor"]);
  });

  it("reports failed preferences hydration and retries rather than silently using defaults", async () => {
    mocks.init.mockRejectedValue(new Error("settings read failed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await mount();
      expect(boot.bootError).toBe(true);
      expect(result.replaceTabs).not.toHaveBeenCalled();
      expect(result.markBooted).not.toHaveBeenCalled();
      mocks.init.mockResolvedValue(undefined);
      await act(async () => {
        boot.retryBoot();
      });
      expect(boot.bootError).toBe(false);
      expect(result.replaceTabs.mock.calls[0][0][0].kind).toBe("harness");
    } finally {
      log.mockRestore();
    }
  });

  it("keeps terminal optout's default shell environment and skips restore migration", async () => {
    mocks.prefs.startupSurface = "terminal";
    mocks.prefs.defaultWorkspaceEnv = "wsl:Ubuntu";
    const result = await mount();
    expect(result.replaceTabs.mock.calls[0][0][0].kind).toBe("terminal");
    expect(useSpaces.getState().spaces[0].env).toEqual({
      kind: "wsl",
      distro: "Ubuntu",
    });
    act(() => root?.unmount());
    root = null;
    container?.remove();
    mocks.load.mockResolvedValue({
      ...empty(),
      spaces: [space("project")],
      activeId: "project",
      states: new Map([
        [
          "project",
          {
            tabs: [{ kind: "editor", path: "/project/file.ts" }],
            activeTabIndex: 0,
          },
        ],
      ]),
    });
    const restored = await mount();
    expect(
      restored.replaceTabs.mock.calls[0][0].map(
        (tab: { kind: string }) => tab.kind,
      ),
    ).toEqual(["editor"]);
  });

  it("migrates missing Harness once without closing old tabs, then respects restored active composite selection", async () => {
    const contexts = [space("project"), space("other")];
    mocks.load.mockResolvedValue({
      ...empty(),
      spaces: contexts,
      activeId: "project",
      states: new Map([
        [
          "project",
          {
            tabs: [
              {
                kind: "editor",
                path: "/project/file.ts",
                tabKey: "tab-editor",
                workspaceScopeId: "project",
              },
            ],
            activeTabIndex: 0,
          },
        ],
        ["other", { tabs: [], activeTabIndex: 0 }],
      ]),
    });
    const first = await mount();
    const [tabs, active] = first.replaceTabs.mock.calls[0];
    expect(tabs.map((tab: { kind: string }) => tab.kind)).toEqual([
      "editor",
      "harness",
      "harness",
    ]);
    expect(tabs.find((tab: { id: number }) => tab.id === active)).toMatchObject(
      { kind: "harness", spaceId: "project" },
    );
    const editor = tabs[0];
    const viewId = asViewSpaceId("view-project");
    const slotId = asSlotId("slot-editor");
    const snapshot = snapshotFromRuntime({
      workspaceContexts: contexts,
      activeWorkspaceContextId: "project",
      tabs,
      activeTabId: editor.id,
      viewSpaces: [
        {
          id: viewId,
          name: "Work",
          presentation: "composite",
          memberOrder: [editor.tabKey],
          focusedSlotId: slotId,
          layout: { kind: "slot", id: slotId, memberTabKey: editor.tabKey },
        },
      ],
      stripEntries: [
        { kind: "space", spaceId: viewId },
        ...tabs.slice(1).map((tab: { tabKey: never }) => ({
          kind: "standalone" as const,
          tabKey: tab.tabKey,
        })),
      ],
      activeStripItem: {
        kind: "space",
        spaceId: viewId,
        focusedSlotId: slotId,
      },
    });
    act(() => root?.unmount());
    root = null;
    container?.remove();
    mocks.load.mockResolvedValue({
      ...empty(),
      spaces: contexts,
      activeId: "project",
      session: snapshot,
      states: new Map(
        contexts.map((context) => [
          context.id,
          {
            tabs: snapshot.tabs.filter(
              (tab) => tab.workspaceScopeId === context.id,
            ),
            activeTabIndex: 0,
          },
        ]),
      ),
    });
    const second = await mount();
    const [restored, selected] = second.replaceTabs.mock.calls[0];
    expect(restored).toHaveLength(3);
    expect(
      restored.find((tab: { id: number }) => tab.id === selected).tabKey,
    ).toBe(editor.tabKey);
    expect(useSpaces.getState().viewSpaces).toEqual(snapshot.viewSpaces);
    expect(useSpaces.getState().stripEntries).toEqual(snapshot.stripEntries);
    expect(useSpaces.getState().activeStripItem).toEqual(
      snapshot.activeStripItem,
    );
  });

  it("does not duplicate a Harness already in a composite", async () => {
    const tab = freshHarnessTab("project", "/project", () => 1);
    const slotId = asSlotId("slot-harness");
    const viewId = asViewSpaceId("view-harness");
    const snapshot = snapshotFromRuntime({
      workspaceContexts: [space("project")],
      activeWorkspaceContextId: "project",
      tabs: [tab],
      activeTabId: 1,
      viewSpaces: [
        {
          id: viewId,
          name: "Work",
          presentation: "composite",
          memberOrder: [tab.tabKey],
          focusedSlotId: slotId,
          layout: { kind: "slot", id: slotId, memberTabKey: tab.tabKey },
        },
      ],
      stripEntries: [{ kind: "space", spaceId: viewId }],
      activeStripItem: {
        kind: "space",
        spaceId: viewId,
        focusedSlotId: slotId,
      },
    });
    mocks.load.mockResolvedValue({
      ...empty(),
      spaces: [space("project")],
      activeId: "project",
      session: snapshot,
      states: new Map([
        ["project", { tabs: serializeTabs([tab]), activeTabIndex: 0 }],
      ]),
    });
    const result = await mount();
    expect(result.replaceTabs.mock.calls[0][0]).toHaveLength(1);
    expect(useSpaces.getState().stripEntries).toEqual(snapshot.stripEntries);
  });
});
