// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { usePreviewOpeningCommand } from "@/modules/preview/lib/usePreviewOpeningCommand";
import { useGlobalShortcuts } from "@/modules/shortcuts/lib/useGlobalShortcuts";
import { shouldDisableShortcut } from "@/modules/shortcuts/lib/shortcutScope";
import { commandSurfaceRule } from "@/modules/shortcuts/lib/commandSurface";
import {
  createCommandItems,
  type CommandPaletteActionContext,
} from "@/modules/command-palette/commands";
import { createLauncherItems } from "@/modules/launcher/catalog";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import type { PreviewOpeningOptions } from "@/modules/preview/lib/previewOpeningTarget";
import { publishActiveSurface } from "@/modules/surfaces/lib/activeSurfaceStore";
import { usePreferencesStore } from "@/modules/settings/preferences";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

const originalShortcuts = usePreferencesStore.getState().shortcuts;
afterEach(() => {
  publishActiveSurface(null);
  usePreferencesStore.setState({ shortcuts: originalShortcuts });
  vi.unstubAllGlobals();
});

function source(
  kind: "harness" | "terminal" | "editor" | "preview",
  path: string,
  workspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE,
): Tab {
  const common = {
    id: 1,
    ...createTabIdentity("s"),
    spaceId: "s",
    title: "Source",
  };
  if (kind === "harness") return { ...common, kind, cwd: path };
  if (kind === "terminal")
    return {
      ...common,
      kind,
      workspaceEnv,
      paneTree: { kind: "leaf", id: 10, cwd: path },
      activeLeafId: 10,
    };
  if (kind === "editor")
    return {
      ...common,
      kind,
      workspaceEnv,
      path,
      dirty: false,
      preview: false,
    };
  return { ...common, kind, url: "about:blank" };
}

