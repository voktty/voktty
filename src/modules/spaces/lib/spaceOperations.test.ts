import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { describe, expect, it } from "vitest";
import {
  asSlotId,
  asViewSpaceId,
  collectLayoutSlots,
  createSlot,
  type ViewSpace,
  validateViewSpaces,
} from "./spaceLayout";
import {
  addMemberToViewSpace,
  assignMemberToSlot,
  closeSpaceMember,
  createViewSpace,
  deleteViewSpace,
  expandViewSpace,
  extractSpaceMember,
  focusViewSpaceSlot,
  nextOccupiedSlotId,
  openViewSpace,
  repairFocusedSlot,
  rebalanceViewSpace,
  splitSpaceSlot,
  swapSpaceSlots,
} from "./spaceOperations";

const tab = (id: string) => asTabKey(`tab-${id}`);
const slotId = (id: string) => asSlotId(`slot-${id}`);

function twoSlotSpace(
  id: string,
  first: string | null,
  second: string | null,
): ViewSpace {
  const created = createViewSpace({
    id: asViewSpaceId(`space-${id}`),
    name: `Space ${id}`,
    initialSlotId: slotId(`${id}-a`),
    initialMember: first ? tab(first) : null,
  });
  return {
    ...created,
    layout: {
      kind: "split",
      id: `split-${id}`,
      direction: "row",
      ratio: 0.5,
      first: created.layout,
      second: createSlot(slotId(`${id}-b`), second ? tab(second) : null),
    },
    memberOrder: [first, second].filter(Boolean).map((value) => tab(value!)),
  };
}

