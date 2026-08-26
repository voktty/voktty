import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { describe, expect, it } from "vitest";
import { planWorkspaceDrop } from "./planWorkspaceDrop";
import {
  asSlotId,
  asViewSpaceId,
  createSlot,
  createSplit,
  type ViewSpace,
} from "./spaceLayout";
import type { WorkspaceDragSource, WorkspaceDropTarget } from "./workspaceDrag";

function space(
  id: string,
  first: string | null,
  second: string | null,
): ViewSpace {
  return {
    id: asViewSpaceId(`view-${id}`),
    name: id,
    presentation: "composite",
    memberOrder: [first, second]
      .filter((member): member is string => member !== null)
      .map(asTabKey),
    layout: createSplit(
      `split-${id}`,
      "row",
      0.5,
      createSlot(asSlotId(`${id}-first`), first ? asTabKey(first) : null),
      createSlot(asSlotId(`${id}-second`), second ? asTabKey(second) : null),
    ),
    focusedSlotId: asSlotId(`${id}-first`),
  };
}

function standalone(tabKey: string): WorkspaceDragSource {
  return { kind: "standalone-tab", tabId: 1, tabKey: asTabKey(tabKey) };
}

function resource(kind: "file" | "directory"): WorkspaceDragSource {
  return { kind, path: `/repo/${kind === "file" ? "index.ts" : "src"}` };
}

function terminalTab(tabKey: string, leafCount: number) {
  const leaves = Array.from({ length: leafCount }, (_, index) => ({
    kind: "leaf" as const,
    id: index + 1,
  }));
  return {
    tabKey: asTabKey(tabKey),
    kind: "terminal",
    paneTree:
      leaves.length === 1
        ? leaves[0]
        : {
            kind: "split" as const,
            id: leafCount + 1,
            dir: "row" as const,
            children: leaves,
          },
  };
}

function member(
  tabKey: string,
  viewSpaceId: string,
  slotId: string,
): WorkspaceDragSource {
  return {
    kind: "space-member",
    tabId: 1,
    tabKey: asTabKey(tabKey),
    viewSpaceId: asViewSpaceId(viewSpaceId),
    slotId: asSlotId(slotId),
  };
}

function target(slotId: string): WorkspaceDropTarget {
  return {
    kind: "slot",
    viewSpaceId: asViewSpaceId("view-a"),
    slotId: asSlotId(slotId),
  };
}

