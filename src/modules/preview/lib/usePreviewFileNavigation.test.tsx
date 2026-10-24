// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useTabs, type PreviewTab } from "@/modules/tabs/lib/useTabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import { usePreviewFileNavigation } from "@/modules/preview/lib/usePreviewFileNavigation";
import type { WebServerInfo } from "@/modules/preview/store/webServerStore";
vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  disposeSession: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
afterEach(() => vi.unstubAllGlobals());
const info: WebServerInfo = {
  url: "http://127.0.0.1:4000",
  port: 4000,
  root_path: "/project",
  server_type: "static",
};

async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const previousSpaces = useSpaces.getState();
  useSpaces.setState({ spaces: [], activeId: "main" });
  let tabs!: ReturnType<typeof useTabs>;
  let navigate!: ReturnType<typeof usePreviewFileNavigation>;
  let workspace: WorkspaceEnv = LOCAL_WORKSPACE;
  let rootPath = "/project";
  let selected = 100;
  let deferred = false;
  const queued: Array<() => void> = [];
  const start = vi
    .fn<(root: string) => Promise<WebServerInfo>>()
    .mockResolvedValue(info);
  const reload = vi.fn();
  const error = vi.fn();
  const unavailable = vi.fn();
  function Window() {
    tabs = useTabs();
    navigate = usePreviewFileNavigation({
      tabs: tabs.tabs,
      selectedId: selected,
      root: rootPath,
      workspace,
      getTab: tabs.getTab,
      servers: () => [],
      start,
      reload,
      onError: error,
      onUnavailable: unavailable,
      update: (original, url, current) => {
        const commit = () =>
          tabs.updateTab(
            original.id,
            { url },
            (live) =>
              current() &&
              live.tabKey === original.tabKey &&
              live.kind === "preview" &&
              live.url === original.url,
          );
        if (deferred) queued.push(commit);
        else commit();
      },
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = () => act(async () => root.render(<Window />));
  await render();
  const original: PreviewTab = {
    id: 100,
    ...createTabIdentity("main"),
    spaceId: "main",
    kind: "preview",
    title: "Browser",
    url: "about:blank",
  };
  await act(async () => tabs.replaceTabs([original], 100));
  return {
    tabs: () => tabs,
    navigate: () => navigate,
    start,
    reload,
    error,
    unavailable,
    original,
    render,
    workspace: (env: WorkspaceEnv) => {
      workspace = env;
    },
    directory: (path: string) => {
      rootPath = path;
    },
    select: (id: number) => {
      selected = id;
    },
    defer: () => {
      deferred = true;
    },
    commit: async () =>
      act(async () => {
        for (const commit of queued.splice(0)) commit();
      }),
    close: async () => {
      await act(async () => root.unmount());
      useSpaces.setState(previousSpaces);
    },
  };
}

it("serves the captured root and updates only its original preview", async () => {
  const f = await setup();
  try {
    await act(async () => f.navigate()(100, "/project/page #1.html"));
    expect(f.start).toHaveBeenCalledExactlyOnceWith("/project");
    expect(f.tabs().getTab(100)).toMatchObject({
      url: "http://127.0.0.1:4000/page%20%231.html",
    });
    await act(async () => f.navigate()(100, "/project/page #1.html"));
    expect(f.reload).toHaveBeenCalledExactlyOnceWith(100);
    expect(f.start).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});

it.each([
  "selection",
  "root",
  "environment",
  "workspace",
  "url",
  "replacement",
  "close",
  "unmount",
] as const)("retires late server results after %s changes", async (change) => {
  const f = await setup();
  let finish!: (server: WebServerInfo) => void;
  f.start.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let pending!: Promise<void>;
  let closed = false;
  try {
    await act(async () => {
      pending = f.navigate()(100, "/project/page.html");
    });
    if (change === "selection") {
      f.select(200);
      await f.render();
      f.select(100);
      await f.render();
    }
    if (change === "root") {
      f.directory("/other");
      await f.render();
      f.directory("/project");
      await f.render();
    }
    if (change === "environment") {
      f.workspace({ kind: "wsl", distro: "Debian" });
      await f.render();
      f.workspace(LOCAL_WORKSPACE);
      await f.render();
    }
    if (change === "workspace") {
      useSpaces.setState({ activeId: "other" });
      useSpaces.setState({ activeId: "main" });
    }
    if (change === "url") {
      await act(async () =>
        f.tabs().updateTab(100, { url: "https://example.test" }),
      );
      await act(async () => f.tabs().updateTab(100, { url: "about:blank" }));
    }
    if (change === "replacement")
      await act(async () =>
        f
          .tabs()
          .replaceTabs([{ ...f.original, ...createTabIdentity("main") }], 100),
      );
    if (change === "close") await act(async () => f.tabs().closeTab(100));
    if (change === "unmount") {
      await f.close();
      closed = true;
    }
    await act(async () => {
      finish(info);
      await pending;
    });
    expect(
      f.tabs().getTab(100)?.kind === "preview" &&
        (f.tabs().getTab(100) as PreviewTab).url,
    ).not.toBe("http://127.0.0.1:4000/page.html");
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
  } finally {
    if (!closed) await f.close();
  }
});

it("keeps the latest file when startup replies arrive out of order", async () => {
  const f = await setup();
  let finish!: (server: WebServerInfo) => void;
  f.start.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let first!: Promise<void>;
  try {
    await act(async () => {
      first = f.navigate()(100, "/project/old.html");
    });
    await act(async () => f.navigate()(100, "/project/new.html"));
    await act(async () => {
      finish(info);
      await first;
    });
    expect(f.tabs().getTab(100)).toMatchObject({
      url: "http://127.0.0.1:4000/new.html",
    });
  } finally {
    await f.close();
  }
});

it("revalidates the original tab and permit inside the deferred update", async () => {
  const f = await setup();
  try {
    f.defer();
    await act(async () => f.navigate()(100, "/project/old.html"));
    useSpaces.setState({ activeId: "other" });
    useSpaces.setState({ activeId: "main" });
    await f.commit();
    expect(f.tabs().getTab(100)).toMatchObject({ url: "about:blank" });
  } finally {
    await f.close();
  }
});

it("does not start or reuse local servers for a remote Explorer", async () => {
  const f = await setup();
  try {
    f.workspace({ kind: "wsl", distro: "Debian" });
    await f.render();
    await act(async () => f.navigate()(100, "/project/page.html"));
    expect(f.start).not.toHaveBeenCalled();
    expect(f.unavailable).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});

it("cannot apply a queued update to a replacement with the same runtime id", async () => {
  const f = await setup();
  try {
    f.defer();
    await act(async () => f.navigate()(100, "/project/old.html"));
    const replacement = {
      ...f.original,
      ...createTabIdentity("main"),
      url: "https://example.test",
    };
    await act(async () => f.tabs().replaceTabs([replacement], 100));
    await f.commit();
    expect(f.tabs().getTab(100)).toBe(replacement);
  } finally {
    await f.close();
  }
});

it("retains retired startups in its capacity until they actually settle", async () => {
  const f = await setup();
  let finish!: (server: WebServerInfo) => void;
  const waiting = new Promise<WebServerInfo>((resolve) => {
    finish = resolve;
  });
  f.start.mockReturnValue(waiting);
  const pending: Promise<void>[] = [];
  try {
    for (let index = 0; index < 257; index++)
      pending.push(f.navigate()(100, "/project/page.html"));
    expect(f.start).toHaveBeenCalledTimes(256);
    f.select(200);
    await f.render();
    f.select(100);
    await f.render();
    await f.navigate()(100, "/project/page.html");
    expect(f.start).toHaveBeenCalledTimes(256);
    await act(async () => {
      finish(info);
      await Promise.all(pending);
    });
    expect(f.tabs().getTab(100)).toMatchObject({ url: "about:blank" });
    await act(async () => f.navigate()(100, "/project/page.html"));
    expect(f.start).toHaveBeenCalledTimes(257);
  } finally {
    await f.close();
  }
});

it("reports current failures while discarding failures after retirement", async () => {
  const f = await setup();
  try {
    f.start.mockRejectedValueOnce(new Error("Startup failed"));
    await act(async () => f.navigate()(100, "/project/page.html"));
    expect(f.error).toHaveBeenCalledOnce();
    let fail!: (error: Error) => void;
    f.start.mockReturnValueOnce(
      new Promise((_yes, no) => {
        fail = no;
      }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = f.navigate()(100, "/project/page.html");
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