describe("space lifecycle", () => {
  it("keeps spaces with zero or one member", () => {
    const empty = createViewSpace({
      id: asViewSpaceId("space-empty"),
      name: "Empty",
      initialSlotId: slotId("empty"),
    });
    const single = createViewSpace({
      id: asViewSpaceId("space-single"),
      name: "Single",
      initialSlotId: slotId("single"),
      initialMember: tab("single"),
    });

    expect(empty.memberOrder).toEqual([]);
    expect(single.memberOrder).toEqual([tab("single")]);
  });

  it("builds balanced flat layouts for one through eight members", () => {
    const empty = createViewSpace({
      id: asViewSpaceId("space-adaptive"),
      name: "Adaptive",
      initialSlotId: slotId("adaptive-a"),
    });

    for (let count = 1; count <= 8; count += 1) {
      const members = Array.from({ length: count }, (_, index) =>
        tab(`adaptive-${index + 1}`),
      );
      const adapted = rebalanceViewSpace(empty, members);
      const slots = collectLayoutSlots(adapted.layout);
      expect(slots).toHaveLength(count);
      expect(slots.map((slot) => slot.memberTabKey)).toEqual(members);
      expect(adapted.memberOrder).toEqual(members);
      expect(validateViewSpaces([adapted], undefined, 8)).toEqual([]);
    }

    const three = rebalanceViewSpace(empty, [tab("a"), tab("b"), tab("c")]);
    expect(three.layout).toMatchObject({
      kind: "split",
      direction: "row",
      ratio: 0.5,
      second: { kind: "split", direction: "column", ratio: 0.5 },
    });

    const four = rebalanceViewSpace(empty, [
      tab("a"),
      tab("b"),
      tab("c"),
      tab("d"),
    ]);
    expect(four.layout).toMatchObject({
      kind: "split",
      direction: "row",
      ratio: 0.5,
      first: { kind: "split", direction: "column", ratio: 0.5 },
      second: { kind: "split", direction: "column", ratio: 0.5 },
    });
  });

  it("preserves custom geometry while membership remains unchanged", () => {
    const original = twoSlotSpace("stable", "a", "b");
    const customized = {
      ...original,
      layout: { ...original.layout, ratio: 0.68 },
    } as ViewSpace;

    expect(rebalanceViewSpace(customized, customized.memberOrder)).toBe(
      customized,
    );
  });

  it("adds members adaptively and respects the configured maximum", () => {
    let spaces = [
      createViewSpace({
        id: asViewSpaceId("space-target"),
        name: "Target",
        initialSlotId: slotId("target-a"),
      }),
    ];

    for (let index = 1; index <= 6; index += 1) {
      const result = addMemberToViewSpace(
        spaces,
        spaces[0].id,
        tab(`member-${index}`),
        6,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      spaces = result.spaces;
    }

    const before = spaces;
    const rejected = addMemberToViewSpace(
      spaces,
      spaces[0].id,
      tab("member-7"),
      6,
    );
    expect(rejected).toEqual({
      ok: false,
      reason: "max-slots",
      spaces: before,
    });
  });

  it("rebuilds the visual layout when member order changes", () => {
    const original = rebalanceViewSpace(
      createViewSpace({
        id: asViewSpaceId("space-order"),
        name: "Order",
        initialSlotId: slotId("order-a"),
      }),
      [tab("first"), tab("second")],
    );
    const reordered = rebalanceViewSpace(original, [tab("second"), tab("first")]);
    expect(collectLayoutSlots(reordered.layout).map((slot) => slot.memberTabKey)).toEqual([
      tab("second"),
      tab("first"),
    ]);
  });

  it("opens, expands and focuses a valid slot without changing resources", () => {
    const original = twoSlotSpace("a", "a", "b");
    const opened = openViewSpace(original);
    const focused = focusViewSpaceSlot(opened, slotId("a-b"));
    const expanded = expandViewSpace(focused);

    expect(opened.presentation).toBe("composite");
    expect(focused.focusedSlotId).toBe(slotId("a-b"));
    expect(expanded.presentation).toBe("expanded");
    expect(expanded.memberOrder).toEqual(original.memberOrder);
  });

  it("cycles only through occupied slots and repairs focus after a close", () => {
    const original = twoSlotSpace("focus", "first", "second");
    expect(nextOccupiedSlotId(original, 1)).toBe(slotId("focus-b"));
    expect(
      nextOccupiedSlotId({ ...original, focusedSlotId: slotId("focus-b") }, 1),
    ).toBe(slotId("focus-a"));

    const emptied = {
      ...original,
      focusedSlotId: slotId("focus-a"),
      memberOrder: [tab("second")],
      layout: {
        ...original.layout,
        first: createSlot(slotId("focus-a"), null),
      },
    };
    expect(repairFocusedSlot(emptied, slotId("focus-a")).focusedSlotId).toBe(
      slotId("focus-b"),
    );
  });

  it("moves an existing member atomically into an empty slot", () => {
    const source = twoSlotSpace("source", "moving", null);
    const target = twoSlotSpace("target", "fixed", null);

    const result = assignMemberToSlot(
      [source, target],
      target.id,
      slotId("target-b"),
      tab("moving"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spaces[0].memberOrder).toEqual([]);
    expect(result.spaces[1].memberOrder).toEqual([tab("fixed"), tab("moving")]);
    expect(validateViewSpaces(result.spaces)).toEqual([]);
  });

  it("rejects assignment into an occupied slot without partial mutation", () => {
    const original = twoSlotSpace("a", "a", "b");

    const result = assignMemberToSlot(
      [original],
      original.id,
      slotId("a-b"),
      tab("c"),
    );

    expect(result).toEqual({
      ok: false,
      reason: "slot-occupied",
      spaces: [original],
    });
  });

  it("extracts and closes members while collapsing obsolete slots", () => {
    const original = twoSlotSpace("a", "a", "b");
    const extracted = extractSpaceMember([original], tab("a"));
    const closed = closeSpaceMember(extracted.spaces, tab("b"));

    expect(extracted.changed).toBe(true);
    expect(closed.changed).toBe(true);
    expect(closed.spaces).toHaveLength(1);
    expect(closed.spaces[0].memberOrder).toEqual([]);
    expect(closed.spaces[0].layout).toMatchObject({
      kind: "slot",
      memberTabKey: null,
    });
  });

  it("swaps members by changing their effective visual order", () => {
    const original = twoSlotSpace("a", "a", "b");
    const swapped = swapSpaceSlots(original, slotId("a-a"), slotId("a-b"));

    expect(swapped.memberOrder).toEqual([tab("b"), tab("a")]);
    expect(swapped.layout).toMatchObject({
      kind: "split",
      first: { memberTabKey: tab("b") },
      second: { memberTabKey: tab("a") },
    });
  });

  it("turns the legacy split request into a flat adaptive insertion", () => {
    const original = twoSlotSpace("a", "a", null);
    const result = splitSpaceSlot(
      [original],
      original.id,
      slotId("a-a"),
      "column",
      "after",
      slotId("a-new"),
      tab("replacement"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spaces[0].memberOrder).toEqual([
      tab("a"),
      tab("replacement"),
    ]);
    expect(collectLayoutSlots(result.spaces[0].layout)).toHaveLength(2);
    expect(validateViewSpaces(result.spaces)).toEqual([]);
  });

  it("keeps a member unchanged when a legacy split targets itself", () => {
    const original = twoSlotSpace("a", "a", "b");
    const result = splitSpaceSlot(
      [original],
      original.id,
      slotId("a-a"),
      "column",
      "after",
      slotId("a-new"),
      tab("a"),
    );

    expect(result).toEqual({ ok: true, spaces: [original] });
  });

  it("rejects splitting a four-slot layout without returning a partial layout", () => {
    const original = twoSlotSpace("a", "a", "b");
    const full: ViewSpace = {
      ...original,
      layout: {
        kind: "split",
        id: "root",
        direction: "row",
        ratio: 0.5,
        first: original.layout,
        second: createSlot(slotId("a-c"), tab("c")),
      },
      memberOrder: [tab("a"), tab("b"), tab("c")],
    };
    const result = splitSpaceSlot(
      [full],
      full.id,
      slotId("a-a"),
      "row",
      "before",
      slotId("a-new"),
      tab("d"),
      3,
    );
    expect(result).toEqual({ ok: false, reason: "max-slots", spaces: [full] });
  });

  it("deletes the visual definition and releases its members", () => {
    const original = twoSlotSpace("a", "a", "b");

    const result = deleteViewSpace([original], original.id);

    expect(result.spaces).toEqual([]);
    expect(result.releasedTabKeys).toEqual([tab("a"), tab("b")]);
  });

  it("recovers occupied slots missing from a stale member order", () => {
    const original = {
      ...twoSlotSpace("stale", "first", "recovered"),
      memberOrder: [tab("first")],
    };

    const result = deleteViewSpace([original], original.id);

    expect(result.releasedTabKeys).toEqual([
      tab("first"),
      tab("recovered"),
    ]);
  });

  it("removes a legacy deleted tombstone instead of leaving it in the menu", () => {
    const tombstone = {
      ...createViewSpace({
        id: asViewSpaceId("space-legacy"),
        name: "Legacy",
        initialSlotId: slotId("legacy"),
      }),
      deleted: true,
    };

    expect(deleteViewSpace([tombstone], tombstone.id)).toEqual({
      spaces: [],
      releasedTabKeys: [],
    });
  });

  it("keeps invariants through a combined move, close and reuse sequence", () => {
    const source = twoSlotSpace("source", "moving", "closing");
    const target = twoSlotSpace("target", null, null);
    const moved = assignMemberToSlot(
      [source, target],
      target.id,
      slotId("target-a"),
      tab("moving"),
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    const closed = closeSpaceMember(moved.spaces, tab("closing"));
    const reused = addMemberToViewSpace(
      closed.spaces,
      source.id,
      tab("replacement"),
    );

    expect(reused.ok).toBe(true);
    if (!reused.ok) return;
    expect(reused.spaces).toHaveLength(2);
    expect(validateViewSpaces(reused.spaces)).toEqual([]);
  });
});
