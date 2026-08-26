import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { beforeEach, describe, expect, it } from "vitest";
import {
  asSlotId,
  asViewSpaceId,
  collectLayoutSlots,
  createSlot,
  createSplit,
} from "./spaceLayout";
import { useSpaces } from "./useSpaces";

describe("session projection reconciliation", () => {
  beforeEach(() => {
    useSpaces.setState({
      spaces: [],
      activeId: null,
      hydrated: true,
      initialActiveIndex: {},
      viewSpaces: [],
      stripEntries: [],
      activeStripItem: null,
    });
  });

  it("collapses vanished members and adds new standalone tabs", () => {
    useSpaces.setState({
      viewSpaces: [
        {
          id: asViewSpaceId("view-a"),
          name: "A",
          presentation: "composite",
          memberOrder: [asTabKey("tab-kept"), asTabKey("tab-vanished")],
          focusedSlotId: asSlotId("slot-kept"),
          layout: createSplit(
            "split-a",
            "row",
            0.65,
            createSlot(asSlotId("slot-kept"), asTabKey("tab-kept")),
            createSlot(asSlotId("slot-empty"), asTabKey("tab-vanished")),
          ),
        },
      ],
      stripEntries: [{ kind: "space", spaceId: asViewSpaceId("view-a") }],
    });

    useSpaces.getState().reconcileLiveTabs(["tab-kept", "tab-new"], "tab-new");
    const state = useSpaces.getState();

    expect(collectLayoutSlots(state.viewSpaces[0].layout)).toHaveLength(1);
    expect(JSON.stringify(state.viewSpaces[0].layout)).not.toContain(
      "tab-vanished",
    );
    expect(state.stripEntries).toEqual([
      { kind: "space", spaceId: "view-a" },
      { kind: "standalone", tabKey: "tab-new" },
    ]);
    expect(state.activeStripItem).toEqual({
      kind: "tab",
      tabKey: "tab-new",
    });
  });

  it("moves composite focus to the next live member after the focused tab closes", () => {
    const first = asTabKey("tab-first");
    const second = asTabKey("tab-second");
    const viewId = asViewSpaceId("view-focus");
    useSpaces.setState({
      viewSpaces: [
        {
          id: viewId,
          name: "Focus",
          presentation: "composite",
          memberOrder: [first, second],
          focusedSlotId: asSlotId("slot-first"),
          layout: createSplit(
            "split-focus",
            "row",
            0.5,
            createSlot(asSlotId("slot-first"), first),
            createSlot(asSlotId("slot-second"), second),
          ),
        },
      ],
      stripEntries: [{ kind: "space", spaceId: viewId }],
    });

    useSpaces.getState().reconcileLiveTabs(["tab-second"], "tab-second");
    const state = useSpaces.getState();
    expect(state.viewSpaces[0].focusedSlotId).toBe(asSlotId("slot-second"));
    expect(state.activeStripItem).toEqual({
      kind: "space",
      spaceId: viewId,
      focusedSlotId: asSlotId("slot-second"),
    });
  });

  it("cycles the focused composite slot without leaving the space", () => {
    const first = asTabKey("tab-first");
    const second = asTabKey("tab-second");
    const viewId = asViewSpaceId("view-cycle");
    useSpaces.setState({
      viewSpaces: [
        {
          id: viewId,
          name: "Cycle",
          presentation: "composite",
          memberOrder: [first, second],
          focusedSlotId: asSlotId("slot-first"),
          layout: createSplit(
            "split-cycle",
            "row",
            0.5,
            createSlot(asSlotId("slot-first"), first),
            createSlot(asSlotId("slot-second"), second),
          ),
        },
      ],
      stripEntries: [{ kind: "space", spaceId: viewId }],
    });

    expect(useSpaces.getState().focusNextViewSpaceSlot(viewId, 1)).toBe(second);
    expect(useSpaces.getState().activeStripItem).toEqual({
      kind: "space",
      spaceId: viewId,
      focusedSlotId: asSlotId("slot-second"),
    });
  });

  it("compacts a view space, focuses its last slot and expands without closing members", () => {
    const first = asTabKey("tab-first");
    const second = asTabKey("tab-second");
    const firstSlot = asSlotId("slot-first");
    const secondSlot = asSlotId("slot-second");
    useSpaces.setState({
      viewSpaces: [
        {
          id: asViewSpaceId("view-a"),
          name: "A",
          presentation: "expanded",
          memberOrder: [first, second],
          focusedSlotId: secondSlot,
          layout: createSplit(
            "split-a",
            "row",
            0.5,
            createSlot(firstSlot, first),
            createSlot(secondSlot, second),
          ),
        },
      ],
    });

    expect(useSpaces.getState().openViewSpace("view-a")).toBe(second);
    expect(useSpaces.getState().viewSpaces[0].presentation).toBe("composite");
    expect(useSpaces.getState().activeStripItem).toEqual({
      kind: "space",
      spaceId: "view-a",
      focusedSlotId: secondSlot,
    });

    useSpaces.getState().expandViewSpace("view-a");
    expect(useSpaces.getState().viewSpaces[0].presentation).toBe("expanded");
    expect(useSpaces.getState().activeStripItem).toEqual({
      kind: "tab",
      tabKey: second,
    });
  });

  it("adds up to four members and rebalances the visual space automatically", () => {
    const viewId = useSpaces.getState().ensureViewSpace({
      workspaceId: "adaptive",
      name: "Adaptive",
    });

    for (let index = 1; index <= 4; index += 1) {
      expect(
        useSpaces
          .getState()
          .addMemberToViewSpace(viewId, `tab-adaptive-${index}`),
      ).toBe(true);
    }

    const space = useSpaces.getState().viewSpaces[0];
    expect(space.memberOrder).toHaveLength(4);
    expect(collectLayoutSlots(space.layout)).toHaveLength(4);
    expect(
      useSpaces.getState().addMemberToViewSpace(viewId, "tab-overflow"),
    ).toBe(false);
    expect(useSpaces.getState().viewSpaces[0]).toBe(space);
  });

  it("reorders only existing members and keeps omitted members in the block", () => {
    const members = [
      asTabKey("tab-one"),
      asTabKey("tab-two"),
      asTabKey("tab-three"),
    ];
    useSpaces.setState({
      viewSpaces: [
        {
          id: asViewSpaceId("view-a"),
          name: "A",
          presentation: "expanded",
          memberOrder: members,
          focusedSlotId: null,
          layout: createSplit(
            "split-a",
            "row",
            0.5,
            createSlot(asSlotId("slot-one"), members[0]),
            createSplit(
              "split-a-second",
              "column",
              0.5,
              createSlot(asSlotId("slot-two"), members[1]),
              createSlot(asSlotId("slot-three"), members[2]),
            ),
          ),
        },
      ],
    });

    useSpaces
      .getState()
      .reorderViewSpaceMembers("view-a", ["tab-three", "tab-three", "unknown"]);

    expect(useSpaces.getState().viewSpaces[0].memberOrder).toEqual([
      members[2],
      members[0],
      members[1],
    ]);
  });

  it("reorders standalone strip entries without moving composite space anchors", () => {
    const first = asTabKey("tab-first");
    const second = asTabKey("tab-second");
    const third = asTabKey("tab-third");
    const viewId = asViewSpaceId("view-a");
    useSpaces.setState({
      stripEntries: [
        { kind: "standalone", tabKey: first },
        { kind: "space", spaceId: viewId },
        { kind: "standalone", tabKey: second },
        { kind: "standalone", tabKey: third },
      ],
    });

    useSpaces
      .getState()
      .reorderStandaloneTabByGap(third, 0, [first, second, third]);

    expect(useSpaces.getState().stripEntries).toEqual([
      { kind: "standalone", tabKey: third },
      { kind: "space", spaceId: viewId },
      { kind: "standalone", tabKey: first },
      { kind: "standalone", tabKey: second },
    ]);
  });

  it("counts only standalone tabs when the visual gap includes space members", () => {
    const first = asTabKey("tab-first");
    const member = asTabKey("tab-member");
    const second = asTabKey("tab-second");
    useSpaces.setState({
      stripEntries: [
        { kind: "standalone", tabKey: first },
        { kind: "standalone", tabKey: second },
      ],
    });

    useSpaces
      .getState()
      .reorderStandaloneTabByGap(second, 1, [member, first, second]);

    expect(useSpaces.getState().stripEntries).toEqual([
      { kind: "standalone", tabKey: second },
      { kind: "standalone", tabKey: first },
    ]);
  });

  it("extracts a member without closing it and makes it standalone", () => {
    const member = asTabKey("tab-member");
    const viewId = asViewSpaceId("view-a");
    useSpaces.setState({
      viewSpaces: [
        {
          id: viewId,
          name: "A",
          presentation: "composite",
          memberOrder: [member],
          focusedSlotId: asSlotId("slot-a"),
          layout: createSlot(asSlotId("slot-a"), member),
        },
      ],
      stripEntries: [{ kind: "space", spaceId: viewId }],
      activeStripItem: {
        kind: "space",
        spaceId: viewId,
        focusedSlotId: asSlotId("slot-a"),
      },
    });

    expect(useSpaces.getState().extractMemberFromViewSpace(member)).toBe(true);
    const state = useSpaces.getState();
    expect(state.viewSpaces[0].memberOrder).toEqual([]);
    expect(state.stripEntries).toEqual([
      { kind: "space", spaceId: viewId },
      { kind: "standalone", tabKey: member },
    ]);
    expect(state.activeStripItem).toEqual({ kind: "tab", tabKey: member });
  });

  it("deletes the visual space and releases members in strip order", () => {
    const first = asTabKey("tab-first");
    const second = asTabKey("tab-second");
    const viewId = asViewSpaceId("view-a");
    useSpaces.setState({
      viewSpaces: [
        {
          id: viewId,
          name: "A",
          presentation: "expanded",
          memberOrder: [first, second],
          focusedSlotId: asSlotId("slot-first"),
          layout: createSplit(
            "split-a",
            "row",
            0.5,
            createSlot(asSlotId("slot-first"), first),
            createSlot(asSlotId("slot-second"), second),
          ),
        },
      ],
      stripEntries: [{ kind: "space", spaceId: viewId }],
      activeStripItem: { kind: "space", spaceId: viewId, focusedSlotId: null },
    });

    expect(useSpaces.getState().deleteViewSpace(viewId)).toEqual([
      first,
      second,
    ]);
    expect(useSpaces.getState().viewSpaces).toEqual([]);
    expect(useSpaces.getState().stripEntries).toEqual([
      { kind: "standalone", tabKey: first },
      { kind: "standalone", tabKey: second },
    ]);
    expect(useSpaces.getState().activeStripItem).toEqual({
      kind: "tab",
      tabKey: first,
    });
  });

  it("preserves the focused member when deleting the active visual space", () => {
    const first = asTabKey("tab-first");
    const focused = asTabKey("tab-focused");
    const viewId = asViewSpaceId("view-a");
    const focusedSlotId = asSlotId("slot-focused");
    useSpaces.setState({
      viewSpaces: [
        {
          id: viewId,
          name: "A",
          presentation: "composite",
          memberOrder: [first, focused],
          focusedSlotId,
          layout: createSplit(
            "split-a",
            "row",
            0.5,
            createSlot(asSlotId("slot-first"), first),
            createSlot(focusedSlotId, focused),
          ),
        },
      ],
      stripEntries: [{ kind: "space", spaceId: viewId }],
      activeStripItem: {
        kind: "space",
        spaceId: viewId,
        focusedSlotId,
      },
    });

    useSpaces.getState().deleteViewSpace(viewId);

    expect(useSpaces.getState().activeStripItem).toEqual({
      kind: "tab",
      tabKey: focused,
    });
  });

  it("focuses a surviving standalone tab after deleting an empty active space", () => {
    const survivor = asTabKey("tab-survivor");
    const viewId = asViewSpaceId("view-empty");
    const slotId = asSlotId("slot-empty");
    useSpaces.setState({
      viewSpaces: [
        {
          id: viewId,
          name: "Empty",
          presentation: "composite",
          memberOrder: [],
          focusedSlotId: slotId,
          layout: createSlot(slotId, null),
        },
      ],
      stripEntries: [
        { kind: "space", spaceId: viewId },
        { kind: "standalone", tabKey: survivor },
      ],
      activeStripItem: {
        kind: "space",
        spaceId: viewId,
        focusedSlotId: slotId,
      },
    });

    useSpaces.getState().deleteViewSpace(viewId);

    expect(useSpaces.getState().activeStripItem).toEqual({
      kind: "tab",
      tabKey: survivor,
    });
  });

  it("creates a fresh visual shell after deletion without restoring released members", () => {
    const viewId = asViewSpaceId("view-a");
    const member = asTabKey("tab-member");
    useSpaces.setState({
      viewSpaces: [
        {
          id: viewId,
          name: "A",
          presentation: "expanded",
          memberOrder: [member],
          focusedSlotId: asSlotId("slot-a"),
          layout: createSlot(asSlotId("slot-a"), member),
        },
      ],
      stripEntries: [{ kind: "space", spaceId: viewId }],
    });

    useSpaces.getState().deleteViewSpace(viewId);
    useSpaces.getState().ensureViewSpace({
      workspaceId: "a",
      name: "A",
    });
    useSpaces.getState().openViewSpace(viewId);
    const state = useSpaces.getState();

    expect(state.viewSpaces[0].deleted).toBeUndefined();
    expect(state.viewSpaces[0].memberOrder).toEqual([]);
    expect(state.stripEntries).toEqual([
      { kind: "standalone", tabKey: member },
      { kind: "space", spaceId: viewId },
    ]);
    expect(state.activeStripItem).toEqual({
      kind: "space",
      spaceId: viewId,
      focusedSlotId: asSlotId("slot-a"),
    });
  });

  it("atomically hydrates spaces along with projection to preserve space membership on restore", () => {
    const spaceMeta = {
      id: "sp-1",
      name: "Project Space",
      root: "/repo",
      env: { kind: "local" as const },
      createdAt: 100,
      updatedAt: 100,
    };
    const viewId = asViewSpaceId("view-sp-1");
    const tabKey1 = asTabKey("tab-1");
    const tabKey2 = asTabKey("tab-2");
    const slot1 = asSlotId("slot-1");
    const slot2 = asSlotId("slot-2");

    useSpaces.getState().hydrate(
      [spaceMeta],
      "sp-1",
      { "sp-1": 0 },
      {
        viewSpaces: [
          {
            id: viewId,
            name: "Project Space",
            presentation: "composite",
            memberOrder: [tabKey1, tabKey2],
            focusedSlotId: slot1,
            layout: createSplit(
              "split-1",
              "row",
              0.5,
              createSlot(slot1, tabKey1),
              createSlot(slot2, tabKey2),
            ),
          },
        ],
        stripEntries: [{ kind: "space", spaceId: viewId }],
        activeStripItem: {
          kind: "space",
          spaceId: viewId,
          focusedSlotId: slot1,
        },
      },
    );

    const state = useSpaces.getState();
    expect(state.hydrated).toBe(true);
    expect(state.spaces).toHaveLength(1);
    expect(state.viewSpaces).toHaveLength(1);
    expect(state.viewSpaces[0].memberOrder).toEqual([tabKey1, tabKey2]);
    expect(state.viewSpaces[0].presentation).toBe("composite");
    expect(state.stripEntries).toEqual([{ kind: "space", spaceId: viewId }]);

    // When live tabs match restored tabs, reconciliation keeps the space intact
    useSpaces.getState().reconcileLiveTabs(["tab-1", "tab-2"], "tab-1");
    const afterReconciliation = useSpaces.getState();
    expect(afterReconciliation.viewSpaces[0].memberOrder).toEqual([
      tabKey1,
      tabKey2,
    ]);
    expect(afterReconciliation.stripEntries).toEqual([
      { kind: "space", spaceId: viewId },
    ]);
  });
});
