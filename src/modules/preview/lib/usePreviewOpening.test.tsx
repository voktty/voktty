// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useTabs, type EditorTab, type Tab } from "@/modules/tabs/lib/useTabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import { usePreviewOpening } from "@/modules/preview/lib/usePreviewOpening";
vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  disposeSession: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
afterEach(() => vi.unstubAllGlobals());
function editor(id: number): EditorTab {
  return {
    id,
    ...createTabIdentity(`space-${id}`),
    spaceId: `space-${id}`,
    kind: "editor",
    title: "Page",
    path: `/project-${id}/page #1.html`,
    workspaceEnv: LOCAL_WORKSPACE,
    dirty: false,
    preview: false,
  };
}
async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const previous = useSpaces.getState();
  useSpaces.setState({ spaces: [], activeId: "space-100" });
  let tabs!: ReturnType<typeof useTabs>;
  let action!: ReturnType<typeof usePreviewOpening>;
  let selected = 100;
  let directory = "/ambient";
  let workspace: WorkspaceEnv = LOCAL_WORKSPACE;
  let destination = {};
  let realDestination = false;
  const start = vi
    .fn<(root: string) => Promise<{ url: string }>>()
    .mockResolvedValue({ url: "http://127.0.0.1:4000" });
  const join = vi.fn<(source: Tab, created: Tab, limit: number) => boolean>(
    () => true,
  );
  const activate = vi.fn();
  const error = vi.fn();
  const unavailable = vi.fn();
  const full = vi.fn();
  const room = vi.fn(() => true);
  function Window() {
    tabs = useTabs();
    action = usePreviewOpening({
      tabs: tabs.tabs,
      selectedId: selected,
      spaceId: "space-100",
      root: directory,
      workspace,
      limit: 4,
      getTab: tabs.getTab,
      destination: (tab) =>
        realDestination
          ? (useSpaces
              .getState()
              .viewSpaces.find(
                (view) =>
                  !view.deleted && view.memberOrder.includes(tab.tabKey),
              ) ??
            useSpaces
              .getState()
              .viewSpaces.find(
                (view) => !view.deleted && view.id === `view-${tab.spaceId}`,
              ) ??
            null)
          : destination,
      hasRoom: room,
      start,
      open: tabs.newPreviewTab,
      join,
      activate,
      onFull: full,
      onUnavailable: unavailable,
      onError: error,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = () => act(async () => root.render(<Window />));
  await render();
  await act(async () => tabs.replaceTabs([editor(100), editor(200)], 100));
  return {
    tabs: () => tabs,
    action: () => action,
    start,
    join,
    activate,
    error,
    unavailable,
    full,
    room,
    render,
    select: (id: number) => {
      selected = id;
    },
    directory: (path: string) => {
      directory = path;
    },
    environment: (env: WorkspaceEnv) => {
      workspace = env;
    },
    destination: () => {
      destination = {};
    },
    resolveRealDestination: () => {
      realDestination = true;
    },
    source: () => {
      const tab = tabs.getTab(200);
      if (!tab) throw new Error("Source absent");
      return tab;
    },
    close: async () => {
      await act(async () => root.unmount());
      useSpaces.setState(previous);
    },
  };
}
it("opens the pointed editor in its original workspace after native settlement", async () => {
  const f = await setup();
  try {
    const source = f.source();
    await act(async () => f.action()("", { source }));
    expect(f.start).toHaveBeenCalledExactlyOnceWith("/project-200");
    const preview = f.tabs().tabs.find((tab) => tab.kind === "preview");
    expect(preview).toMatchObject({
      spaceId: "space-200",
      url: "http://127.0.0.1:4000/page%20%231.html",
    });
    expect(f.tabs().activeId).toBe(100);
    expect(f.join).toHaveBeenCalledExactlyOnceWith(source, preview, 4);
    expect(f.activate).toHaveBeenCalledExactlyOnceWith(preview?.id);
  } finally {
    await f.close();
  }
});
it("opens explicit URLs without native IO and preserves declined joins", async () => {
  const f = await setup();
  try {
    f.join.mockReturnValueOnce(false);
    await act(async () =>
      f.action()("https://example.test/page", { source: f.source() }),
    );
    expect(f.start).not.toHaveBeenCalled();
    expect(f.activate).not.toHaveBeenCalled();
    expect(f.tabs().activeId).toBe(100);
    expect(f.tabs().tabs.find((tab) => tab.kind === "preview")).toMatchObject({
      spaceId: "space-200",
      url: "https://example.test/page",
    });
  } finally {
    await f.close();
  }
});
it("activates the original workspace after its own real composite publication", async () => {
  const f = await setup();
  try {
    f.resolveRealDestination();
    for (const id of [100, 200])
      useSpaces.getState().create({
        id: `space-${id}`,
        name: `Space ${id}`,
        root: `/project-${id}`,
        env: LOCAL_WORKSPACE,
      });
    useSpaces.setState({ activeId: "space-100" });
    f.join.mockImplementation((source, created) => {
      const spaces = useSpaces.getState();
      const view = spaces.ensureViewSpace({
        workspaceId: source.spaceId,
        name: "Source",
        initialMember: source.tabKey,
      });
      const accepted = spaces.addMemberToViewSpace(view, created.tabKey, 4);
      spaces.openViewSpace(view);
      spaces.focusVisualMember(created.tabKey);
      return accepted;
    });
    f.activate.mockImplementation((id: number) => {
      const created = f.tabs().getTab(id);
      if (created) useSpaces.getState().setActive(created.spaceId);
    });
    await act(async () => f.action()("", { source: f.source() }));
    const preview = f.tabs().tabs.find((tab) => tab.kind === "preview");
    expect(f.activate).toHaveBeenCalledExactlyOnceWith(preview?.id);
    expect(useSpaces.getState().activeId).toBe("space-200");
  } finally {
    await f.close();
  }
});
it("does not activate after an unrelated workspace change inside the join callback", async () => {
  const f = await setup();
  try {
    f.join.mockImplementation(() => {
      useSpaces.setState({ activeId: "unrelated" });
      return true;
    });
    await act(async () => f.action()("https://example.test/page"));
    expect(f.activate).not.toHaveBeenCalled();
    expect(useSpaces.getState().activeId).toBe("unrelated");
  } finally {
    await f.close();
  }
});
it.each([
  "selection",
  "directory",
  "environment",
  "destination",
  "workspace",
  "source",
  "caller",
  "unmount",
] as const)("discards pending openings after %s retirement", async (change) => {
  const f = await setup();
  let finish!: (value: { url: string }) => void;
  f.start.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let current = true;
  let pending!: Promise<number | undefined>;
  let closed = false;
  try {
    await act(async () => {
      pending = f.action()("", {
        source: f.source(),
        current: () => current,
        filesystem:
          change === "directory" || change === "environment"
            ? { root: "/project-200", workspace: LOCAL_WORKSPACE }
            : undefined,
      });
    });
    if (change === "selection") {
      f.select(200);
      await f.render();
      f.select(100);
      await f.render();
    }
    if (change === "directory") {
      f.directory("/other");
      await f.render();
      f.directory("/ambient");
      await f.render();
    }
    if (change === "environment") {
      f.environment({ kind: "wsl", distro: "Debian" });
      await f.render();
      f.environment(LOCAL_WORKSPACE);
      await f.render();
    }
    if (change === "destination") f.destination();
    if (change === "workspace") {
      useSpaces.setState({ activeId: "other" });
      useSpaces.setState({ activeId: "space-100" });
    }
    if (change === "source") await act(async () => f.tabs().closeTab(200));
    if (change === "caller") current = false;
    if (change === "unmount") {
      await f.close();
      closed = true;
    }
    await act(async () => {
      finish({ url: "http://127.0.0.1:4000" });
      await pending;
    });
    expect(f.tabs().tabs.some((tab) => tab.kind === "preview")).toBe(false);
    expect(f.join).not.toHaveBeenCalled();
    expect(f.activate).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
  } finally {
    if (!closed) await f.close();
  }
});
it("rejects stale source objects and explicit remote filesystem ownership", async () => {
  const f = await setup();
  try {
    const stale = f.source();
    await act(async () =>
      f.tabs().updateTab(200, { path: "/changed/page.html" }),
    );
    await act(async () => f.action()("", { source: stale }));
    await act(async () =>
      f.action()("/project/page.html", {
        filesystem: {
          root: "/project",
          workspace: { kind: "wsl", distro: "Debian" },
        },
      }),
    );
    expect(f.start).not.toHaveBeenCalled();
    expect(f.unavailable).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});
it("checks capacity before native startup and again before creation", async () => {
  const f = await setup();
  try {
    f.room.mockReturnValueOnce(false);
    await f.action()("");
    expect(f.start).not.toHaveBeenCalled();
    f.room.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await f.action()("");
    expect(f.tabs().tabs.some((tab) => tab.kind === "preview")).toBe(false);
    expect(f.full).toHaveBeenCalledTimes(2);
  } finally {
    await f.close();
  }
});

it("keeps an explicit editor independent from changes to ambient Explorer context", async () => {
  const f = await setup();
  let finish!: (value: { url: string }) => void;
  f.start.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let pending!: Promise<number | undefined>;
  try {
    const action = f.action();
    await act(async () => {
      pending = action("", { source: f.source() });
    });
    f.directory("/unrelated");
    f.environment({ kind: "wsl", distro: "Debian" });
    await f.render();
    expect(f.action()).toBe(action);
    await act(async () => {
      finish({ url: "http://127.0.0.1:4000" });
      await pending;
    });
    expect(f.tabs().tabs.find((tab) => tab.kind === "preview")).toMatchObject({
      spaceId: "space-200",
      url: "http://127.0.0.1:4000/page%20%231.html",
    });
    expect(f.activate).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});

it("uses the captured Explorer directory for a browser without its own filesystem", async () => {
  const f = await setup();
  try {
    await act(async () =>
      f.tabs().replaceTabs(
        [
          {
            id: 100,
            ...createTabIdentity("space-100"),
            kind: "preview",
            spaceId: "space-100",
            title: "Browser",
            url: "about:blank",
          },
        ],
        100,
      ),
    );
    await act(async () => f.action()(""));
    expect(f.start).toHaveBeenCalledExactlyOnceWith("/ambient");
  } finally {
    await f.close();
  }
});
it("keeps a terminal split on its original leaf directory", async () => {
  const f = await setup();
  try {
    const source: Tab = {
      id: 200,
      ...createTabIdentity("space-200"),
      spaceId: "space-200",
      kind: "terminal",
      title: "Shell",
      cwd: "/wrong",
      workspaceEnv: LOCAL_WORKSPACE,
      paneTree: { kind: "leaf", id: 2000, cwd: "/terminal-project" },
      activeLeafId: 2000,
    };
    await act(async () => f.tabs().replaceTabs([editor(100), source], 100));
    await act(async () => f.action()("", { source }));
    expect(f.start).toHaveBeenCalledExactlyOnceWith("/terminal-project");
    expect(f.tabs().tabs.find((tab) => tab.kind === "preview")).toMatchObject({
      spaceId: "space-200",
      url: "http://127.0.0.1:4000",
    });
  } finally {
    await f.close();
  }
});

it("supports explicit standalone opening without joining a full composite", async () => {
  const f = await setup();
  try {
    f.room.mockReturnValue(false);
    await act(async () =>
      f.action()("https://example.test/page", { splitWithActive: false }),
    );
    expect(f.room).not.toHaveBeenCalled();
    expect(f.join).not.toHaveBeenCalled();
    expect(f.activate).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});

it("retains capacity for retired startups until native settlement", async () => {
  const f = await setup();
  let finish!: (value: { url: string }) => void;
  const waiting = new Promise<{ url: string }>((resolve) => {
    finish = resolve;
  });
  f.start.mockReturnValue(waiting);
  const pending: Array<Promise<number | undefined>> = [];
  try {
    for (let index = 0; index < 257; index++) pending.push(f.action()(""));
    expect(f.start).toHaveBeenCalledTimes(256);
    f.select(200);
    await f.render();
    f.select(100);
    await f.render();
    await f.action()("");
    expect(f.start).toHaveBeenCalledTimes(256);
    await act(async () => {
      finish({ url: "http://127.0.0.1:4000" });
      await Promise.all(pending);
    });
    expect(f.tabs().tabs.some((tab) => tab.kind === "preview")).toBe(false);
    await act(async () => f.action()(""));
    expect(f.start).toHaveBeenCalledTimes(257);
  } finally {
    await f.close();
  }
});

it("reports only current startup errors", async () => {
  const f = await setup();
  try {
    f.start.mockRejectedValueOnce(new Error("Startup failed"));
    await f.action()("");
    expect(f.error).toHaveBeenCalledOnce();
    let fail!: (error: Error) => void;
    f.start.mockReturnValueOnce(
      new Promise((_yes, no) => {
        fail = no;
      }),
    );
    let pending!: Promise<number | undefined>;
    await act(async () => {
      pending = f.action()("");
    });
    f.select(200);
    await f.render();
    await act(async () => {
      fail(new Error("Late failure"));
      await pending;
    });
    expect(f.error).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});
