// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  useTabs,
  type Tab,
  type TerminalTab,
} from "@/modules/tabs/lib/useTabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import { useTabPreviewSplit } from "@/modules/surfaces/lib/useTabPreviewSplit";

vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  disposeSession: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
afterEach(() => vi.unstubAllGlobals());

function terminal(id: number, spaceId: string): TerminalTab {
  return {
    id,
    ...createTabIdentity(spaceId, () => `git-source-${id}`),
    kind: "terminal",
    spaceId,
    title: "shell",
    cwd: "/tab-root",
    paneTree: { kind: "leaf", id: id * 10, cwd: "/leaf-root" },
    activeLeafId: id * 10,
    workspaceEnv: LOCAL_WORKSPACE,
  };
}

async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const previous = useSpaces.getState();
  useSpaces.setState({ spaces: [], viewSpaces: [], activeId: "main" });
  useSpaces.getState().create({
    id: "main",
    name: "Main",
    root: "/selected-root",
    env: LOCAL_WORKSPACE,
  });
  useSpaces.getState().create({
    id: "other",
    name: "Other",
    root: "/source-root",
    env: LOCAL_WORKSPACE,
  });
  useSpaces.setState({ activeId: "main" });
  const root = createRoot(document.createElement("div"));
  let tabs!: ReturnType<typeof useTabs>;
  let action!: ReturnType<typeof useTabPreviewSplit>;
  let selected = 1;
  let destination: object = {};
  const resolve = vi
    .fn<
      (
        path: string,
        workspace: typeof LOCAL_WORKSPACE,
      ) => Promise<{ url: string } | null>
    >()
    .mockResolvedValue({ url: "http://127.0.0.1:4000" });
  const join = vi.fn(() => true);
  const activate = vi.fn();
  const full = vi.fn();
  const error = vi.fn();
  const room = vi.fn(() => true);
  function Window() {
    tabs = useTabs();
    action = useTabPreviewSplit({
      tabs: tabs.tabs,
      selectedId: selected,
      spaceId: "main",
      limit: 4,
      getTab: tabs.getTab,
      destination: () => destination,
      hasRoom: room,
      resolve,
      open: tabs.newPreviewTab,
      join,
      activate,
      onFull: full,
      onError: error,
    });
    return null;
  }
  const render = () =>
    act(async () =>
      root.render(
        <StrictMode>
          <Window />
        </StrictMode>,
      ),
    );
  await render();
  await act(async () => {
    tabs.replaceTabs([terminal(100, "main"), terminal(200, "other")], 100);
    tabs.setActiveSpaceForNewTabs("main");
  });
  selected = 100;
  await render();
  return {
    tabs: () => tabs,
    action: () => action,
    resolve,
    join,
    activate,
    full,
    error,
    room,
    render,
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

it("opens the pointed source's preview in its own space without early activation", async () => {
  const fixture = await setup();
  try {
    await act(async () => fixture.action()(200));
    expect(fixture.resolve).toHaveBeenCalledExactlyOnceWith(
      "/leaf-root",
      LOCAL_WORKSPACE,
    );
    const preview = fixture.tabs().tabs.find((tab) => tab.kind === "preview");
    expect(preview).toMatchObject({
      spaceId: "other",
      url: "http://127.0.0.1:4000",
    });
    expect(fixture.tabs().activeId).toBe(100);
    expect(fixture.join).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 200 }),
      preview,
      4,
    );
    expect(fixture.activate).toHaveBeenCalledExactlyOnceWith(preview?.id);
  } finally {
    await fixture.close();
  }
});

it("never falls back to the selected source for an absent explicit id", async () => {
  const fixture = await setup();
  try {
    await fixture.action()(999);
    expect(fixture.resolve).not.toHaveBeenCalled();
  } finally {
    await fixture.close();
  }
});

