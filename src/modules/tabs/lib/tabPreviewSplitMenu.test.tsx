// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TabBar } from "@/modules/tabs/TabBar";
import { VerticalTabBar } from "@/modules/tabs/VerticalTabBar";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab, TerminalTab } from "@/modules/tabs/lib/useTabs";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import {
  PREVIEW_SPLIT_COMMAND,
  tabPreviewSplitUnavailableReason,
} from "@/modules/tabs/lib/tabPreviewSplitCommand";
import { declaredCommandSurfaceRule } from "@/modules/shortcuts/lib/commandSurface";
import {
  asViewSpaceId,
  asSlotId,
  createSlot,
} from "@/modules/spaces/lib/spaceLayout";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/modules/tabs/NewTabMenu", () => ({ NewTabMenu: () => null }));
let root: Root;
let node: HTMLDivElement;
let originalSpaces: ReturnType<typeof useSpaces.getState>;
let originalLimit: ReturnType<
  typeof usePreferencesStore.getState
>["spaceViewLimit"];
const open = vi.fn();
const no = () => {};
function terminal(id: number): TerminalTab {
  return {
    id,
    ...createTabIdentity("main", () => `preview-${id}`),
    spaceId: "main",
    kind: "terminal",
    title: `Terminal ${id}`,
    cwd: `/project-${id}`,
    paneTree: { kind: "leaf", id: id + 100 },
    activeLeafId: id + 100,
    workspaceEnv: LOCAL_WORKSPACE,
  };
}
const remote: TerminalTab = {
  ...terminal(2),
  workspaceEnv: {
    kind: "ssh",
    connection: { id: "host", name: "Host", host: "example.test" },
    root: "/project-2",
  },
};
async function render(direction: "horizontal" | "vertical", tabs: Tab[]) {
  const props = {
    tabs,
    activeId: 2,
    onSelect: no,
    onClose: no,
    onDuplicate: no,
    onPin: no,
    onRename: no,
    onReorder: no,
    onOpenPreviewSplit: open,
  };
  await act(async () =>
    root.render(
      direction === "horizontal" ? (
        <TabBar
          {...props}
          onNew={no}
          onNewBlock={no}
          onNewPrivate={no}
          onNewEditor={no}
          onLaunchAgents={no}
          onCloseTabsToRight={no}
          onCloseOtherTabs={no}
        />
      ) : (
        <VerticalTabBar {...props} />
      ),
    ),
  );
}
async function menu(id: number) {
  await act(async () =>
    node.querySelector(`[data-tab-id="${id}"]`)?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: 10,
        clientY: 10,
      }),
    ),
  );
  const item = document.querySelector<HTMLElement>(
    `[data-command-id="${PREVIEW_SPLIT_COMMAND}"]`,
  );
  if (!item) throw new Error("Preview command absent");
  return item;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(no);
  originalSpaces = useSpaces.getState();
  originalLimit = usePreferencesStore.getState().spaceViewLimit;
  useSpaces.setState({ spaces: [], viewSpaces: [], activeId: "main" });
  usePreferencesStore.setState({ spaceViewLimit: 4 });
  open.mockClear();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  useSpaces.setState(originalSpaces);
  usePreferencesStore.setState({ spaceViewLimit: originalLimit });
  node.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["horizontal", "vertical"] as const)(
  "uses the pointed filesystem in the %s menu",
  async (direction) => {
    await render(direction, [terminal(1), remote]);
    const allowed = await menu(1);
    expect(allowed.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => allowed.click());
    expect(open).toHaveBeenCalledExactlyOnceWith(1);
    const denied = await menu(2);
    expect(denied.getAttribute("aria-disabled")).toBe("true");
    expect(denied.textContent).toContain("Local Machine");
    await act(async () => denied.click());
    expect(open).toHaveBeenCalledOnce();
  },
);

