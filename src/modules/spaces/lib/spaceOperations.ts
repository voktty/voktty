import type { TabKey } from "@/modules/tabs/lib/tabIdentity";
import {
  collectLayoutSlots,
  createSlot,
  createSplit,
  mapLayoutSlots,
  type SpaceLayoutNode,
  type SlotId,
  type ViewSpace,
  type ViewSpaceId,
} from "./spaceLayout";

type CreateViewSpaceInput = {
  id: ViewSpaceId;
  name: string;
  initialSlotId: SlotId;
  initialMember?: TabKey | null;
  color?: number;
};

type SpaceOperationFailure = {
  ok: false;
  reason:
    | "space-not-found"
    | "slot-not-found"
    | "slot-occupied"
    | "same-target"
    | "max-slots";
  spaces: readonly ViewSpace[];
};

type SpaceOperationSuccess = {
  ok: true;
  spaces: ViewSpace[];
};

export function createViewSpace(input: CreateViewSpaceInput): ViewSpace {
  const member = input.initialMember ?? null;
  return {
    id: input.id,
    name: input.name,
    ...(input.color !== undefined && { color: input.color }),
    presentation: "expanded",
    memberOrder: member ? [member] : [],
    layout: {
      kind: "slot",
      id: input.initialSlotId,
      memberTabKey: member,
    },
    focusedSlotId: input.initialSlotId,
  };
}

export function openViewSpace(space: ViewSpace): ViewSpace {
  const reopened: ViewSpace = space.deleted
    ? (() => {
        const { deleted: _deleted, ...rest } = space;
        return rest;
      })()
    : space;
  const slots = collectLayoutSlots(reopened.layout);
  const focused =
    slots.find(
      (slot) =>
        slot.id === reopened.focusedSlotId && slot.memberTabKey !== null,
    )?.id ??
    slots.find((slot) => slot.memberTabKey !== null)?.id ??
    (slots.some((slot) => slot.id === reopened.focusedSlotId)
      ? reopened.focusedSlotId
      : (slots[0]?.id ?? null));
  if (
    !reopened.deleted &&
    reopened.presentation === "composite" &&
    reopened.focusedSlotId === focused
  ) {
    return reopened;
  }
  return { ...reopened, presentation: "composite", focusedSlotId: focused };
}

export function expandViewSpace(space: ViewSpace): ViewSpace {
  return space.presentation === "expanded"
    ? space
    : { ...space, presentation: "expanded" };
}

export function focusViewSpaceSlot(
  space: ViewSpace,
  slotId: SlotId,
): ViewSpace {
  if (!collectLayoutSlots(space.layout).some((slot) => slot.id === slotId)) {
    return space;
  }
  return space.focusedSlotId === slotId
    ? space
    : { ...space, focusedSlotId: slotId };
}

export function nextOccupiedSlotId(
  space: ViewSpace,
  delta: 1 | -1,
): SlotId | null {
  const occupied = collectLayoutSlots(space.layout).filter(
    (slot) => slot.memberTabKey !== null,
  );
  if (occupied.length === 0) return null;

  const currentIndex = occupied.findIndex(
    (slot) => slot.id === space.focusedSlotId,
  );
  const anchor = currentIndex === -1 ? (delta === 1 ? -1 : 0) : currentIndex;
  return occupied[(anchor + delta + occupied.length) % occupied.length].id;
}

/**
 * Repairs focus after a member disappears while preserving the layout slot.
 * When the focused member was removed, the next occupied slot in layout order
 * wins; with no members left the previous slot remains available for reuse.
 */
export function repairFocusedSlot(
  space: ViewSpace,
  previousFocusedSlotId: SlotId | null = space.focusedSlotId,
): ViewSpace {
  const slots = collectLayoutSlots(space.layout);
  const occupied = slots.filter((slot) => slot.memberTabKey !== null);
  if (occupied.length === 0) {
    return {
      ...space,
      focusedSlotId:
        slots.find((slot) => slot.id === previousFocusedSlotId)?.id ??
        slots[0]?.id ??
        null,
    };
  }

  const previousIndex = slots.findIndex(
    (slot) => slot.id === previousFocusedSlotId,
  );
  const current = occupied.find((slot) => slot.id === space.focusedSlotId);
  if (current) return space;

  const nextAfterPrevious = occupied.find(
    (slot) =>
      previousIndex >= 0 &&
      slots.findIndex((candidate) => candidate.id === slot.id) > previousIndex,
  );
  return {
    ...space,
    focusedSlotId:
      nextAfterPrevious?.id ?? occupied[0]?.id ?? space.focusedSlotId ?? null,
  };
}

function withoutMember(space: ViewSpace, tabKey: TabKey): ViewSpace {
  if (!space.memberOrder.includes(tabKey)) return space;
  return {
    ...space,
    memberOrder: space.memberOrder.filter((member) => member !== tabKey),
    layout: mapLayoutSlots(space.layout, (slot) =>
      slot.memberTabKey === tabKey ? { ...slot, memberTabKey: null } : slot,
    ),
  };
}