it("opens the pointed web document with its encoded filename", async () => {
  const fixture = await setup();
  try {
    const document: Tab = {
      id: 200,
      ...createTabIdentity("other"),
      spaceId: "other",
      kind: "editor",
      title: "Page",
      path: "/project/page #1.html",
      dirty: false,
      preview: false,
      workspaceEnv: LOCAL_WORKSPACE,
    };
    await act(async () =>
      fixture.tabs().replaceTabs([terminal(100, "main"), document], 100),
    );
    await act(async () => fixture.action()(200));
    expect(fixture.resolve).toHaveBeenCalledExactlyOnceWith(
      "/project",
      LOCAL_WORKSPACE,
    );
    expect(
      fixture.tabs().tabs.find((tab) => tab.kind === "preview"),
    ).toMatchObject({
      spaceId: "other",
      url: "http://127.0.0.1:4000/page%20%231.html",
    });
  } finally {
    await fixture.close();
  }
});

it("rechecks the source after a reentrant capacity callback", async () => {
  const fixture = await setup();
  try {
    fixture.room.mockImplementationOnce(() => {
      fixture.tabs().closeTab(200);
      return true;
    });
    await act(async () => fixture.action()(200));
    expect(fixture.resolve).not.toHaveBeenCalled();
    expect(fixture.join).not.toHaveBeenCalled();
  } finally {
    await fixture.close();
  }
});

it.each([
  "selection",
  "replacement",
  "path",
  "environment",
  "layout",
  "workspace",
  "source-space",
  "closed",
  "unmount",
] as const)(
  "suppresses results after %s retirement, including a return to the original selection",
  async (change) => {
    const fixture = await setup();
    let finish!: (repo: { url: string }) => void;
    fixture.resolve.mockReturnValueOnce(
      new Promise((yes) => {
        finish = yes;
      }),
    );
    let pending!: Promise<void>;
    let closed = false;
    try {
      await act(async () => {
        pending = fixture.action()(200);
      });
      const original = fixture.tabs().getTab(200);
      if (!original) throw new Error("Source tab absent");
      if (change === "selection") {
        fixture.select(200);
        await fixture.render();
        fixture.select(100);
        await fixture.render();
      }
      if (
        change === "replacement" ||
        change === "path" ||
        change === "environment"
      ) {
        const replacement: Tab =
          change === "replacement"
            ? {
                ...terminal(200, "other"),
                tabKey: createTabIdentity("other").tabKey,
              }
            : change === "path"
              ? {
                  ...terminal(200, "other"),
                  cwd: "/new",
                  paneTree: { kind: "leaf", id: 2000, cwd: "/new" },
                }
              : {
                  ...terminal(200, "other"),
                  workspaceEnv: { kind: "wsl", distro: "Debian" },
                };
        await act(async () =>
          fixture.tabs().replaceTabs([terminal(100, "main"), replacement], 100),
        );
        await act(async () =>
          fixture.tabs().replaceTabs([terminal(100, "main"), original], 100),
        );
      }
      if (change === "layout") fixture.destination({});
      if (change === "workspace") useSpaces.setState({ activeId: "other" });
      if (change === "source-space") {
        const spaces = useSpaces.getState().spaces;
        useSpaces.setState({
          spaces: spaces.filter((space) => space.id !== "other"),
        });
        useSpaces.setState({ spaces });
      }
      if (change === "closed") {
        await act(async () => fixture.tabs().closeTab(200));
      }
      if (change === "unmount") {
        await fixture.close();
        closed = true;
      }
      await act(async () => {
        finish({ url: "http://127.0.0.1:4001" });
        await pending;
      });
      expect(fixture.tabs().tabs.some((tab) => tab.kind === "preview")).toBe(
        false,
      );
      expect(fixture.join).not.toHaveBeenCalled();
      expect(fixture.activate).not.toHaveBeenCalled();
      expect(fixture.error).not.toHaveBeenCalled();
    } finally {
      if (!closed) await fixture.close();
    }
  },
);

