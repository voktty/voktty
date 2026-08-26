import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { describe, expect, it } from "vitest";
import { asSlotId, asViewSpaceId, type ViewSpace } from "./spaceLayout";
import {
  activeTabKeyFromViewSpace,
  activeTabIdFromStrip,
  isProjectedStripItemActive,
  planTabCloseFocus,
  projectStripEntries,
  projectedStripItemValue,
  type ActiveStripItem,
} from "./spaceProjection";

function tab(id: number, spaceId: string): Tab {
  const tabKey = asTabKey(`tab-${id}`);
  return {
    id,
    tabKey,
    workspaceScopeId: spaceId as never,
    spaceId,
    kind: "terminal",
    title: `shell-${id}`,
    cwd: `C:/workspace/${spaceId}`,
    paneTree: { kind: "leaf", id: id + 1000, cwd: `C:/workspace/${spaceId}` },
    activeLeafId: id + 1000,
  };
}

function space(
  id: string,
  presentation: ViewSpace["presentation"],
  members: number[],
): ViewSpace {
  const slots = members.map((member, index) => ({
    kind: "slot" as const,
    id: asSlotId(`slot-${id}-${index}`),
    memberTabKey: asTabKey(`tab-${member}`),
  }));
  const [first, second, third] = slots;
  const layout = {
    kind: "split" as const,
    id: `split-${id}`,
    direction: "row" as const,
    ratio: 0.5,
    first: first ?? {
      kind: "slot" as const,
      id: asSlotId(`slot-${id}-empty`),
      memberTabKey: null,
    },
    second:
      third && second
        ? {
            kind: "split" as const,
            id: `split-${id}-second`,
            direction: "column" as const,
            ratio: 0.5,
            first: second,
            second: third,
          }
        : (second ?? {
            kind: "slot" as const,
            id: asSlotId(`slot-${id}-second`),
            memberTabKey: null,
          }),
  };
  return {
    id: asViewSpaceId(`view-${id}`),
    name: `Space ${id}`,
    presentation,
    memberOrder: members.map((member) => asTabKey(`tab-${member}`)),
    layout,
    focusedSlotId: slots[0]?.id ?? null,
  };
}

