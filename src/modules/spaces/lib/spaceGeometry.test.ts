import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { describe, expect, it } from "vitest";
import { calculateSpaceGeometry, updateSpaceSplitRatio } from "./spaceGeometry";
import {
  asSlotId,
  createSlot,
  createSplit,
  type SpaceLayoutNode,
} from "./spaceLayout";

const slot = (id: string, memberTabKey: string | null = null) =>
  createSlot(asSlotId(id), memberTabKey ? asTabKey(memberTabKey) : null);

describe("space geometry", () => {
  it("calculates contiguous rectangles for a mixed binary layout", () => {
    const layout = createSplit(
      "root",
      "row",
      0.6,
      createSplit(
        "left",
        "column",
        0.5,
        slot("a", "tab-a"),
        slot("b", "tab-b"),
      ),
      slot("c", "tab-c"),
    );

    const geometry = calculateSpaceGeometry(layout, asSlotId("b"));

    expect(geometry.slots).toHaveLength(3);
    expect(geometry.slots.map((item) => item.slotId)).toEqual([
      asSlotId("a"),
      asSlotId("b"),
      asSlotId("c"),
    ]);
    expect(geometry.slots[0].rect).toEqual({
      x: 0,
      y: 0,
      width: 0.6,
      height: 0.5,
    });
    expect(geometry.slots[2].rect).toEqual({
      x: 0.6,
      y: 0,
      width: 0.4,
      height: 1,
    });
    expect(geometry.slots[1].focused).toBe(true);
    expect(geometry.handles.map((handle) => handle.splitId)).toEqual([
      "root",
      "left",
    ]);
  });

  it("keeps the minimum slot size when a ratio is invalid or extreme", () => {
    const layout = createSplit("root", "row", 0, slot("a"), slot("b"));
    const geometry = calculateSpaceGeometry(layout, null, {
      minSlotSize: 0.2,
    });

    expect(geometry.slots[0].rect.width).toBeCloseTo(0.2);
    expect(geometry.slots[1].rect.width).toBeCloseTo(0.8);
  });

  it("updates only the targeted split ratio from pointer coordinates", () => {
    const layout = createSplit("root", "row", 0.5, slot("a"), slot("b"));
    const ratio = updateSpaceSplitRatio(
      layout,
      "root",
      0.72,
      { x: 0, y: 0, width: 1, height: 1 },
      { minSlotSize: 0.15 },
    );

    expect(ratio).toBeCloseTo(0.72);
  });

  it("uses the nested split bounds when resizing a child", () => {
    const layout = createSplit(
      "root",
      "row",
      0.6,
      createSplit("left", "column", 0.5, slot("a"), slot("b")),
      slot("c"),
    );
    const ratio = updateSpaceSplitRatio(layout, "left", 0.75, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });

    expect(ratio).toBeCloseTo(0.75);
  });

  it("does not expose a ratio for a slot or an unknown split", () => {
    const layout: SpaceLayoutNode = slot("a");
    expect(
      updateSpaceSplitRatio(layout, "missing", 0.5, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    ).toBeNull();
  });
});