async function setup(
  tab: Tab | undefined = source("editor", "/project/page.html"),
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  usePreferencesStore.setState({
    shortcuts: {
      ...originalShortcuts,
      "tab.newPreview": [{ key: "p", ctrl: true, alt: true }],
    },
  });
  const input = {
    source: tab,
    space: undefined as { root: string | null; env: WorkspaceEnv } | undefined,
    root: "/ambient" as string | null,
    workspace: LOCAL_WORKSPACE as WorkspaceEnv,
    hasRoom: true,
    open: vi.fn<(_target?: string, options?: PreviewOpeningOptions) => unknown>(
      () => 9,
    ),
  };
  let command!: ReturnType<typeof usePreviewOpeningCommand>;
  function Listener() {
    command = usePreviewOpeningCommand(input);
    useGlobalShortcuts(
      { "tab.newPreview": command.run },
      {
        isDisabled: (id, event) =>
          shouldDisableShortcut({
            id,
            event,
            previewDisabledReason: command.disabledReason,
          }),
      },
    );
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = () => act(async () => root.render(<Listener />));
  await render();
  return {
    input,
    command: () => command,
    render,
    close: () => act(async () => root.unmount()),
  };
}

it.each(["harness", "terminal", "editor"] as const)(
  "projects %s availability from its own local and remote filesystem",
  async (kind) => {
    const f = await setup(source(kind, "/project/page.html"));
    try {
      expect(f.command().disabledReason).toBeUndefined();
      f.input.workspace = { kind: "wsl", distro: "Debian" };
      await f.render();
      expect(f.command().disabledReason).toBeUndefined();
      f.input.source = source(kind, "remote://machine/project/page.html");
      await f.render();
      expect(f.command().disabledReason).toBe(
        "editor.status.previewNotSupported",
      );
      f.command().run();
      expect(f.input.open).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  },
);

it.each(["terminal", "editor"] as const)(
  "refuses WSL %s paths but preserves native Windows document interpretation",
  async (kind) => {
    const f = await setup(
      source(kind, "/project/page.html", { kind: "wsl", distro: "Debian" }),
    );
    try {
      expect(f.command().disabledReason).toBe(
        "editor.status.previewNotSupported",
      );
      f.input.source = source("editor", "C:\\project\\page.html", {
        kind: "wsl",
        distro: "Debian",
      });
      await f.render();
      expect(f.command().disabledReason).toBeUndefined();
    } finally {
      await f.close();
    }
  },
);

it("uses the Explorer filesystem for a browser, and never starts work while checking availability", async () => {
  const f = await setup(source("preview", ""));
  try {
    expect(f.command().disabledReason).toBeUndefined();
    f.input.workspace = { kind: "wsl", distro: "Debian" };
    await f.render();
    expect(f.command().disabledReason).toBe(
      "editor.status.previewNotSupported",
    );
    expect(f.input.open).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("reports capacity separately and restores availability after a slot is freed", async () => {
  const f = await setup();
  try {
    f.input.hasRoom = false;
    await f.render();
    expect(f.command().disabledReason).toBe("spaces.maxSlots");
    f.command().run();
    expect(f.input.open).not.toHaveBeenCalled();
    f.input.hasRoom = true;
    await f.render();
    f.command().run();
    expect(f.input.open).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});

it.each(["source", "filesystem", "capacity", "unmount"])(
  "retires cached delivery after %s changes and keeps admitted capacity under the opener's guards",
  async (change) => {
    const f = await setup(source("preview", ""));
    let closed = false;
    try {
      const run = f.command().run;
      run();
      const options = f.input.open.mock.calls[0]?.[1];
      expect(options?.current?.()).toBe(true);
      if (change === "source") f.input.source = source("preview", "");
      if (change === "filesystem") f.input.root = "/other";
      if (change === "capacity") f.input.hasRoom = false;
      if (change === "unmount") {
        await f.close();
        closed = true;
      } else {
        await f.render();
        f.input.root = "/ambient";
        f.input.hasRoom = true;
        await f.render();
      }
      run();
      expect(options?.current?.()).toBe(change === "capacity");
      expect(f.input.open).toHaveBeenCalledOnce();
    } finally {
      if (!closed) await f.close();
    }
  },
);

it("does not retire an owned editor command for unrelated Explorer changes", async () => {
  const f = await setup();
  try {
    const run = f.command().run;
    run();
    f.input.root = "/other";
    f.input.workspace = { kind: "wsl", distro: "Debian" };
    await f.render();
    expect(f.command().run).toBe(run);
    expect(f.input.open.mock.calls[0]?.[1]?.current?.()).toBe(true);
  } finally {
    await f.close();
  }
});

it("preserves a document command across dirty metadata and delivers its latest committed tab", async () => {
  const f = await setup();
  try {
    const run = f.command().run;
    const tab = f.input.source;
    if (tab?.kind !== "editor") throw new Error("Missing editor");
    f.input.source = { ...tab, dirty: true };
    await f.render();
    expect(f.command().run).toBe(run);
    run();
    expect(f.input.open.mock.calls[0]?.[1]?.source).toBe(f.input.source);
  } finally {
    await f.close();
  }
});

it("does not consume a rejected preview key and admits it after the filesystem becomes available", async () => {
  const f = await setup(source("harness", "remote://machine/project"));
  const key = () => {
    const event = new KeyboardEvent("keydown", {
      key: "p",
      ctrlKey: true,
      altKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event;
  };
  try {
    expect(key().defaultPrevented).toBe(false);
    expect(f.input.open).not.toHaveBeenCalled();
    f.input.source = source("harness", "/project");
    await f.render();
    expect(key().defaultPrevented).toBe(true);
    expect(f.input.open).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
});

it.each([undefined, "editor.status.previewNotSupported", "spaces.maxSlots"])(
  "publishes matching catalog restrictions for reason %s",
  (previewDisabledReason) => {
    const run = vi.fn();
    const ctx = {
      tabs: [],
      spaces: [],
      activeId: 1,
      activeSpaceId: null,
      explorerRoot: "/project",
      home: null,
      editorActions: null,
      previewDisabledReason,
      openNewPreview: run,
    } as unknown as CommandPaletteActionContext;
    const palette = createCommandItems(ctx).find(
      (item) => item.id === "tab.newPreview",
    );
    const launcher = createLauncherItems(ctx).find(
      (item) => item.id === "launch.browser",
    );
    for (const item of [palette, launcher]) {
      expect(item).toBeDefined();
      expect(item?.disabledReason).toBe(previewDisabledReason);
      expect(item && commandSurfaceRule(item.id).requires).toBe(
        "preview-project",
      );
      item?.run();
    }
    expect(run).toHaveBeenCalledTimes(previewDisabledReason ? 0 : 2);
  },
);