describe("space strip projection", () => {
  it("collapses two composed spaces into exactly two visual items", () => {
    const tabs = [
      tab(1, "a"),
      tab(2, "a"),
      tab(3, "a"),
      tab(4, "b"),
      tab(5, "b"),
      tab(6, "b"),
    ];
    const items = projectStripEntries({
      tabs,
      viewSpaces: [
        space("a", "composite", [1, 2, 3]),
        space("b", "composite", [4, 5, 6]),
      ],
      stripEntries: [
        { kind: "space", spaceId: asViewSpaceId("view-a") },
        { kind: "space", spaceId: asViewSpaceId("view-b") },
      ],
    });

    expect(items).toHaveLength(2);
    expect(items.map(projectedStripItemValue)).toEqual([
      "space:view-a",
      "space:view-b",
    ]);
    expect(items.every((item) => item.kind === "space")).toBe(true);
  });

  it("keeps expanded members contiguous and preserves standalone order", () => {
    const tabs = [tab(1, "a"), tab(2, "a"), tab(3, "loose")];
    const items = projectStripEntries({
      tabs,
      viewSpaces: [space("a", "expanded", [1, 2])],
      stripEntries: [
        { kind: "space", spaceId: asViewSpaceId("view-a") },
        { kind: "standalone", tabKey: asTabKey("tab-3") },
      ],
    });

    expect(
      items.map((item) => (item.kind === "tab" ? item.tab.id : item.space.id)),
    ).toEqual([1, 2, 3]);
    expect(items.every((item) => item.kind === "tab")).toBe(true);
    expect(
      (items[0] as Extract<(typeof items)[number], { kind: "tab" }>).spaceId,
    ).toBe(asViewSpaceId("view-a"));
  });

  it("repairs stale strip references by appending each live tab once", () => {
    const items = projectStripEntries({
      tabs: [tab(1, "a"), tab(2, "b")],
      viewSpaces: [space("a", "composite", [1])],
      stripEntries: [
        { kind: "space", spaceId: asViewSpaceId("missing") },
        { kind: "standalone", tabKey: asTabKey("tab-1") },
        { kind: "standalone", tabKey: asTabKey("tab-1") },
      ],
    });

    expect(items.map((item) => item.kind === "tab" && item.tab.id)).toEqual([
      1, 2,
    ]);
  });

  it("does not render a duplicated member from an invalid repeated assignment", () => {
    const items = projectStripEntries({
      tabs: [tab(1, "a")],
      viewSpaces: [space("a", "composite", [1]), space("b", "composite", [1])],
      stripEntries: [
        { kind: "space", spaceId: asViewSpaceId("view-a") },
        { kind: "space", spaceId: asViewSpaceId("view-b") },
      ],
    });

    expect(items).toHaveLength(2);
    expect(
      items.flatMap((item) => (item.kind === "space" ? item.tabs : [])),
    ).toHaveLength(1);
  });

  it("derives the focused resource from a composed active strip item", () => {
    const items = projectStripEntries({
      tabs: [tab(1, "a"), tab(2, "a")],
      viewSpaces: [space("a", "composite", [1, 2])],
      stripEntries: [{ kind: "space", spaceId: asViewSpaceId("view-a") }],
    });
    const active: ActiveStripItem = {
      kind: "space",
      spaceId: asViewSpaceId("view-a"),
      focusedSlotId: asSlotId("slot-a-0"),
    };

    expect(activeTabIdFromStrip(items, active, asTabKey("tab-2"))).toBe(1);
    expect(isProjectedStripItemActive(items[0], asTabKey("tab-1"))).toBe(true);
  });

  it("resolves context from the focused slot before falling back to the first member", () => {
    const viewSpace = space("context", "composite", [1, 2]);
    const active: ActiveStripItem = {
      kind: "space",
      spaceId: viewSpace.id,
      focusedSlotId: asSlotId("slot-context-1"),
    };

    expect(
      activeTabKeyFromViewSpace([viewSpace], active, asTabKey("tab-9")),
    ).toBe(asTabKey("tab-2"));
    expect(
      activeTabKeyFromViewSpace(
        [{ ...viewSpace, focusedSlotId: asSlotId("missing") }],
        { ...active, focusedSlotId: asSlotId("missing") },
        asTabKey("tab-9"),
      ),
    ).toBe(asTabKey("tab-1"));
  });

  it("moves focus to a surviving global strip item after the last tab in a workspace closes", () => {
    const tabs = [tab(1, "default"), tab(2, "wsl")];
    const items = projectStripEntries({
      tabs,
      viewSpaces: [],
      stripEntries: [
        { kind: "standalone", tabKey: tabs[0].tabKey },
        { kind: "standalone", tabKey: tabs[1].tabKey },
      ],
    });

    expect(planTabCloseFocus(items, tabs, 2, 2)).toEqual({
      closingTabId: 2,
      activeWasClosed: true,
      nextActiveId: 1,
      nextSpaceId: "default",
      nextTabKey: tabs[0].tabKey,
    });
  });

  it("keeps focus unchanged when a background tab closes", () => {
    const tabs = [tab(1, "default"), tab(2, "ssh")];
    const items = projectStripEntries({
      tabs,
      viewSpaces: [],
      stripEntries: [],
    });

    expect(planTabCloseFocus(items, tabs, 2, 1)).toMatchObject({
      activeWasClosed: false,
      nextActiveId: 1,
      nextSpaceId: "default",
    });
  });

  it("focuses a sibling before leaving a composite space", () => {
    const tabs = [tab(1, "remote"), tab(2, "remote"), tab(3, "default")];
    const composite = space("remote", "composite", [1, 2]);
    const items = projectStripEntries({
      tabs,
      viewSpaces: [composite],
      stripEntries: [
        { kind: "space", spaceId: composite.id },
        { kind: "standalone", tabKey: tabs[2].tabKey },
      ],
    });

    expect(planTabCloseFocus(items, tabs, 2, 2)).toMatchObject({
      activeWasClosed: true,
      nextActiveId: 1,
      nextSpaceId: "remote",
    });
  });

  it("returns an explicit empty focus only after the final resource closes", () => {
    const tabs = [tab(1, "default")];
    const items = projectStripEntries({
      tabs,
      viewSpaces: [],
      stripEntries: [],
    });

    expect(planTabCloseFocus(items, tabs, 1, 1)).toMatchObject({
      closingTabId: 1,
      activeWasClosed: true,
      nextActiveId: null,
      nextSpaceId: null,
      nextTabKey: null,
    });
  });
});
