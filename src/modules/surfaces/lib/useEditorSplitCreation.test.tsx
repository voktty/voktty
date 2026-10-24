// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useEditorSplitCreation } from "@/modules/surfaces/lib/useEditorSplitCreation";
import { tabDirectoryTarget } from "@/modules/surfaces/lib/tabDirectoryTarget";
import { useTabs, type EditorTab, type Tab } from "@/modules/tabs/lib/useTabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  disposeSession: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
afterEach(() => vi.unstubAllGlobals());
const editor = (
  id: number,
  spaceId: string,
  workspaceEnv = LOCAL_WORKSPACE,
): EditorTab => ({
  id,
  ...createTabIdentity(spaceId, () => `editor-${id}`),
  spaceId,
  kind: "editor",
  title: "File",
  path: "/source/original.ts",
  dirty: true,
  preview: false,
  workspaceEnv,
});

async function setup(env: WorkspaceEnv = LOCAL_WORKSPACE) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const previous = useSpaces.getState();
  useSpaces.setState({ spaces: [], viewSpaces: [], activeId: "main" });
  useSpaces.getState().create({
    id: "main",
    name: "Main",
    root: "/selected",
    env: LOCAL_WORKSPACE,
  });
  useSpaces
    .getState()
    .create({ id: "source", name: "Source", root: "/source", env });
  useSpaces.setState({ activeId: "main" });
  const root = createRoot(document.createElement("div"));
  let tabs!: ReturnType<typeof useTabs>;
  let split!: ReturnType<typeof useEditorSplitCreation>;
  let selected = 100;
  let destination: object = {};
  const room = vi.fn(() => true);
  const join = vi.fn(() => true);
  const activate = vi.fn();
  const full = vi.fn();
  function Host() {
    tabs = useTabs();
    split = useEditorSplitCreation({
      tabs: tabs.tabs,
      selectedId: selected,
      spaceId: "main",
      limit: 4,
      getTab: tabs.getTab,
      destination: () => destination,
      hasRoom: room,
      open: tabs.openFileTab,
      join,
      activate,
      onFull: full,
    });
    return null;
  }
  const render = () =>
    act(async () =>
      root.render(
        <StrictMode>
          <Host />
        </StrictMode>,
      ),
    );
  await render();
  await act(async () => {
    tabs.replaceTabs([editor(100, "main"), editor(200, "source", env)], 100);
    tabs.setActiveSpaceForNewTabs("main");
  });
  return {
    tabs: () => tabs,
    split: () => split,
    render,
    room,
    join,
    activate,
    full,
    select: (id: number) => {
      selected = id;
    },
    destination: (value: object) => {
      destination = value;
    },
    close: async () => {
      await act(async () => root.unmount());
      useSpaces.setState(previous);
    },
  };
}
it.each<WorkspaceEnv>([
  LOCAL_WORKSPACE,
  { kind: "wsl", distro: "Debian" },
  {
    kind: "ssh",
    connection: { id: "a", name: "A", host: "host-a" },
    root: "/source",
    sessionId: 11,
  },
])(
  "creates a distinct editor beside the original $kind source without replacing its dirty buffer metadata",
  async (workspace) => {
    const fixture = await setup(workspace);
    try {
      const original = fixture.tabs().getTab(200);
      await act(async () => fixture.split().openEditorSplit(200));
      const request = fixture.split().request;
      expect(request?.target).toEqual({ path: "/source", workspace });
      await act(async () => request?.complete("/source/new.ts"));
      const created = fixture
        .tabs()
        .tabs.find(
          (tab) => tab.kind === "editor" && tab.path === "/source/new.ts",
        );
      expect(created).toMatchObject({
        spaceId: "source",
        workspaceEnv: workspace,
        dirty: false,
      });
      expect(fixture.tabs().getTab(200)).toBe(original);
      expect(fixture.tabs().activeId).toBe(100);
      expect(fixture.join).toHaveBeenCalledExactlyOnceWith(
        original,
        created,
        4,
      );
      expect(fixture.activate).toHaveBeenCalledExactlyOnceWith(created?.id);
      expect(fixture.split().request).toBeNull();
    } finally {
      await fixture.close();
    }
  },
);
it.each([
  "selection",
  "source-key",
  "source-path",
  "source-space",
  "workspace",
  "destination",
  "unmount",
] as const)(
  "retires the original creation after %s changes, including round trips",
  async (change) => {
    const fixture = await setup();
    let closed = false;
    try {
      await act(async () => fixture.split().openEditorSplit(200));
      const request = fixture.split().request;
      if (!request) throw new Error("Missing original request");
      if (change === "selection") {
        fixture.select(200);
        await fixture.render();
        fixture.select(100);
        await fixture.render();
      }
      if (change === "source-key" || change === "source-path") {
        const original = fixture.tabs().tabs;
        const altered: Tab[] = original.map((tab) =>
          tab.id !== 200
            ? tab
            : change === "source-key"
              ? { ...tab, tabKey: createTabIdentity("source").tabKey }
              : { ...editor(200, "source"), path: "/source/renamed.ts" },
        );
        await act(async () => fixture.tabs().replaceTabs(altered, 100));
        await act(async () => fixture.tabs().replaceTabs(original, 100));
      }
      if (change === "source-space") {
        const spaces = useSpaces.getState().spaces;
        await act(async () => {
          useSpaces.setState({
            spaces: spaces.filter((space) => space.id !== "source"),
          });
          useSpaces.setState({ spaces });
        });
      }
      if (change === "workspace")
        await act(async () => {
          useSpaces.setState({ activeId: "source" });
          useSpaces.setState({ activeId: "main" });
        });
      if (change === "destination") {
        fixture.destination({});
        await fixture.render();
      }
      if (change === "unmount") {
        await fixture.close();
        closed = true;
      }
      expect(request.current()).toBe(false);
      await act(async () => request.complete("/source/late.ts"));
      expect(
        fixture
          .tabs()
          .tabs.some(
            (tab) => tab.kind === "editor" && tab.path === "/source/late.ts",
          ),
      ).toBe(false);
      expect(fixture.activate).not.toHaveBeenCalled();
    } finally {
      if (!closed) await fixture.close();
    }
  },
);
it("never falls back for an absent id and keeps cached actions and close callbacks retired", async () => {
  const fixture = await setup();
  try {
    await act(async () => fixture.split().openEditorSplit(999));
    expect(fixture.split().request).toBeNull();
    const old = fixture.split().openEditorSplit;
    await act(async () => fixture.split().openEditorSplit(200));
    const original = fixture.split().request;
    await act(async () => fixture.split().openEditorSplit(200));
    const successor = fixture.split().request;
    if (!original || !successor) throw new Error("Missing request");
    await act(async () => fixture.split().close(original));
    expect(fixture.split().request).toBe(successor);
    fixture.select(200);
    await fixture.render();
    fixture.select(100);
    await fixture.render();
    await act(async () => old(200));
    expect(fixture.split().request).toBeNull();
  } finally {
    await fixture.close();
  }
});
it("checks capacity before showing the dialog and before publishing, preserving a declined join", async () => {
  const fixture = await setup();
  try {
    fixture.room.mockReturnValueOnce(false);
    await act(async () => fixture.split().openEditorSplit(200));
    expect(fixture.split().request).toBeNull();
    expect(fixture.full).toHaveBeenCalledOnce();
    await act(async () => fixture.split().openEditorSplit(200));
    fixture.join.mockReturnValueOnce(false);
    await act(async () => fixture.split().request?.complete("/source/new.ts"));
    expect(
      fixture
        .tabs()
        .tabs.some(
          (tab) => tab.kind === "editor" && tab.path === "/source/new.ts",
        ),
    ).toBe(true);
    expect(fixture.activate).not.toHaveBeenCalled();
    expect(fixture.split().request).toBeNull();
  } finally {
    await fixture.close();
  }
});