describe("planWorkspaceDrop", () => {
  it("assigns a standalone tab to an empty slot", () => {
    const result = planWorkspaceDrop({
      source: standalone("tab-new"),
      target: target("a-second"),
      viewSpaces: [space("a", "tab-first", null)],
    });

    expect(result).toMatchObject({
      accepted: true,
      operation: "assign",
      slotId: "a-second",
    });
  });

  it("swaps two members in the same space when the center is occupied", () => {
    const result = planWorkspaceDrop({
      source: member("tab-first", "view-a", "a-first"),
      target: target("a-second"),
      viewSpaces: [space("a", "tab-first", "tab-second")],
    });

    expect(result).toMatchObject({
      accepted: true,
      operation: "swap",
      sourceSlotId: "a-first",
      targetSlotId: "a-second",
    });
  });

  it("rejects a drop over the source member own slot", () => {
    const source = member("tab-first", "view-a", "a-first");
    const viewSpaces = [space("a", "tab-first", "tab-second")];

    expect(
      planWorkspaceDrop({
        source,
        target: target("a-first"),
        viewSpaces,
      }),
    ).toEqual({ accepted: false, reason: "same-target" });
  });

  it("adds a standalone tab to a composite when it is dropped on an occupied view", () => {
    const result = planWorkspaceDrop({
      source: standalone("tab-new"),
      target: target("a-first"),
      viewSpaces: [space("a", "tab-first", null)],
    });
    expect(result).toMatchObject({ accepted: true, operation: "append" });
  });

  it("extracts members only to the explicit loose strip and creates a new space explicitly", () => {
    const source = member("tab-first", "view-a", "a-first");
    expect(
      planWorkspaceDrop({
        source,
        target: { kind: "loose-strip" },
        viewSpaces: [space("a", "tab-first", "tab-second")],
      }),
    ).toMatchObject({ accepted: true, operation: "extract" });

    expect(
      planWorkspaceDrop({
        source: standalone("tab-new"),
        target: { kind: "new-space" },
        viewSpaces: [],
      }),
    ).toMatchObject({ accepted: true, operation: "new-space" });
  });

  it("adds a member from another space to an occupied target with capacity", () => {
    const result = planWorkspaceDrop({
      source: member("tab-foreign", "view-b", "b-first"),
      target: target("a-first"),
      viewSpaces: [
        space("a", "tab-first", null),
        space("b", "tab-foreign", null),
      ],
    });

    expect(result).toMatchObject({ accepted: true, operation: "append" });
  });

  it("does not append a member that already belongs to the target space", () => {
    const result = planWorkspaceDrop({
      source: member("tab-first", "view-a", "missing-slot"),
      target: target("a-second"),
      viewSpaces: [space("a", "tab-first", "tab-second")],
    });

    expect(result).toEqual({ accepted: false, reason: "same-space" });
  });

  it("rejects a drop before mutation when nested terminal panes exceed the budget", () => {
    const result = planWorkspaceDrop({
      source: standalone("tab-new"),
      target: target("a-second"),
      viewSpaces: [space("a", "tab-first", null)],
      tabs: [terminalTab("tab-first", 7), terminalTab("tab-new", 2)],
    });

    expect(result).toEqual({ accepted: false, reason: "renderer-capacity" });
  });

  it("never creates a view from an explorer resource dropped on an empty slot", () => {
    const result = planWorkspaceDrop({
      source: resource("file"),
      target: target("a-second"),
      viewSpaces: [space("a", "tab-first", null)],
    });

    expect(result).toEqual({
      accepted: false,
      reason: "resource-requires-view",
    });
  });

  it("uses a directory dropped on an occupied view as an AI reference", () => {
    const result = planWorkspaceDrop({
      source: resource("directory"),
      target: target("a-first"),
      viewSpaces: [space("a", "tab-first", "tab-second")],
    });

    expect(result).toMatchObject({ accepted: true, operation: "reference-resource" });
  });

  it("uses a resource in an occupied center as a reference instead of replacing a tab", () => {
    const result = planWorkspaceDrop({
      source: resource("file"),
      target: target("a-first"),
      viewSpaces: [space("a", "tab-first", null)],
    });

    expect(result).toMatchObject({ accepted: true, operation: "reference-resource" });
  });

  it("appends a standalone tab to a space when all existing slots are occupied and capacity allows", () => {
    const result = planWorkspaceDrop({
      source: standalone("tab-new"),
      target: { kind: "space", viewSpaceId: asViewSpaceId("view-a") },
      viewSpaces: [space("a", "tab-first", "tab-second")],
    });

    expect(result).toMatchObject({
      accepted: true,
      operation: "append",
      viewSpaceId: "view-a",
    });
  });

  it("rejects dropping a tab to a space when it already has maxSlots members", () => {
    const fullSpace: ViewSpace = {
      id: asViewSpaceId("view-a"),
      name: "Space A",
      color: 0,
      memberOrder: [
        asTabKey("t1"),
        asTabKey("t2"),
        asTabKey("t3"),
        asTabKey("t4"),
      ],
      focusedSlotId: asSlotId("s1"),
      presentation: "composite",
      layout: createSplit(
        "split-1",
        "row",
        0.5,
        createSlot(asSlotId("s1"), asTabKey("t1")),
        createSplit(
          "split-2",
          "column",
          0.5,
          createSlot(asSlotId("s2"), asTabKey("t2")),
          createSplit(
            "split-3",
            "row",
            0.5,
            createSlot(asSlotId("s3"), asTabKey("t3")),
            createSlot(asSlotId("s4"), asTabKey("t4")),
          ),
        ),
      ),
    };

    const result = planWorkspaceDrop({
      source: standalone("tab-new"),
      target: { kind: "space", viewSpaceId: asViewSpaceId("view-a") },
      viewSpaces: [fullSpace],
      maxSlots: 4,
    });

    expect(result).toEqual({
      accepted: false,
      reason: "max-slots",
    });
  });

  it("rejects dropping a tab to a space if it already belongs to that space", () => {
    const result = planWorkspaceDrop({
      source: member("tab-first", "view-a", "a-first"),
      target: { kind: "space", viewSpaceId: asViewSpaceId("view-a") },
      viewSpaces: [space("a", "tab-first", "tab-second")],
    });

    expect(result).toEqual({
      accepted: false,
      reason: "same-space",
    });
  });
});