it("rechecks capacity before opening, and observes only current errors", async () => {
  const fixture = await setup();
  try {
    fixture.room.mockReturnValueOnce(false);
    await fixture.action()(200);
    expect(fixture.resolve).not.toHaveBeenCalled();
    fixture.room.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await fixture.action()(200);
    expect(fixture.full).toHaveBeenCalledTimes(2);
    expect(fixture.join).not.toHaveBeenCalled();
    fixture.resolve.mockResolvedValueOnce(null);
    await fixture.action()(200);
    const error = new Error("Git resolution failed");
    fixture.resolve.mockRejectedValueOnce(error);
    await fixture.action()(200);
    expect(fixture.error).toHaveBeenCalledExactlyOnceWith(error);
  } finally {
    await fixture.close();
  }
});

it("retires failures and cached callbacks when selection leaves and returns", async () => {
  const fixture = await setup();
  let fail!: (error: Error) => void;
  fixture.resolve.mockReturnValueOnce(
    new Promise((_yes, no) => {
      fail = no;
    }),
  );
  const old = fixture.action();
  let pending!: Promise<void>;
  try {
    await act(async () => {
      pending = old(200);
    });
    fixture.select(200);
    await fixture.render();
    fixture.select(100);
    await fixture.render();
    await act(async () => {
      fail(new Error("Retired failure"));
      await pending;
    });
    await old(200);
    expect(fixture.resolve).toHaveBeenCalledOnce();
    expect(fixture.error).not.toHaveBeenCalled();
  } finally {
    await fixture.close();
  }
});

it("does not revive a pending split after an immediate workspace round trip", async () => {
  const fixture = await setup();
  let finish!: (value: null) => void;
  fixture.resolve.mockReturnValueOnce(
    new Promise((yes) => {
      finish = yes;
    }),
  );
  let pending!: Promise<void>;
  try {
    await act(async () => {
      pending = fixture.action()(200);
    });
    useSpaces.setState({ activeId: "other" });
    useSpaces.setState({ activeId: "main" });
    await act(async () => {
      finish(null);
      await pending;
    });
  } finally {
    await fixture.close();
  }
});

it("does not activate a preview when joining its original space is declined", async () => {
  const fixture = await setup();
  try {
    fixture.join.mockReturnValueOnce(false);
    await act(async () => fixture.action()(200));
    expect(fixture.activate).not.toHaveBeenCalled();
    expect(fixture.tabs().activeId).toBe(100);
    expect(
      fixture.tabs().tabs.find((tab) => tab.kind === "preview")?.spaceId,
    ).toBe("other");
  } finally {
    await fixture.close();
  }
});

it("does not override a workspace change inside the join callback", async () => {
  const fixture = await setup();
  try {
    fixture.join.mockImplementationOnce(() => {
      useSpaces.setState({ activeId: "other" });
      return true;
    });
    await act(async () => fixture.action()(200));
    expect(fixture.activate).not.toHaveBeenCalled();
  } finally {
    await fixture.close();
  }
});

it("keeps retired native resolutions counted until actual settlement", async () => {
  const fixture = await setup();
  let finish!: (value: null) => void;
  const unresolved = new Promise<null>((yes) => {
    finish = yes;
  });
  fixture.resolve.mockReturnValue(unresolved);
  const pending: Promise<void>[] = [];
  try {
    for (let index = 0; index < 256; index++)
      pending.push(fixture.action()(200));
    await fixture.action()(200);
    expect(fixture.resolve).toHaveBeenCalledTimes(256);
    fixture.select(200);
    await fixture.render();
    fixture.select(100);
    await fixture.render();
    await fixture.action()(200);
    expect(fixture.resolve).toHaveBeenCalledTimes(256);
    await act(async () => {
      finish(null);
      await Promise.all(pending);
    });
    await fixture.action()(200);
    expect(fixture.resolve).toHaveBeenCalledTimes(257);
  } finally {
    await fixture.close();
  }
});
