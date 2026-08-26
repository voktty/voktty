import type { TabKey } from "@/modules/tabs/lib/tabIdentity";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import type { SlotId, ViewSpace, ViewSpaceId } from "./spaceLayout";

export type StripEntry =
  | { kind: "standalone"; tabKey: TabKey }
  | { kind: "space"; spaceId: ViewSpaceId };

export type ActiveStripItem =
  | { kind: "tab"; tabKey: TabKey }
  | {
      kind: "space";
      spaceId: ViewSpaceId;
      focusedSlotId: SlotId | null;
    };

export type ProjectedTabItem = {
  kind: "tab";
  tab: Tab;
  tabKey: TabKey;
  spaceId: ViewSpaceId | null;
};

export type ProjectedSpaceItem = {
  kind: "space";
  space: ViewSpace;
  tabs: Tab[];
  activeTabKey: TabKey | null;
};

export type ProjectedStripItem = ProjectedTabItem | ProjectedSpaceItem;

type ProjectStripInput = {
  tabs: readonly Tab[];
  viewSpaces: readonly ViewSpace[];
  stripEntries: readonly StripEntry[];
};

function tabMap(tabs: readonly Tab[]): Map<TabKey, Tab> {
  return new Map(tabs.map((tab) => [tab.tabKey, tab]));
}

function projectExpandedSpace(
  space: ViewSpace,
  tabsByKey: ReadonlyMap<TabKey, Tab>,
  represented: Set<TabKey>,
): ProjectedTabItem[] {
  const projected: ProjectedTabItem[] = [];
  for (const tabKey of space.memberOrder) {
    const tab = tabsByKey.get(tabKey);
    if (!tab || represented.has(tabKey)) continue;
    represented.add(tabKey);
    projected.push({ kind: "tab", tab, tabKey, spaceId: space.id });
  }
  return projected;
}

export function projectStripEntries({
  tabs,
  viewSpaces,
  stripEntries,
}: ProjectStripInput): ProjectedStripItem[] {
  const tabsByKey = tabMap(tabs);
  const spacesById = new Map(viewSpaces.map((space) => [space.id, space]));
  const represented = new Set<TabKey>();
  const projected: ProjectedStripItem[] = [];

  for (const entry of stripEntries) {
    if (entry.kind === "standalone") {
      const tab = tabsByKey.get(entry.tabKey);
      if (!tab || represented.has(entry.tabKey)) continue;
      represented.add(entry.tabKey);
      projected.push({
        kind: "tab",
        tab,
        tabKey: entry.tabKey,
        spaceId: null,
      });
      continue;
    }

    const space = spacesById.get(entry.spaceId);
    if (!space || space.deleted) continue;
    if (space.presentation === "expanded") {
      projected.push(...projectExpandedSpace(space, tabsByKey, represented));
      continue;
    }

    const memberTabs = space.memberOrder.flatMap((tabKey) => {
      const tab = tabsByKey.get(tabKey);
      if (!tab || represented.has(tabKey)) return [];
      represented.add(tabKey);
      return [tab];
    });
    projected.push({
      kind: "space",
      space,
      tabs: memberTabs,
      activeTabKey:
        space.focusedSlotId === null
          ? null
          : ((space.layout.kind === "slot"
              ? space.layout
              : collectSpaceSlots(space.layout).find(
                  (slot) => slot.id === space.focusedSlotId,
                )
            )?.memberTabKey ?? null),
    });
  }

  for (const tab of tabs) {
    if (represented.has(tab.tabKey)) continue;
    represented.add(tab.tabKey);
    projected.push({
      kind: "tab",
      tab,
      tabKey: tab.tabKey,
      spaceId: null,
    });
  }
  return projected;
}

function collectSpaceSlots(
  layout: ViewSpace["layout"],
): Array<Extract<ViewSpace["layout"], { kind: "slot" }>> {
  if (layout.kind === "slot") return [layout];
  return [
    ...collectSpaceSlots(layout.first),
    ...collectSpaceSlots(layout.second),
  ];
}

export function projectedStripItemValue(item: ProjectedStripItem): string {
  return item.kind === "space" ? `space:${item.space.id}` : String(item.tab.id);
}

export function isProjectedStripItemActive(
  item: ProjectedStripItem,
  activeTabKey: TabKey | null,
): boolean {
  if (!activeTabKey) return false;
  return item.kind === "space"
    ? item.tabs.some((tab) => tab.tabKey === activeTabKey)
    : item.tabKey === activeTabKey;
}

