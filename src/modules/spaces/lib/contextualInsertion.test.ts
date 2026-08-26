import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { describe, expect, it } from "vitest";
import { planContextualSpaceInsertion } from "./contextualInsertion";
import { asSlotId, asViewSpaceId, type ViewSpace } from "./spaceLayout";
import { createViewSpace, rebalanceViewSpace } from "./spaceOperations";

function space(
  memberCount: number,
  presentation: ViewSpace["presentation"] = "composite",
) {
  const created = createViewSpace({
    id: asViewSpaceId("view-workspace"),
    name: "Workspace",
    initialSlotId: asSlotId("slot-1"),
  });
  const members = Array.from({ length: memberCount }, (_, index) =>
    asTabKey(`tab-${index + 1}`),
  );
  return {
    ...rebalanceViewSpace(created, members),
    presentation,
  };
}

describe("planContextualSpaceInsertion", () => {
  it("appends an in-app creation to the active composite space", () => {
    expect(
      planContextualSpaceInsertion([space(2)], {
        kind: "space",
        spaceId: asViewSpaceId("view-workspace"),
        focusedSlotId: asSlotId("slot-1"),
      }),
    ).toEqual({ kind: "append", viewSpaceId: "view-workspace" });
  });

  it("keeps creation standalone outside a mounted composite", () => {
    expect(
      planContextualSpaceInsertion([space(2)], {
        kind: "tab",
        tabKey: asTabKey("tab-1"),
      }),
    ).toEqual({ kind: "standalone" });
    expect(
      planContextualSpaceInsertion([space(2, "expanded")], {
        kind: "space",
        spaceId: asViewSpaceId("view-workspace"),
        focusedSlotId: null,
      }),
    ).toEqual({ kind: "standalone" });
  });

  it("falls back to standalone creation when space reached maximum slots", () => {
    expect(
      planContextualSpaceInsertion([space(4)], {
        kind: "space",
        spaceId: asViewSpaceId("view-workspace"),
        focusedSlotId: null,
      }),
    ).toEqual({ kind: "standalone" });
  });
});