it("does not close or steal focus from a request opened reentrantly during joining", async () => {
  const fixture = await setup();
  try {
    await act(async () => fixture.split().openEditorSplit(200));
    const original = fixture.split().request;
    fixture.join.mockImplementationOnce(() => {
      fixture.split().openEditorSplit(200);
      return true;
    });
    await act(async () => original?.complete("/source/new.ts"));
    expect(fixture.split().request).not.toBeNull();
    expect(fixture.split().request).not.toBe(original);
    expect(fixture.activate).not.toHaveBeenCalled();
  } finally {
    await fixture.close();
  }
});

it("keeps an explicit Harness project independent of its surrounding terminal workspace", () => {
  const source: Tab = {
    id: 200,
    ...createTabIdentity("source"),
    spaceId: "source",
    kind: "harness",
    title: "Harness",
    cwd: "/local/project",
  };
  const ssh: WorkspaceEnv = {
    kind: "ssh",
    connection: { id: "a", host: "host-a", name: "A" },
    root: "/remote",
    sessionId: 11,
  };
  expect(tabDirectoryTarget(source, { root: "/remote", env: ssh })).toEqual({
    path: "/local/project",
    workspace: LOCAL_WORKSPACE,
  });
  expect(
    tabDirectoryTarget(
      { ...source, cwd: "remote://machine/project" },
      {
        root: "/remote",
        env: { kind: "serial", portName: "COM3", baudRate: 9600 },
      },
    ),
  ).toEqual({ path: "remote://machine/project", workspace: LOCAL_WORKSPACE });
});
