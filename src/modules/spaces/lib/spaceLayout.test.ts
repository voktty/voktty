import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { describe, expect, it } from "vitest";
import {
  asSlotId,
  asViewSpaceId,
  createSlot,
  createSplit,
  type SpaceLayoutNode,
  updateLayoutSplitRatio,
  type ViewSpace,
  validateViewSpaces,
} from "./spaceLayout";

const tab = (id: string) => asTabKey(`tab-${id}`);
const slot = (id: string, member: string | null = null) =>
  createSlot(asSlotId(id), member ? tab(member) : null);

function space(overrides: Partial<ViewSpace> = {}): ViewSpace {
  return {
    id: asViewSpaceId("space-a"),
    name: "Space A",
    presentation: "expanded",
    memberOrder: [tab("a")],
    layout: slot("slot-a", "a"),
    focusedSlotId: asSlotId("slot-a"),
    ...overrides,
  };
}

describe("validateViewSpaces", () => {
  it("accepts a mixed four-slot layout", () => {
    const layout = createSplit(
      "split-root",
      "row",
      0.6,
      createSplit(
        "split-left",
        "column",
        0.5,
        slot("slot-a", "a"),
        slot("slot-b", "b"),
      ),
      createSplit(
        "split-right",
        "column",
        0.4,
        slot("slot-c", "c"),
        slot("slot-d", "d"),
      ),
    );
    const candidate = space({
      layout,
      memberOrder: [tab("a"), tab("b"), tab("c"), tab("d")],
    });

    expect(
      validateViewSpaces([candidate], new Set(candidate.memberOrder)),
    ).toEqual([]);
  });

  it("rejects a fifth slot", () => {
    const firstFour = createSplit(
      "split-root",
      "row",
      0.5,
      createSplit("split-left", "column", 0.5, slot("slot-a"), slot("slot-b")),
      createSplit("split-right", "column", 0.5, slot("slot-c"), slot("slot-d")),
    );
    const layout = createSplit(
      "split-overflow",
      "row",
      0.5,
      firstFour,
      slot("slot-e"),
    );

    expect(validateViewSpaces([space({ layout, memberOrder: [] })])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "too-many-slots" }),
      ]),
    );
  });

  it("rejects duplicated members across spaces", () => {
    const spaces = [
      space(),
      space({
        id: asViewSpaceId("space-b"),
        name: "Space B",
        layout: slot("slot-b", "a"),
        focusedSlotId: asSlotId("slot-b"),
      }),
    ];

    expect(validateViewSpaces(spaces)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-member" }),
      ]),
    );
  });

  it("rejects unknown member references and invalid focus", () => {
    const candidate = space({ focusedSlotId: asSlotId("missing-slot") });

    expect(validateViewSpaces([candidate], new Set())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-member" }),
        expect.objectContaining({ code: "unknown-focused-slot" }),
      ]),
    );
  });

  it("rejects invalid ratios and cyclic trees without recursing forever", () => {
    const cyclic = createSplit(
      "split-cycle",
      "row",
      Number.NaN,
      slot("slot-a", "a"),
      slot("slot-b"),
    );
    (cyclic as { first: SpaceLayoutNode }).first = cyclic;

    expect(validateViewSpaces([space({ layout: cyclic })])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-ratio" }),
        expect.objectContaining({ code: "cyclic-layout" }),
      ]),
    );
  });

  it("requires memberOrder to match the occupied slots exactly", () => {
    expect(validateViewSpaces([space({ memberOrder: [] })])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "member-order-mismatch" }),
      ]),
    );
  });
});

describe("updateLayoutSplitRatio", () => {
  it("updates only the requested split and preserves stable descendants", () => {
    const left = createSplit(
      "split-left",
      "column",
      0.4,
      slot("slot-a", "a"),
      slot("slot-b", "b"),
    );
    const rightFirst = slot("slot-c", "c");
    const rightSecond = slot("slot-d", "d");
    const right = createSplit(
      "split-right",
      "column",
      0.6,
      rightFirst,
      rightSecond,
    );
    const layout = createSplit("split-root", "row", 0.5, left, right);

    const next = updateLayoutSplitRatio(layout, "split-right", 0.72);

    expect(next).not.toBe(layout);
    expect(next.kind).toBe("split");
    if (next.kind !== "split") return;
    expect(next.ratio).toBe(0.5);
    expect(next.first).toBe(left);
    expect(next.second.kind).toBe("split");
    if (next.second.kind !== "split") return;
    expect(next.second.ratio).toBe(0.72);
    expect(next.second.first).toBe(rightFirst);
    expect(next.second.second).toBe(rightSecond);
  });
});
