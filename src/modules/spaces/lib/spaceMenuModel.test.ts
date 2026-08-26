import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { describe, expect, it } from "vitest";
import type { ViewSpace } from "./spaceLayout";
import {
  asSlotId,
  asViewSpaceId,
  createSlot,
  createSplit,
} from "./spaceLayout";
import { buildSpaceMenuModels } from "./spaceMenuModel";
import type { SpaceMeta } from "./store";

const space: SpaceMeta = {
  id: "space-a",
  name: "Workspace A",
  root: "C:/workspace",
  env: { kind: "local" },
  createdAt: 1,
  updatedAt: 1,
};

const tab = (id: string, spaceId = space.id) =>
  ({
    id: Number(id),
    tabKey: asTabKey(`tab-${id}`),
    spaceId,
    kind: "terminal",
  }) as never;

function viewSpace(overrides: Partial<ViewSpace> = {}): ViewSpace {
  return {
    id: asViewSpaceId("view-space-a"),
    name: space.name,
    presentation: "composite",
    memberOrder: [asTabKey("tab-1"), asTabKey("tab-2")],
    layout: createSplit(
      "split-root",
      "row",
      0.6,
      createSlot(asSlotId("slot-1"), asTabKey("tab-1")),
      createSplit(
        "split-right",
        "column",
        0.5,
        createSlot(asSlotId("slot-2"), asTabKey("tab-2")),
        createSlot(asSlotId("slot-3")),
      ),
    ),
    focusedSlotId: asSlotId("slot-1"),
    ...overrides,
  };
}

describe("buildSpaceMenuModels", () => {
  it("keeps visual member order and reports focus/free slots", () => {
    const result = buildSpaceMenuModels(
      [space],
      [viewSpace()],
      [tab("2"), tab("1"), tab("3")],
    )[0];

    expect(result.presentation).toBe("composite");
    expect(result.members.map((item) => item.id)).toEqual([1, 2]);
    expect(result.standaloneTabs.map((item) => item.id)).toEqual([3]);
    expect(result.focusedMemberKey).toBe(asTabKey("tab-1"));
    expect(result.freeSlotCount).toBe(1);
    expect(result.memberSlotByKey.get(asTabKey("tab-1"))).toBe("slot-1");
  });

  it("reports an empty or expanded visual space without hiding live tabs", () => {
    const result = buildSpaceMenuModels(
      [space],
      [
        viewSpace({
          presentation: "expanded",
          memberOrder: [],
          focusedSlotId: null,
          layout: createSplit(
            "split-empty",
            "row",
            0.5,
            createSlot(asSlotId("slot-1")),
            createSlot(asSlotId("slot-2")),
          ),
        }),
      ],
      [tab("1"), tab("2")],
    )[0];

    expect(result.presentation).toBe("empty");
    expect(result.members).toEqual([]);
    expect(result.standaloneTabs.map((item) => item.id)).toEqual([1, 2]);
    expect(result.slotCount).toBe(2);
    expect(result.freeSlotCount).toBe(2);
  });

  it("keeps standalone tabs outside the visual space capacity", () => {
    const result = buildSpaceMenuModels(
      [space],
      [viewSpace()],
      [tab("1"), tab("2"), tab("3")],
    )[0];

    expect(result.tabs).toHaveLength(3);
    expect(result.members).toHaveLength(2);
    expect(result.standaloneTabs).toHaveLength(1);
    expect(result.slotCount).toBe(3);
  });

  it("uses the visual strip order for standalone rows", () => {
    const result = buildSpaceMenuModels(
      [space],
      [],
      [tab("1"), tab("2"), tab("3")],
      [
        { kind: "standalone", tabKey: asTabKey("tab-3") },
        { kind: "standalone", tabKey: asTabKey("tab-1") },
        { kind: "standalone", tabKey: asTabKey("tab-2") },
      ],
    )[0];

    expect(result.standaloneTabs.map((item) => item.id)).toEqual([3, 1, 2]);
  });
});