export function activeTabKeyFromViewSpace(
  viewSpaces: readonly ViewSpace[],
  activeStripItem: ActiveStripItem | null,
  fallbackTabKey: TabKey | null,
): TabKey | null {
  if (activeStripItem?.kind === "tab") return activeStripItem.tabKey;
  if (activeStripItem?.kind === "space") {
    const space = viewSpaces.find(
      (candidate) => candidate.id === activeStripItem.spaceId,
    );
    if (space) {
      const focusedSlotId =
        activeStripItem.focusedSlotId ?? space.focusedSlotId;
      const focusedMember = collectSpaceSlots(space.layout).find(
        (slot) => slot.id === focusedSlotId,
      )?.memberTabKey;
      return focusedMember ?? space.memberOrder[0] ?? fallbackTabKey;
    }
  }
  return fallbackTabKey;
}

export function activeTabIdFromStrip(
  items: readonly ProjectedStripItem[],
  activeStripItem: ActiveStripItem | null,
  fallbackTabKey: TabKey | null,
): number | null {
  if (activeStripItem?.kind === "tab") {
    return (
      (
        items.find(
          (item) =>
            item.kind === "tab" && item.tabKey === activeStripItem.tabKey,
        ) as ProjectedTabItem | undefined
      )?.tab.id ?? null
    );
  }
  if (activeStripItem?.kind === "space") {
    const item = items.find(
      (candidate): candidate is ProjectedSpaceItem =>
        candidate.kind === "space" &&
        candidate.space.id === activeStripItem.spaceId,
    );
    if (item) {
      const focused =
        item.tabs.find((tab) => tab.tabKey === item.activeTabKey) ??
        item.tabs.find((tab) => tab.tabKey === fallbackTabKey);
      if (focused) return focused.id;
    }
  }
  return (
    items.find(
      (item): item is ProjectedTabItem =>
        item.kind === "tab" && item.tabKey === fallbackTabKey,
    )?.tab.id ?? null
  );
}

export type TabCloseFocusPlan = {
  closingTabId: number | null;
  activeWasClosed: boolean;
  nextActiveId: number | null;
  nextSpaceId: string | null;
  nextTabKey: TabKey | null;
};

function focusCandidate(
  item: ProjectedStripItem,
  closingId: number,
): Tab | null {
  if (item.kind === "tab") {
    return item.tab.id === closingId ? null : item.tab;
  }
  return (
    item.tabs.find(
      (tab) => tab.id !== closingId && tab.tabKey === item.activeTabKey,
    ) ??
    item.tabs.find((tab) => tab.id !== closingId) ??
    null
  );
}

function closeFocusResult(
  closingId: number | null,
  activeWasClosed: boolean,
  next: Tab | null,
): TabCloseFocusPlan {
  return {
    closingTabId: closingId,
    activeWasClosed,
    nextActiveId: next?.id ?? null,
    nextSpaceId: next?.spaceId ?? null,
    nextTabKey: next?.tabKey ?? null,
  };
}

/**
 * Plans focus after a single close against the visual strip, not only the
 * closing tab's legacy workspace. This keeps surviving resources reachable
 * when the last tab of a WSL/SSH/Docker space is closed.
 */
export function planTabCloseFocus(
  items: readonly ProjectedStripItem[],
  tabs: readonly Tab[],
  closingId: number,
  activeId: number,
): TabCloseFocusPlan {
  const closing = tabs.find((tab) => tab.id === closingId) ?? null;
  if (!closing) return closeFocusResult(null, false, null);
  if (closingId !== activeId) {
    return closeFocusResult(
      closingId,
      false,
      tabs.find((tab) => tab.id === activeId) ?? null,
    );
  }

  const itemIndex = items.findIndex((item) =>
    item.kind === "tab"
      ? item.tab.id === closingId
      : item.tabs.some((tab) => tab.id === closingId),
  );
  const owner = itemIndex >= 0 ? items[itemIndex] : undefined;
  if (owner?.kind === "space") {
    const memberIndex = owner.tabs.findIndex((tab) => tab.id === closingId);
    const sibling =
      owner.tabs[memberIndex - 1] ?? owner.tabs[memberIndex + 1] ?? null;
    if (sibling) return closeFocusResult(closingId, true, sibling);
  }

  if (itemIndex >= 0) {
    for (let index = itemIndex - 1; index >= 0; index -= 1) {
      const candidate = focusCandidate(items[index], closingId);
      if (candidate) return closeFocusResult(closingId, true, candidate);
    }
    for (let index = itemIndex + 1; index < items.length; index += 1) {
      const candidate = focusCandidate(items[index], closingId);
      if (candidate) return closeFocusResult(closingId, true, candidate);
    }
  }

  const tabIndex = tabs.findIndex((tab) => tab.id === closingId);
  const fallback = tabs[tabIndex - 1] ?? tabs[tabIndex + 1] ?? null;
  return closeFocusResult(closingId, true, fallback);
}
