import { usePreferencesStore } from "@/modules/settings/preferences";
import { asTabKey, type TabKey } from "@/modules/tabs/lib/tabIdentity";
import { parseWorkspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";
import { create } from "zustand";
import {
  collectLayoutSlots,
  type SlotId,
  updateLayoutSplitRatio,
  type ViewSpace,
  type ViewSpaceId,
} from "./spaceLayout";
import {
  addMemberToViewSpace as addMemberToViewSpaceModel,
  assignMemberToSlot as assignMemberToSlotModel,
  createViewSpace as createViewSpaceModel,
  deleteViewSpace as deleteViewSpaceModel,
  expandViewSpace as expandViewSpaceModel,
  extractSpaceMember,
  focusViewSpaceSlot as focusViewSpaceSlotModel,
  nextOccupiedSlotId,
  openViewSpace as openViewSpaceModel,
  rebalanceViewSpace,
  repairFocusedSlot,
  splitSpaceSlot as splitSpaceSlotModel,
  swapSpaceSlots,
} from "./spaceOperations";
import type { ActiveStripItem, StripEntry } from "./spaceProjection";
import { newSpaceId, type SpaceMeta } from "./store";

type CreateInput = {
  id?: string;
  name: string;
  root: string | null;
  env?: WorkspaceEnv;
};

type State = {
  spaces: SpaceMeta[];
  activeId: string | null;
  hydrated: boolean;
  viewSpaces: ViewSpace[];
  stripEntries: StripEntry[];
  activeStripItem: ActiveStripItem | null;
  // Per-space active tab index loaded from disk, so persistence preserves it
  // for spaces the user never visits this session.
  initialActiveIndex: Record<string, number>;
  hydrate: (
    spaces: SpaceMeta[],
    activeId: string | null,
    initialActiveIndex?: Record<string, number>,
    projection?: {
      viewSpaces: ViewSpace[];
      stripEntries: StripEntry[];
      activeStripItem: ActiveStripItem | null;
    },
  ) => void;
  setSessionProjection: (
    viewSpaces: ViewSpace[],
    stripEntries: StripEntry[],
    activeStripItem: ActiveStripItem | null,
  ) => void;
  ensureViewSpace: (input: {
    workspaceId: string;
    name: string;
    color?: number;
    initialMember?: string | null;
  }) => ViewSpaceId;
  openViewSpace: (id: string) => TabKey | null;
  expandViewSpace: (id: string) => void;
  focusViewSpaceSlot: (id: string, slotId: string) => void;
  focusNextViewSpaceSlot: (id: string, delta: 1 | -1) => TabKey | null;
  reorderViewSpaceMembers: (id: string, memberOrder: string[]) => void;
  reorderStandaloneTabByGap: (
    tabKey: string,
    toGapIndex: number,
    visibleTabKeys: string[],
  ) => void;
  resizeViewSpaceSplit: (id: string, splitId: string, ratio: number) => void;
  assignMemberToSlot: (id: string, slotId: string, tabKey: string) => boolean;
  addMemberToViewSpace: (
    id: string,
    tabKey: string,
    maxMembers?: number,
  ) => boolean;
  extractMemberFromViewSpace: (tabKey: string) => boolean;
  moveMemberToViewSpace: (id: string, tabKey: string) => boolean;
  splitViewSpaceSlot: (input: {
    viewSpaceId: string;
    slotId: string;
    direction: "row" | "column";
    side: "before" | "after";
    newSlotId: string;
    tabKey: string;
  }) => boolean;
  swapViewSpaceSlots: (
    viewSpaceId: string,
    firstSlotId: string,
    secondSlotId: string,
  ) => boolean;
  deleteViewSpace: (id: string) => TabKey[];
  focusVisualMember: (tabKey: string) => void;
  ensureStandaloneTab: (tabKey: string) => void;
  reconcileLiveTabs: (
    tabKeys: string[],
    activeTabKey: string | null,
    maxMembers?: number,
  ) => void;
  create: (input: CreateInput) => SpaceMeta;
  rename: (id: string, name: string) => void;
  setRoot: (id: string, root: string | null) => void;
  setEnv: (id: string, env: WorkspaceEnv) => void;
  setColor: (id: string, color: number | undefined) => void;
  reorder: (orderedIds: string[]) => void;
  remove: (id: string) => string | null;
  setActive: (id: string) => void;
};

export const useSpaces = create<State>((set, get) => ({
  spaces: [],
  activeId: null,
  hydrated: false,
  viewSpaces: [],
  stripEntries: [],
  activeStripItem: null,
  initialActiveIndex: {},

  hydrate: (spaces, activeId, initialActiveIndex = {}, projection) => {
    set({
      spaces,
      activeId,
      initialActiveIndex,
      ...(projection
        ? {
            viewSpaces: projection.viewSpaces,
            stripEntries: projection.stripEntries,
            activeStripItem: projection.activeStripItem,
          }
        : {}),
      hydrated: true,
    });
  },

  setSessionProjection: (viewSpaces, stripEntries, activeStripItem) => {
    set({ viewSpaces, stripEntries, activeStripItem });
  },

  ensureViewSpace: ({ workspaceId, name, color, initialMember }) => {
    const id = `view-${workspaceId}` as ViewSpaceId;
    const existing = get().viewSpaces.find((space) => space.id === id);
    if (existing) return id;
    const slotId = `slot-${workspaceId}` as SlotId;
    const created = createViewSpaceModel({
      id,
      name,
      color,
      initialSlotId: slotId,
      initialMember: initialMember ? asTabKey(initialMember) : null,
    });
    const initialKey = initialMember ? asTabKey(initialMember) : null;
    const stripEntries = get().stripEntries.filter(
      (entry) => entry.kind !== "standalone" || entry.tabKey !== initialKey,
    );
    if (
      !stripEntries.some(
        (entry) => entry.kind === "space" && entry.spaceId === id,
      )
    ) {
      stripEntries.push({ kind: "space", spaceId: id });
    }
    set({
      viewSpaces: [...get().viewSpaces, created],
      stripEntries,
    });
    return id;
  },

  openViewSpace: (id) => {
    const space = get().viewSpaces.find((candidate) => candidate.id === id);
    if (!space) return null;

    const nextSpace = openViewSpaceModel(space);
    const focusedSlot = nextSpace.focusedSlotId
      ? collectLayoutSlots(nextSpace.layout).find(
          (slot) => slot.id === nextSpace.focusedSlotId,
        )
      : undefined;
    const focusedMember = focusedSlot?.memberTabKey ?? null;
    const viewSpaces = get().viewSpaces.map((candidate) =>
      candidate.id === id ? nextSpace : candidate,
    );
    const stripEntries = get().stripEntries.some(
      (entry) => entry.kind === "space" && entry.spaceId === id,
    )
      ? get().stripEntries
      : [
          ...get().stripEntries,
          { kind: "space" as const, spaceId: nextSpace.id },
        ];
    set({
      viewSpaces,
      stripEntries,
      activeStripItem: {
        kind: "space",
        spaceId: nextSpace.id,
        focusedSlotId: nextSpace.focusedSlotId,
      },
    });
    return focusedMember;
  },

  expandViewSpace: (id) => {
    const space = get().viewSpaces.find((candidate) => candidate.id === id);
    if (!space) return;

    const focusedMember = space.focusedSlotId
      ? (collectLayoutSlots(space.layout).find(
          (slot) => slot.id === space.focusedSlotId,
        )?.memberTabKey ?? null)
      : null;
    const nextSpace = expandViewSpaceModel(space);
    const currentActiveStripItem = get().activeStripItem;
    const ownsActiveSpace =
      currentActiveStripItem?.kind === "space" &&
      currentActiveStripItem.spaceId === space.id;
    const activeStripItem = ownsActiveSpace
      ? focusedMember
        ? { kind: "tab" as const, tabKey: focusedMember }
        : null
      : currentActiveStripItem;
    set({
      viewSpaces: get().viewSpaces.map((candidate) =>
        candidate.id === id ? nextSpace : candidate,
      ),
      activeStripItem,
    });
  },

  focusViewSpaceSlot: (id, slotId) => {
    const space = get().viewSpaces.find((candidate) => candidate.id === id);
    if (!space) return;
    const nextSpace = focusViewSpaceSlotModel(space, slotId as SlotId);
    if (nextSpace === space) return;
    const focusedMember = collectLayoutSlots(nextSpace.layout).find(
      (slot) => slot.id === nextSpace.focusedSlotId,
    )?.memberTabKey;
    set({
      viewSpaces: get().viewSpaces.map((candidate) =>
        candidate.id === id ? nextSpace : candidate,
      ),
      activeStripItem:
        nextSpace.presentation === "composite"
          ? {
              kind: "space",
              spaceId: nextSpace.id,
              focusedSlotId: nextSpace.focusedSlotId,
            }
          : focusedMember
            ? { kind: "tab", tabKey: focusedMember }
            : get().activeStripItem,
    });
  },

  focusNextViewSpaceSlot: (id, delta) => {
    const space = get().viewSpaces.find((candidate) => candidate.id === id);
    if (!space) return null;
    const nextSlotId = nextOccupiedSlotId(space, delta);
    if (!nextSlotId) return null;
    const nextSpace = focusViewSpaceSlotModel(space, nextSlotId);
    const member = collectLayoutSlots(nextSpace.layout).find(
      (slot) => slot.id === nextSlotId,
    )?.memberTabKey;
    if (!member) return null;
    set({
      viewSpaces: get().viewSpaces.map((candidate) =>
        candidate.id === id ? nextSpace : candidate,
      ),
      activeStripItem:
        nextSpace.presentation === "composite"
          ? {
              kind: "space",
              spaceId: nextSpace.id,
              focusedSlotId: nextSpace.focusedSlotId,
            }
          : { kind: "tab", tabKey: member },
    });
    return member;
  },

  reorderViewSpaceMembers: (id, memberOrder) => {
    const space = get().viewSpaces.find((candidate) => candidate.id === id);
    if (!space) return;
    const requested = new Set(memberOrder.map(asTabKey));
    const nextOrder: TabKey[] = [];
    for (const member of memberOrder.map(asTabKey)) {
      if (space.memberOrder.includes(member) && !nextOrder.includes(member)) {
        nextOrder.push(member);
      }
    }
    for (const member of space.memberOrder) {
      if (!requested.has(member)) nextOrder.push(member);
    }
    if (
      nextOrder.length === space.memberOrder.length &&
      nextOrder.every((member, index) => member === space.memberOrder[index])
    ) {
      return;
    }
    set({
      viewSpaces: get().viewSpaces.map((candidate) =>
        candidate.id === id
          ? rebalanceViewSpace(candidate, nextOrder)
          : candidate,
      ),
    });
  },

  reorderStandaloneTabByGap: (tabKey, toGapIndex, visibleTabKeys) => {
    const key = asTabKey(tabKey);
    const stripEntries = get().stripEntries;
    const standalone = new Set(
      stripEntries.flatMap((entry) =>
        entry.kind === "standalone" ? [entry.tabKey] : [],
      ),
    );
    if (!standalone.has(key)) return;

    const visible = visibleTabKeys
      .map(asTabKey)
      .filter(
        (candidate, index, keys) =>
          standalone.has(candidate) && keys.indexOf(candidate) === index,
      );
    const fromIndex = visible.indexOf(key);
    if (fromIndex === -1) return;

    const boundedGap = Math.max(0, Math.min(toGapIndex, visibleTabKeys.length));
    const targetGap = visibleTabKeys
      .slice(0, boundedGap)
      .map(asTabKey)
      .filter((candidate) => standalone.has(candidate)).length;
    const nextVisible = [...visible];
    nextVisible.splice(fromIndex, 1);
    const insertIndex = Math.max(
      0,
      Math.min(
        targetGap > fromIndex ? targetGap - 1 : targetGap,
        nextVisible.length,
      ),
    );
    nextVisible.splice(insertIndex, 0, key);
    if (nextVisible.every((candidate, index) => candidate === visible[index])) {
      return;
    }

    const reordered = [...nextVisible];
    const visibleSet = new Set(visible);
    set({
      stripEntries: stripEntries.map((entry) =>
        entry.kind === "standalone" && visibleSet.has(entry.tabKey)
          ? { ...entry, tabKey: reordered.shift() ?? entry.tabKey }
          : entry,
      ),
    });
  },

  resizeViewSpaceSplit: (id, splitId, ratio) => {
    const space = get().viewSpaces.find((candidate) => candidate.id === id);
    if (!space) return;
    const layout = updateLayoutSplitRatio(space.layout, splitId, ratio);
    if (layout === space.layout) return;
    set({
      viewSpaces: get().viewSpaces.map((candidate) =>
        candidate.id === id ? { ...candidate, layout } : candidate,
      ),
    });
  },

  assignMemberToSlot: (id, slotId, tabKey) => {
    const targetWasDeleted = get().viewSpaces.some(
      (space) => space.id === id && space.deleted,
    );
    const result = assignMemberToSlotModel(
      get().viewSpaces,
      id as ViewSpaceId,
      slotId as SlotId,
      asTabKey(tabKey),
    );
    if (!result.ok) return false;
    const stripEntries = targetWasDeleted
      ? get().stripEntries.some(
          (entry) => entry.kind === "space" && entry.spaceId === id,
        )
        ? get().stripEntries
        : [
            ...get().stripEntries,
            { kind: "space" as const, spaceId: id as ViewSpaceId },
          ]
      : get().stripEntries;
    set({ viewSpaces: result.spaces, stripEntries });
    return true;
  },

  addMemberToViewSpace: (id, tabKey, maxMembers = 4) => {
    const key = asTabKey(tabKey);
    const result = addMemberToViewSpaceModel(
      get().viewSpaces,
      id as ViewSpaceId,
      key,
      maxMembers,
    );
    if (!result.ok) return false;
    const spaceEntry = { kind: "space" as const, spaceId: id as ViewSpaceId };
    const stripEntries = get().stripEntries.filter(
      (entry) => !(entry.kind === "standalone" && entry.tabKey === key),
    );
    if (
      !stripEntries.some(
        (entry) => entry.kind === "space" && entry.spaceId === id,
      )
    ) {
      stripEntries.push(spaceEntry);
    }
    set({ viewSpaces: result.spaces, stripEntries });
    return true;
  },

  extractMemberFromViewSpace: (tabKey) => {
    const key = asTabKey(tabKey);
    const ownerId = get().viewSpaces.find((space) =>
      space.memberOrder.includes(key),
    )?.id;
    const result = extractSpaceMember(get().viewSpaces, key);
    if (!result.changed) return false;
    const active = get().activeStripItem;
    const activeOwnsMember =
      active?.kind === "space" && ownerId === active.spaceId;
    const stripEntries = [...get().stripEntries];
    if (
      !stripEntries.some(
        (entry) => entry.kind === "standalone" && entry.tabKey === key,
      )
    ) {
      const ownerIndex = stripEntries.findIndex(
        (entry) => entry.kind === "space" && entry.spaceId === ownerId,
      );
      stripEntries.splice(
        ownerIndex === -1 ? stripEntries.length : ownerIndex + 1,
        0,
        {
          kind: "standalone",
          tabKey: key,
        },
      );
    }
    set({
      viewSpaces: result.spaces,
      stripEntries,
      activeStripItem: activeOwnsMember ? { kind: "tab", tabKey: key } : active,
    });
    return true;
  },

  moveMemberToViewSpace: (id, tabKey) => {
    return get().addMemberToViewSpace(id, tabKey);
  },

  splitViewSpaceSlot: ({
    viewSpaceId,
    slotId,
    direction,
    side,
    newSlotId,
    tabKey,
  }) => {
    const result = splitSpaceSlotModel(
      get().viewSpaces,
      viewSpaceId as ViewSpaceId,
      slotId as SlotId,
      direction,
      side,
      newSlotId as SlotId,
      asTabKey(tabKey),
    );
    if (!result.ok) return false;
    const stripEntries = get().stripEntries.filter(
      (entry) => !(entry.kind === "standalone" && entry.tabKey === tabKey),
    );
    set({ viewSpaces: result.spaces, stripEntries });
    return true;
  },

  swapViewSpaceSlots: (viewSpaceId, firstSlotId, secondSlotId) => {
    const space = get().viewSpaces.find(
      (candidate) => candidate.id === viewSpaceId,
    );
    if (!space) return false;
    const next = swapSpaceSlots(
      space,
      firstSlotId as SlotId,
      secondSlotId as SlotId,
    );
    if (next === space) return false;
    set({
      viewSpaces: get().viewSpaces.map((candidate) =>
        candidate.id === viewSpaceId ? next : candidate,
      ),
    });
    return true;
  },

  deleteViewSpace: (id) => {
    const deleted = get().viewSpaces.find((space) => space.id === id);
    const result = deleteViewSpaceModel(get().viewSpaces, id as ViewSpaceId);
    if (
      result.spaces.length === get().viewSpaces.length &&
      result.spaces.every((space, index) => space === get().viewSpaces[index])
    ) {
      return [];
    }
    const released = new Set(result.releasedTabKeys);
    const stripEntries: StripEntry[] = [];
    const inserted = new Set<TabKey>();
    for (const entry of get().stripEntries) {
      if (entry.kind === "space" && entry.spaceId === id) {
        for (const key of result.releasedTabKeys) {
          if (!inserted.has(key)) {
            stripEntries.push({ kind: "standalone", tabKey: key });
            inserted.add(key);
          }
        }
        continue;
      }
      if (entry.kind === "standalone" && released.has(entry.tabKey)) {
        if (inserted.has(entry.tabKey)) continue;
        inserted.add(entry.tabKey);
      }
      stripEntries.push(entry);
    }
    for (const key of result.releasedTabKeys) {
      if (!inserted.has(key)) {
        stripEntries.push({ kind: "standalone", tabKey: key });
        inserted.add(key);
      }
    }
    const active = get().activeStripItem;
    const focusedMember =
      deleted && active?.kind === "space" && active.spaceId === id
        ? collectLayoutSlots(deleted.layout).find(
            (slot) =>
              slot.id === (active.focusedSlotId ?? deleted.focusedSlotId),
          )?.memberTabKey
        : null;
    const fallbackTabKey = stripEntries.find(
      (entry): entry is Extract<StripEntry, { kind: "standalone" }> =>
        entry.kind === "standalone",
    )?.tabKey;
    const nextActiveTabKey =
      focusedMember ?? result.releasedTabKeys[0] ?? fallbackTabKey;
    set({
      viewSpaces: result.spaces,
      stripEntries,
      activeStripItem:
        active?.kind === "space" && active.spaceId === id
          ? nextActiveTabKey
            ? { kind: "tab", tabKey: nextActiveTabKey }
            : null
          : active,
    });
    return result.releasedTabKeys;
  },

  focusVisualMember: (tabKey) => {
    let activeStripItem: ActiveStripItem = {
      kind: "tab",
      tabKey: asTabKey(tabKey),
    };
    const viewSpaces = get().viewSpaces.map((space) => {
      const slot = collectLayoutSlots(space.layout).find(
        (candidate) => candidate.memberTabKey === tabKey,
      );
      if (!slot) return space;
      if (space.presentation === "composite") {
        activeStripItem = {
          kind: "space",
          spaceId: space.id,
          focusedSlotId: slot.id,
        };
      }
      return space.focusedSlotId === slot.id
        ? space
        : { ...space, focusedSlotId: slot.id };
    });
    set({ viewSpaces, activeStripItem });
  },

  ensureStandaloneTab: (tabKey) => {
    const key = asTabKey(tabKey);
    const state = get();
    if (
      state.viewSpaces.some((space) => space.memberOrder.includes(key)) ||
      state.stripEntries.some(
        (entry) => entry.kind === "standalone" && entry.tabKey === key,
      )
    ) {
      return;
    }
    set({
      stripEntries: [
        ...state.stripEntries,
        { kind: "standalone", tabKey: key },
      ],
      activeStripItem: { kind: "tab", tabKey: key },
    });
  },

  reconcileLiveTabs: (tabKeys, activeTabKey, maxMembers = 4) => {
    const live = new Set(tabKeys.map(asTabKey));
    const viewSpaces = get().viewSpaces.map((space) => {
      const members = space.memberOrder.filter((member) => live.has(member));
      return repairFocusedSlot(
        rebalanceViewSpace(space, members, maxMembers),
        space.focusedSlotId,
      );
    });
    const members = new Set(viewSpaces.flatMap((space) => space.memberOrder));
    const stripEntries = get().stripEntries.filter((entry) =>
      entry.kind === "space"
        ? viewSpaces.some(
            (space) => space.id === entry.spaceId && !space.deleted,
          )
        : live.has(entry.tabKey) && !members.has(entry.tabKey),
    );
    const represented = new Set(
      stripEntries.flatMap((entry) =>
        entry.kind === "standalone" ? [entry.tabKey] : [],
      ),
    );
    for (const tabKey of live) {
      if (!members.has(tabKey) && !represented.has(tabKey)) {
        stripEntries.push({ kind: "standalone", tabKey });
      }
    }
    let activeStripItem: ActiveStripItem | null = null;
    if (activeTabKey && live.has(asTabKey(activeTabKey))) {
      const key = asTabKey(activeTabKey);
      const owner = viewSpaces.find((space) => space.memberOrder.includes(key));
      if (owner?.presentation === "composite") {
        activeStripItem = {
          kind: "space",
          spaceId: owner.id,
          focusedSlotId:
            collectLayoutSlots(owner.layout).find(
              (slot) => slot.memberTabKey === key,
            )?.id ?? owner.focusedSlotId,
        };
      } else {
        activeStripItem = { kind: "tab", tabKey: key };
      }
    }
    set({ viewSpaces, stripEntries, activeStripItem });
  },

  create: (input) => {
    const now = Date.now();
    const meta: SpaceMeta = {
      id: input.id ?? newSpaceId(),
      name: input.name,
      root: input.root,
      env:
        input.env ??
        parseWorkspaceScopeKey(
          usePreferencesStore.getState().defaultWorkspaceEnv,
        ),
      createdAt: now,
      updatedAt: now,
    };
    const spaces = [...get().spaces, meta];
    set({ spaces });
    return meta;
  },

  rename: (id, name) => {
    const spaces = get().spaces.map((s) =>
      s.id === id ? { ...s, name, updatedAt: Date.now() } : s,
    );
    set({
      spaces,
      viewSpaces: get().viewSpaces.map((space) =>
        space.id === (`view-${id}` as ViewSpaceId) ? { ...space, name } : space,
      ),
    });
  },

  setRoot: (id, root) => {
    const spaces = get().spaces.map((s) =>
      s.id === id ? { ...s, root, updatedAt: Date.now() } : s,
    );
    set({ spaces });
  },

  setEnv: (id, env) => {
    const spaces = get().spaces.map((s) =>
      s.id === id ? { ...s, env, updatedAt: Date.now() } : s,
    );
    set({ spaces });
  },

  setColor: (id, color) => {
    const spaces = get().spaces.map((s) =>
      s.id === id ? { ...s, color, updatedAt: Date.now() } : s,
    );
    set({
      spaces,
      viewSpaces: get().viewSpaces.map((space) =>
        space.id === (`view-${id}` as ViewSpaceId)
          ? { ...space, color }
          : space,
      ),
    });
  },

  reorder: (orderedIds) => {
    const byId = new Map(get().spaces.map((s) => [s.id, s]));
    const next: SpaceMeta[] = [];
    for (const id of orderedIds) {
      const s = byId.get(id);
      if (s) next.push(s);
    }
    for (const s of get().spaces) {
      if (!next.includes(s)) next.push(s);
    }
    if (next.length !== get().spaces.length) return;
    set({ spaces: next });
  },

  remove: (id) => {
    const prev = get();
    const spaces = prev.spaces.filter((s) => s.id !== id);
    let activeId = prev.activeId;
    if (activeId === id) activeId = spaces[0]?.id ?? null;
    set({ spaces, activeId });
    return activeId;
  },

  setActive: (id) => {
    if (get().activeId === id) return;
    set({ activeId: id });
  },
}));
