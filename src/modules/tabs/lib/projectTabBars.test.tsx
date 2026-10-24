// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TabBar } from "@/modules/tabs/TabBar";
import { VerticalTabBar } from "@/modules/tabs/VerticalTabBar";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab, TerminalTab } from "@/modules/tabs/lib/useTabs";
import {
  asSlotId,
  asViewSpaceId,
  createSlot,
} from "@/modules/spaces/lib/spaceLayout";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/modules/tabs/NewTabMenu", () => ({ NewTabMenu: () => null }));
let root: Root;
let node: HTMLDivElement;
const select = vi.fn();
const reorder = vi.fn();
const no = () => {};
function terminal(id: number, projectCwd?: string): TerminalTab {
  return {
    id,
    ...createTabIdentity("main", () => String(id)),
    kind: "terminal",
    spaceId: "main",
    title: "shell",
    customTitle: `Terminal ${id}`,
    cwd: "/other",
    projectCwd,
    paneTree: { kind: "leaf", id: id + 100 },
    activeLeafId: id + 100,
  };
}
const source = () => [
  terminal(1, "/work/alpha"),
  terminal(2, "/work/beta"),
  terminal(3, "/work/alpha"),
  terminal(4),
];
async function render(direction: "horizontal" | "vertical", tabs: Tab[]) {
  const common = {
    tabs,
    activeId: 1,
    onSelect: select,
    onClose: no,
    onDuplicate: no,
    onPin: no,
    onRename: no,
    onReorder: no,
    onReorderVisual: reorder,
    stripEntries: tabs.map((tab) => ({
      kind: "standalone" as const,
      tabKey: tab.tabKey,
    })),
    viewSpaces: [],
  };
  await act(async () =>
    root.render(
      direction === "horizontal" ? (
        <TabBar
          {...common}
          onNew={no}
          onNewBlock={no}
          onNewPrivate={no}
          onNewEditor={no}
          onLaunchAgents={no}
          onCloseTabsToRight={no}
          onCloseOtherTabs={no}
        />
      ) : (
        <VerticalTabBar {...common} />
      ),
    ),
  );
}
const rows = () => [...node.querySelectorAll<HTMLElement>("[data-tab-id]")];
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
  vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(no);
  vi.spyOn(HTMLElement.prototype, "releasePointerCapture").mockImplementation(
    no,
  );
  select.mockClear();
  reorder.mockClear();
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
  "renders the shared project order in the %s strip and retains keyed tabs after shell navigation",
  async (direction) => {
    const tabs = source();
    await render(direction, tabs);
    expect(rows().map((row) => row.dataset.tabId)).toEqual([
      "1",
      "3",
      "2",
      "4",
    ]);
    expect(
      [...node.querySelectorAll("[data-project-label]")].map((label) =>
        label.textContent?.trim().split("·")[0].trim(),
      ),
    ).toEqual(
      direction === "horizontal"
        ? ["alpha", "alpha", "beta"]
        : ["alpha", "beta"],
    );
    const original = rows();
    await render(
      direction,
      tabs.map((tab) => ({ ...tab, cwd: "/somewhere/else" })),
    );
    expect(rows()).toEqual(original);
    expect(rows()[0]).toBe(original[0]);
  },
);

it.each(["horizontal", "vertical"] as const)(
  "passes grouped tab identities and gaps to the %s drag callback",
  async (direction) => {
    await render(direction, source());
    rows().forEach((row, index) => {
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
        new DOMRect(index * 100, index * 50, 100, 50),
      );
    });
    const row = rows()[1];
    const point =
      direction === "horizontal"
        ? { clientX: 110, clientY: 0 }
        : { clientX: 0, clientY: 60 };
    const target = { clientX: 0, clientY: 0 };
    await act(async () =>
      row.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...point,
          bubbles: true,
          button: 0,
          pointerId: 1,
        }),
      ),
    );
    await act(async () =>
      row.dispatchEvent(
        new PointerEvent("pointermove", {
          ...target,
          bubbles: true,
          button: 0,
          pointerId: 1,
        }),
      ),
    );
    await act(async () =>
      row.dispatchEvent(
        new PointerEvent("pointerup", {
          ...target,
          bubbles: true,
          button: 0,
          pointerId: 1,
        }),
      ),
    );
    expect(reorder).toHaveBeenCalledExactlyOnceWith(3, 0, [1, 3, 2, 4]);
    expect(select).not.toHaveBeenCalled();
  },
);

it("finds a project in vertical search even after its shells navigate elsewhere", async () => {
  await render("vertical", source());
  const input = node.querySelector("input");
  if (!input) throw new Error("Missing search field.");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, "alpha");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(rows().map((row) => row.dataset.tabId)).toEqual(["1", "3"]);
  expect(node.querySelector("[data-project-label]")?.textContent).toContain(
    "alpha",
  );
});

it("keeps overflow rows in grouped order while measuring the project badges", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(220);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
  await render("horizontal", source());
  expect(
    rows()
      .filter((row) => !row.hasAttribute("data-tab-hidden"))
      .map((row) => row.dataset.tabId),
  ).toEqual(["1", "3"]);
  const button = node.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="menu"]',
  );
  if (!button) throw new Error("Missing overflow menu.");
  await act(async () =>
    button.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 2,
      }),
    ),
  );
  const menu = [...document.querySelectorAll('[role="menuitem"]')].map(
    (row) => row.textContent,
  );
  expect(menu).toEqual([
    "Terminal 1",
    "Terminal 3",
    "Terminal 2",
    "Terminal 4",
  ]);
});

it("finds an associated terminal inside a composite without extracting its member", async () => {
  const tabs = source();
  const spaceId = asViewSpaceId("view-main");
  await act(async () =>
    root.render(
      <VerticalTabBar
        tabs={tabs}
        activeId={1}
        onSelect={select}
        onClose={no}
        onDuplicate={no}
        onPin={no}
        onRename={no}
        onReorder={no}
        stripEntries={[{ kind: "space", spaceId }]}
        viewSpaces={[
          {
            id: spaceId,
            name: "Build",
            presentation: "composite",
            memberOrder: [tabs[0].tabKey],
            focusedSlotId: asSlotId("slot"),
            layout: createSlot(asSlotId("slot"), tabs[0].tabKey),
          },
        ]}
      />,
    ),
  );
  const input = node.querySelector("input");
  if (!input) throw new Error("Missing search field.");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, "alpha");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(node.querySelector('[data-space-id="view-main"]')).not.toBeNull();
  expect(rows().map((row) => row.dataset.tabId)).toEqual(["3"]);
});