it.each(["horizontal", "vertical"] as const)(
  "offers document previews in the %s menu",
  async (direction) => {
    const document: Tab = {
      id: 1,
      ...createTabIdentity("main"),
      spaceId: "main",
      kind: "editor",
      title: "page.html",
      path: "/project/page.html",
      dirty: false,
      preview: false,
      workspaceEnv: LOCAL_WORKSPACE,
    };
    await render(direction, [document, remote]);
    const item = await menu(1);
    expect(item.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => item.click());
    expect(open).toHaveBeenCalledExactlyOnceWith(1);
  },
);

it.each(["horizontal", "vertical"] as const)(
  "reacts to source capacity and preference changes in the %s menu",
  async (direction) => {
    const source = terminal(1);
    const slotId = asSlotId("source-slot");
    await render(direction, [source, remote]);
    await menu(1);
    await act(async () =>
      useSpaces.setState({
        viewSpaces: [
          {
            id: asViewSpaceId("view-main"),
            name: "Main",
            presentation: "expanded",
            focusedSlotId: slotId,
            layout: createSlot(slotId, source.tabKey),
            memberOrder: [
              source.tabKey,
              terminal(3).tabKey,
              terminal(4).tabKey,
              terminal(5).tabKey,
            ],
          },
        ],
      }),
    );
    const item = document.querySelector<HTMLElement>(
      `[data-command-id="${PREVIEW_SPLIT_COMMAND}"]`,
    );
    expect(item?.getAttribute("aria-disabled")).toBe("true");
    expect(item?.textContent).toContain("no free slot");
    await act(async () => item?.click());
    expect(open).not.toHaveBeenCalled();
    await act(async () => usePreferencesStore.setState({ spaceViewLimit: 6 }));
    expect(item?.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => item?.click());
    expect(open).toHaveBeenCalledExactlyOnceWith(1);
  },
);

it("declares the preview command for every active surface", () => {
  expect(declaredCommandSurfaceRule(PREVIEW_SPLIT_COMMAND)?.appliesTo).toEqual([
    "terminal",
    "harness",
    "editor",
    "other",
  ]);
});

it.each(["terminal", "editor", "harness"] as const)(
  "resolves %s preview availability independently for local and remote projects",
  (kind) => {
    const local: Tab =
      kind === "terminal"
        ? terminal(1)
        : kind === "editor"
          ? {
              id: 1,
              ...createTabIdentity("main"),
              spaceId: "main",
              kind,
              title: "page.html",
              path: "/project/page.html",
              dirty: false,
              preview: false,
              workspaceEnv: LOCAL_WORKSPACE,
            }
          : {
              id: 1,
              ...createTabIdentity("main"),
              spaceId: "main",
              kind,
              title: "Harness",
              cwd: "/project",
            };
    const target: Tab =
      local.kind === "harness"
        ? { ...local, cwd: "remote://host/project" }
        : { ...local, workspaceEnv: remote.workspaceEnv };
    expect(
      tabPreviewSplitUnavailableReason(local, undefined, [], 4),
    ).toBeNull();
    expect(tabPreviewSplitUnavailableReason(target, undefined, [], 4)).toBe(
      "workspace.localMachine",
    );
  },
);

it.each(["horizontal", "vertical"] as const)(
  "disables a rootless source in the %s menu",
  async (direction) => {
    const source = { ...terminal(1), cwd: undefined };
    await render(direction, [source, remote]);
    const item = await menu(1);
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("No workspace root");
    await act(async () => item.click());
    expect(open).not.toHaveBeenCalled();
  },
);

it.each(["horizontal", "vertical"] as const)(
  "refuses a %s menu selection when capacity changes before React commits",
  async (direction) => {
    await render(direction, [terminal(1), remote]);
    const item = await menu(1);
    await act(async () => {
      usePreferencesStore.setState({ spaceViewLimit: 2 });
      item.click();
    });
    expect(open).not.toHaveBeenCalled();
  },
);
