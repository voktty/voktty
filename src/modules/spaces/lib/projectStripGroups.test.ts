import { expect, it } from "vitest";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { TerminalTab } from "@/modules/tabs/lib/useTabs";
import {
  projectStripEntries,
  planTabCloseFocus,
  type StripEntry,
} from "@/modules/spaces/lib/spaceProjection";
import {
  asSlotId,
  asViewSpaceId,
  createSlot,
  createSplit,
  type ViewSpace,
} from "@/modules/spaces/lib/spaceLayout";
import {
  projectStripGroupStart,
  projectStripLabel,
} from "@/modules/spaces/lib/projectStripGroups";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";

function terminal(id: number, projectCwd?: string): TerminalTab {
  return {
    id,
    ...createTabIdentity("main", () => String(id)),
    spaceId: "main",
    kind: "terminal",
    title: "shell",
    cwd: "/other",
    projectCwd,
    paneTree: { kind: "leaf", id: id + 100 },
    activeLeafId: id + 100,
  };
}
const ids = (items: ReturnType<typeof projectStripEntries>) =>
  items.flatMap((item) =>
    item.kind === "space" ? [`space:${item.space.id}`] : [String(item.tab.id)],
  );

it("groups standalone project terminals in first-project order and retains exact resources", () => {
  const tabs = [
    terminal(1, "/a"),
    terminal(2),
    terminal(3, "/b"),
    terminal(4, "/a"),
  ];
  const before = structuredClone(tabs);
  const items = projectStripEntries({ tabs, viewSpaces: [], stripEntries: [] });
  expect(ids(items)).toEqual(["1", "4", "3", "2"]);
  expect(items[1]).toMatchObject({ tab: tabs[3], spaceId: null });
  expect(items[1].kind === "tab" && items[1].tab).toBe(tabs[3]);
  expect(projectStripGroupStart(items, 0)?.name).toBe("a");
  expect(projectStripGroupStart(items, 1)).toBeUndefined();
  expect(projectStripGroupStart(items, 2)?.name).toBe("b");
  expect(projectStripLabel(items[3])).toBeUndefined();
  expect(tabs).toEqual(before);
});

it.each(["composite", "expanded"] as const)(
  "keeps a %s visual space and member order as an indivisible boundary",
  (presentation) => {
    const tabs = [
      terminal(1, "/a"),
      terminal(2, "/b"),
      terminal(3, "/a"),
      terminal(4, "/b"),
      terminal(5, "/a"),
      terminal(6, "/b"),
    ];
    const view: ViewSpace = {
      id: asViewSpaceId("view-main"),
      name: "Mixed projects",
      presentation,
      memberOrder: [tabs[2].tabKey, tabs[1].tabKey],
      focusedSlotId: asSlotId("left"),
      layout: createSplit(
        "root",
        "row",
        0.5,
        createSlot(asSlotId("left"), tabs[2].tabKey),
        createSlot(asSlotId("right"), tabs[1].tabKey),
      ),
    };
    const stripEntries: StripEntry[] = [
      { kind: "standalone", tabKey: tabs[0].tabKey },
      { kind: "space", spaceId: view.id },
      ...[tabs[3], tabs[4], tabs[5]].map((tab) => ({
        kind: "standalone" as const,
        tabKey: tab.tabKey,
      })),
    ];
    const before = structuredClone({ tabs, view, stripEntries });
    const items = projectStripEntries({
      tabs,
      viewSpaces: [view],
      stripEntries,
    });
    expect(ids(items)).toEqual(
      presentation === "composite"
        ? ["1", "space:view-main", "4", "6", "5"]
        : ["1", "3", "2", "4", "6", "5"],
    );
    expect(
      items
        .filter((item) => item.kind === "tab" && item.spaceId !== null)
        .every((item) => !projectStripLabel(item)),
    ).toBe(true);
    expect({ tabs, view, stripEntries }).toEqual(before);
  },
);

it("uses current projected order for close focus and ordinal selection", () => {
  const tabs = [terminal(1, "/a"), terminal(2, "/b"), terminal(3, "/a")];
  const items = projectStripEntries({ tabs, viewSpaces: [], stripEntries: [] });
  expect(ids(items)).toEqual(["1", "3", "2"]);
  expect(planTabCloseFocus(items, tabs, 2, 2).nextActiveId).toBe(3);
});

it("round-trips drag ordering within a project through the existing strip store", () => {
  const tabs = [terminal(1, "/a"), terminal(2, "/b"), terminal(3, "/a")];
  const previous = useSpaces.getState();
  try {
    useSpaces.setState({
      viewSpaces: [],
      stripEntries: tabs.map((tab) => ({
        kind: "standalone",
        tabKey: tab.tabKey,
      })),
    });
    const before = projectStripEntries({ tabs, ...useSpaces.getState() });
    const visible = before.flatMap((item) =>
      item.kind === "tab" ? [item.tabKey] : [],
    );
    useSpaces.getState().reorderStandaloneTabByGap(tabs[2].tabKey, 0, visible);
    const after = projectStripEntries({ tabs, ...useSpaces.getState() });
    expect(ids(after)).toEqual(["3", "1", "2"]);
    expect(tabs.map((tab) => tab.projectCwd)).toEqual(["/a", "/b", "/a"]);
  } finally {
    useSpaces.setState(previous);
  }
});

it("preserves the existing ordering of unrelated tabs", () => {
  const tabs = [terminal(1), terminal(2), terminal(3)];
  const stripEntries: StripEntry[] = [tabs[2], tabs[0], tabs[1]].map((tab) => ({
    kind: "standalone",
    tabKey: tab.tabKey,
  }));
  expect(
    ids(projectStripEntries({ tabs, viewSpaces: [], stripEntries })),
  ).toEqual(["3", "1", "2"]);
});
