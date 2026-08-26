import type { Tab } from "@/modules/tabs";
import type { TabKey } from "@/modules/tabs/lib/tabIdentity";
import { collectLayoutSlots, type ViewSpace } from "./spaceLayout";
import type { StripEntry } from "./spaceProjection";
import type { SpaceMeta } from "./store";

export type SpaceMenuPresentation = "composite" | "expanded" | "empty";

export type SpaceMenuModel = {
  space: SpaceMeta;
  viewSpace: ViewSpace | null;
  tabs: Tab[];
  members: Tab[];
  standaloneTabs: Tab[];
  focusedMemberKey: TabKey | null;
  memberSlotByKey: ReadonlyMap<TabKey, string>;
  slotCount: number;
  freeSlotCount: number;
  presentation: SpaceMenuPresentation;
};

function viewSpaceFor(
  space: SpaceMeta,
  viewSpaces: readonly ViewSpace[],
): ViewSpace | null {
  return (
    viewSpaces.find((candidate) => candidate.id === `view-${space.id}`) ?? null
  );
}

export function buildSpaceMenuModels(
  spaces: readonly SpaceMeta[],
  viewSpaces: readonly ViewSpace[],
  tabs: readonly Tab[],
  stripEntries: readonly StripEntry[] = [],
): SpaceMenuModel[] {
  const standaloneRank = new Map<TabKey, number>();
  for (const entry of stripEntries) {
    if (entry.kind === "standalone") {
      standaloneRank.set(entry.tabKey, standaloneRank.size);
    }
  }
  return spaces.map((space) => {
    const spaceTabs = tabs.filter((tab) => tab.spaceId === space.id);
    const viewSpace = viewSpaceFor(space, viewSpaces);
    const tabsByKey = new Map(spaceTabs.map((tab) => [tab.tabKey, tab]));
    const slots = viewSpace ? collectLayoutSlots(viewSpace.layout) : [];
    const members = viewSpace
      ? viewSpace.memberOrder.flatMap((tabKey) => {
          const tab = tabsByKey.get(tabKey);
          return tab ? [tab] : [];
        })
      : [];
    const memberKeys = new Set(members.map((tab) => tab.tabKey));
    const standaloneTabs = spaceTabs
      .filter((tab) => !memberKeys.has(tab.tabKey))
      .map((tab, index) => ({ tab, index }))
      .sort(
        (a, b) =>
          (standaloneRank.get(a.tab.tabKey) ?? Number.MAX_SAFE_INTEGER) -
            (standaloneRank.get(b.tab.tabKey) ?? Number.MAX_SAFE_INTEGER) ||
          a.index - b.index,
      )
      .map(({ tab }) => tab);
    const memberSlotByKey = new Map<TabKey, string>();
    for (const slot of slots) {
      if (slot.memberTabKey) memberSlotByKey.set(slot.memberTabKey, slot.id);
    }
    const focusedMemberKey =
      viewSpace?.focusedSlotId === null || !viewSpace
        ? null
        : (slots.find((slot) => slot.id === viewSpace.focusedSlotId)
            ?.memberTabKey ?? null);

    return {
      space,
      viewSpace,
      tabs: spaceTabs,
      members,
      standaloneTabs,
      focusedMemberKey,
      memberSlotByKey,
      slotCount: slots.length,
      freeSlotCount: slots.filter((slot) => slot.memberTabKey === null).length,
      presentation:
        members.length === 0
          ? "empty"
          : viewSpace?.presentation === "composite"
            ? "composite"
            : "expanded",
    } satisfies SpaceMenuModel;
  });
}