function uniqueMembers(members: readonly TabKey[]): TabKey[] {
  return [...new Set(members)];
}

function adaptiveLayout(
  space: ViewSpace,
  members: readonly TabKey[],
): SpaceLayoutNode {
  const previousSlots = collectLayoutSlots(space.layout);
  const previousSlotByMember = new Map(
    previousSlots.flatMap((slot) =>
      slot.memberTabKey ? [[slot.memberTabKey, slot.id] as const] : [],
    ),
  );
  const usedSlotIds = new Set<SlotId>();
  const availableSlotIds = previousSlots.map((slot) => slot.id);
  const slotFor = (member: TabKey, index: number): SpaceLayoutNode => {
    let id = previousSlotByMember.get(member);
    if (!id || usedSlotIds.has(id)) {
      id = availableSlotIds.find((candidate) => !usedSlotIds.has(candidate));
    }
    if (!id) {
      const base = `${space.id}-slot-${index + 1}`;
      let candidate = base as SlotId;
      let suffix = 2;
      while (usedSlotIds.has(candidate)) {
        candidate = `${base}-${suffix}` as SlotId;
        suffix += 1;
      }
      id = candidate;
    }
    usedSlotIds.add(id);
    return createSlot(id, member);
  };

  if (members.length === 0) {
    return createSlot(
      previousSlots[0]?.id ?? (`${space.id}-slot-1` as SlotId),
      null,
    );
  }

  const slots = members.map(slotFor);
  if (slots.length === 1) return slots[0];
  if (slots.length === 2) {
    return createSplit(
      `${space.id}-layout-root`,
      "row",
      0.5,
      slots[0],
      slots[1],
    );
  }
  if (slots.length === 3) {
    return createSplit(
      `${space.id}-layout-root`,
      "row",
      0.5,
      slots[0],
      createSplit(
        `${space.id}-layout-right`,
        "column",
        0.5,
        slots[1],
        slots[2],
      ),
    );
  }
  if (slots.length === 4) {
    return createSplit(
      `${space.id}-layout-root`,
      "row",
      0.5,
      createSplit(
        `${space.id}-layout-left`,
        "column",
        0.5,
        slots[0],
        slots[1],
      ),
      createSplit(
        `${space.id}-layout-right`,
        "column",
        0.5,
        slots[2],
        slots[3],
      ),
    );
  }

  // Spaces are deliberately flat. The split tree is only a rendering detail
  // for a balanced grid; users never create nested "spaces inside spaces".
  const column = (items: SpaceLayoutNode[], id: string): SpaceLayoutNode => {
    if (items.length === 1) return items[0];
    const midpoint = Math.ceil(items.length / 2);
    return createSplit(
      id,
      "column",
      0.5,
      column(items.slice(0, midpoint), `${id}-a`),
      column(items.slice(midpoint), `${id}-b`),
    );
  };
  const midpoint = Math.ceil(slots.length / 2);
  return createSplit(
    `${space.id}-layout-root`,
    "row",
    0.5,
    column(slots.slice(0, midpoint), `${space.id}-layout-left`),
    column(slots.slice(midpoint), `${space.id}-layout-right`),
  );
}

export function rebalanceViewSpace(
  space: ViewSpace,
  requestedMembers: readonly TabKey[] = space.memberOrder,
  maxMembers = 8,
): ViewSpace {
  const members = uniqueMembers(requestedMembers).slice(0, maxMembers);
  const slots = collectLayoutSlots(space.layout);
  const layoutMembers = slots.flatMap((slot) =>
    slot.memberTabKey ? [slot.memberTabKey] : [],
  );
  if (
    members.length === space.memberOrder.length &&
    members.every((member, index) => space.memberOrder[index] === member) &&
    slots.length === members.length &&
    layoutMembers.length === members.length &&
    members.every((member) => layoutMembers.includes(member))
  ) {
    return space;
  }

  const focusedMember = slots.find(
    (slot) => slot.id === space.focusedSlotId,
  )?.memberTabKey;
  const layout = adaptiveLayout(space, members);
  const nextSlots = collectLayoutSlots(layout);
  const focusedSlotId =
    nextSlots.find((slot) => slot.memberTabKey === focusedMember)?.id ??
    nextSlots.find((slot) => slot.memberTabKey !== null)?.id ??
    nextSlots[0]?.id ??
    null;
  return { ...space, memberOrder: members, layout, focusedSlotId };
}

