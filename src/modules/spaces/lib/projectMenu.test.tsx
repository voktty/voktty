// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, assert, expect, it, vi } from "vitest";
import { SpaceSwitcher } from "@/modules/spaces/SpaceSwitcher";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import {
  asSlotId,
  asViewSpaceId,
  createSlot,
  type ViewSpace,
} from "@/modules/spaces/lib/spaceLayout";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab, TerminalTab } from "@/modules/tabs/lib/useTabs";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@/modules/shortcuts", () => ({ useShortcutLabel: () => "" }));

let root: Root;
let node: HTMLDivElement;
let previous: ReturnType<typeof useSpaces.getState>;
const jump = vi.fn();
const close = vi.fn();
const reorder = vi.fn();
const move = vi.fn();
function tab(
  id: number,
  projectCwd?: string,
  patch: Partial<TerminalTab> = {},
): TerminalTab {
  return {
    id,
    ...createTabIdentity("main", () => String(id)),
    kind: "terminal",
    spaceId: "main",
    title: `shell-${id}`,
    customTitle: `Terminal ${id}`,
    cwd: "/elsewhere",
    projectCwd,
    paneTree: { kind: "leaf", id: id + 100 },
    activeLeafId: id + 100,
    ...patch,
  };
}

async function render(tabs: Tab[], viewSpaces: ViewSpace[] = []) {
  await act(async () =>
    root.render(
      <SpaceSwitcher
        open
        onOpenChange={() => {}}
        tabs={tabs}
        viewSpaces={viewSpaces}
        onNewSpace={() => {}}
        onDeleteSpace={() => {}}
        onNewTabInSpace={() => {}}
        onJumpTab={jump}
        onCloseTab={close}
        onMoveTabToSpace={move}
        onReorderTab={reorder}
        onReorderSpaces={() => {}}
      />,
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  previous = useSpaces.getState();
  useSpaces.setState({
    spaces: [
      {
        id: "main",
        name: "Workspace",
        root: null,
        env: { kind: "local" },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    activeId: "main",
    stripEntries: [],
    viewSpaces: [],
  });
  jump.mockClear();
  close.mockClear();
  reorder.mockClear();
  move.mockClear();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  useSpaces.setState(previous);
  vi.unstubAllGlobals();
});

const rows = () => [
  ...document.querySelectorAll<HTMLElement>('[data-drop="tab"]'),
];

it("renders project groups with full paths, preserving generic terminal actions", async () => {
  const tabs = [
    tab(1, "/work/app"),
    tab(2),
    tab(3, "/other/app"),
    tab(4, "/work/app"),
  ];
  await render(tabs);
  expect(rows().map((row) => row.dataset.tabId)).toEqual(["1", "4", "3", "2"]);
  expect(document.querySelector('[title="/work/app"]')?.textContent).toContain(
    "/work/app",
  );
  expect(document.querySelector('[title="/other/app"]')?.textContent).toContain(
    "/other/app",
  );
  await act(async () => {
    rows()[1].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    rows()[3].querySelector<HTMLButtonElement>("button")?.click();
  });
  expect(jump).toHaveBeenCalledExactlyOnceWith(4);
  expect(close).toHaveBeenCalledExactlyOnceWith(2);
  expect(move).not.toHaveBeenCalled();
  expect(reorder).not.toHaveBeenCalled();
  expect(tabs.map((tab) => tab.id)).toEqual([1, 2, 3, 4]);
});

it("leaves composite membership and its order intact while grouping loose terminals", async () => {
  const tabs = [tab(1, "/work/app"), tab(2, "/work/app"), tab(3, "/other/app")];
  const space: ViewSpace = {
    id: asViewSpaceId("view-main"),
    name: "Workspace",
    presentation: "composite",
    memberOrder: [tabs[0].tabKey],
    layout: createSlot(asSlotId("slot-main"), tabs[0].tabKey),
    focusedSlotId: asSlotId("slot-main"),
  };
  await render(tabs, [space]);
  const loose = document.querySelector(
    '[data-workspace-drop-kind="loose-strip"]',
  );
  assert(loose);
  expect(
    [...loose.querySelectorAll<HTMLElement>('[data-drop="tab"]')].map(
      (row) => row.dataset.tabId,
    ),
  ).toEqual(["2", "3"]);
  expect(rows().map((row) => row.dataset.tabId)).toEqual(["1", "2", "3"]);
  expect(space.memberOrder).toEqual([tabs[0].tabKey]);
});

it("reacts to strip ordering while retaining each tab's project after shell navigation", async () => {
  const tabs = [tab(1, "/a"), tab(2, "/b"), tab(3, "/a")];
  await render(tabs);
  await act(async () =>
    useSpaces.setState({
      stripEntries: [tabs[1], tabs[2], tabs[0]].map((tab) => ({
        kind: "standalone",
        tabKey: tab.tabKey,
      })),
    }),
  );
  expect(rows().map((row) => row.dataset.tabId)).toEqual(["2", "3", "1"]);
  await render(tabs.map((tab) => ({ ...tab, cwd: "/new/folder" })));
  expect(rows().map((row) => row.dataset.tabId)).toEqual(["2", "3", "1"]);
});
