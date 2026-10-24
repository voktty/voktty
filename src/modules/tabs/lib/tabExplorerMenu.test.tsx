// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TabBar } from "@/modules/tabs/TabBar";
import { VerticalTabBar } from "@/modules/tabs/VerticalTabBar";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { EditorTab } from "@/modules/tabs/lib/useTabs";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/modules/tabs/NewTabMenu", () => ({ NewTabMenu: () => null }));
let root: Root;
let node: HTMLDivElement;
const no = () => {};
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
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["horizontal", "vertical"] as const)(
  "passes the exact background SSH document from the %s context menu",
  async (direction) => {
    const tab: EditorTab = {
      ...createTabIdentity("main", () => "remote"),
      id: 1,
      kind: "editor",
      spaceId: "main",
      path: "/srv/app/a.ts",
      title: "Remote file",
      dirty: false,
      preview: false,
      workspaceEnv: {
        kind: "ssh",
        root: "/srv/app",
        sessionId: 7,
        connection: { id: "build", name: "Build", host: "build.example" },
      },
    };
    const active: EditorTab = {
      ...tab,
      ...createTabIdentity("main", () => "local"),
      id: 2,
      title: "Local file",
      path: "/work/local.ts",
      workspaceEnv: { kind: "local" },
    };
    const reveal = vi.fn();
    const props = {
      tabs: [tab, active],
      activeId: 2,
      onSelect: no,
      onClose: no,
      onDuplicate: no,
      onRename: no,
      onReorder: no,
      onPin: no,
      onRevealInExplorer: reveal,
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
    const row = node.querySelector('[data-tab-id="1"]');
    if (!row) throw new Error("Missing source tab.");
    await act(async () =>
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: 10,
          clientY: 10,
        }),
      ),
    );
    const item = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Reveal in Side Bar");
    if (!item) throw new Error("Missing sidebar reveal command.");
    await act(async () => item.click());
    expect(reveal).toHaveBeenCalledExactlyOnceWith(tab);
  },
);