export function addMemberToViewSpace(
  spaces: readonly ViewSpace[],
  targetSpaceId: ViewSpaceId,
  tabKey: TabKey,
  maxMembers = 4,
): SpaceOperationFailure | SpaceOperationSuccess {
  const target = spaces.find((space) => space.id === targetSpaceId);
  if (!target) return { ok: false, reason: "space-not-found", spaces };
  if (target.memberOrder.includes(tabKey)) {
    return { ok: true, spaces: [...spaces] };
  }
  if (target.memberOrder.length >= maxMembers) {
    return { ok: false, reason: "max-slots", spaces };
  }

  const removed = spaces.map((space) => withoutMember(space, tabKey));
  return {
    ok: true,
    spaces: removed.map((space, index) => {
      if (space.id !== targetSpaceId) {
        return space === spaces[index]
          ? space
          : rebalanceViewSpace(space, space.memberOrder);
      }
      const reopened = space.deleted
        ? (() => {
            const { deleted: _deleted, ...rest } = space;
            return rest;
          })()
        : space;
      return rebalanceViewSpace(
        reopened,
        [...reopened.memberOrder, tabKey],
        maxMembers,
      );
    }),
  };
}

export function assignMemberToSlot(
  spaces: readonly ViewSpace[],
  targetSpaceId: ViewSpaceId,
  targetSlotId: SlotId,
  tabKey: TabKey,
  maxMembers = 8,
): SpaceOperationFailure | SpaceOperationSuccess {
  const target = spaces.find((space) => space.id === targetSpaceId);
  if (!target) return { ok: false, reason: "space-not-found", spaces };
  const targetSlot = collectLayoutSlots(target.layout).find(
    (slot) => slot.id === targetSlotId,
  );
  if (!targetSlot) return { ok: false, reason: "slot-not-found", spaces };
  if (targetSlot.memberTabKey && targetSlot.memberTabKey !== tabKey) {
    return { ok: false, reason: "slot-occupied", spaces };
  }
  if (targetSlot.memberTabKey === tabKey) {
    return { ok: true, spaces: [...spaces] };
  }

  return addMemberToViewSpace(spaces, targetSpaceId, tabKey, maxMembers);
}

export function extractSpaceMember(
  spaces: readonly ViewSpace[],
  tabKey: TabKey,
): { spaces: ViewSpace[]; changed: boolean } {
  const next = spaces.map((space) => {
    const removed = withoutMember(space, tabKey);
    return removed === space
      ? space
      : rebalanceViewSpace(removed, removed.memberOrder);
  });
  return {
    spaces: next,
    changed: next.some((space, index) => space !== spaces[index]),
  };
}

export function closeSpaceMember(
  spaces: readonly ViewSpace[],
  tabKey: TabKey,
): { spaces: ViewSpace[]; changed: boolean } {
  return extractSpaceMember(spaces, tabKey);
}

export function swapSpaceSlots(
  space: ViewSpace,
  firstSlotId: SlotId,
  secondSlotId: SlotId,
): ViewSpace {
  if (firstSlotId === secondSlotId) return space;
  const slots = collectLayoutSlots(space.layout);
  const first = slots.find((slot) => slot.id === firstSlotId);
  const second = slots.find((slot) => slot.id === secondSlotId);
  if (!first || !second) return space;
  if (!first.memberTabKey || !second.memberTabKey) return space;
  const firstIndex = space.memberOrder.indexOf(first.memberTabKey);
  const secondIndex = space.memberOrder.indexOf(second.memberTabKey);
  if (firstIndex < 0 || secondIndex < 0) return space;
  const memberOrder = [...space.memberOrder];
  [memberOrder[firstIndex], memberOrder[secondIndex]] = [
    memberOrder[secondIndex],
    memberOrder[firstIndex],
  ];
  return rebalanceViewSpace(space, memberOrder);
}

export function splitSpaceSlot(
  spaces: readonly ViewSpace[],
  targetSpaceId: ViewSpaceId,
  targetSlotId: SlotId,
  direction: "row" | "column",
  side: "before" | "after",
  newSlotId: SlotId,
  memberTabKey: TabKey,
  maxSlots = 4,
): SpaceOperationFailure | SpaceOperationSuccess {
  void targetSlotId;
  void direction;
  void side;
  void newSlotId;
  return addMemberToViewSpace(spaces, targetSpaceId, memberTabKey, maxSlots);
}

export function deleteViewSpace(
  spaces: readonly ViewSpace[],
  spaceId: ViewSpaceId,
): { spaces: ViewSpace[]; releasedTabKeys: TabKey[] } {
  const deleted = spaces.find((space) => space.id === spaceId);
  if (!deleted) {
    return { spaces: [...spaces], releasedTabKeys: [] };
  }
  const slots = collectLayoutSlots(deleted.layout);
  const releasedTabKeys = [...deleted.memberOrder];
  for (const slot of slots) {
    if (
      slot.memberTabKey &&
      !releasedTabKeys.includes(slot.memberTabKey)
    ) {
      releasedTabKeys.push(slot.memberTabKey);
    }
  }
  return {
    spaces: spaces.filter((space) => space.id !== spaceId),
    releasedTabKeys,
  };
}
