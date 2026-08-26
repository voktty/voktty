import type { TabKey } from "@/modules/tabs/lib/tabIdentity";

declare const viewSpaceIdBrand: unique symbol;
declare const slotIdBrand: unique symbol;

export type ViewSpaceId = string & { readonly [viewSpaceIdBrand]: true };
export type SlotId = string & { readonly [slotIdBrand]: true };

export type SpaceLayoutNode =
  | {
      kind: "split";
      id: string;
      direction: "row" | "column";
      ratio: number;
      first: SpaceLayoutNode;
      second: SpaceLayoutNode;
    }
  | {
      kind: "slot";
      id: SlotId;
      memberTabKey: TabKey | null;
    };

export type ViewSpace = {
  id: ViewSpaceId;
  name: string;
  color?: number;
  /** Legacy persisted tombstone. New deletions remove the visual definition. */
  deleted?: boolean;
  presentation: "composite" | "expanded";
  memberOrder: TabKey[];
  layout: SpaceLayoutNode;
  focusedSlotId: SlotId | null;
};

export type SpaceValidationIssueCode =
  | "duplicate-space-id"
  | "duplicate-layout-id"
  | "duplicate-member"
  | "duplicate-member-order"
  | "too-many-slots"
  | "invalid-ratio"
  | "cyclic-layout"
  | "unknown-member"
  | "unknown-focused-slot"
  | "member-order-mismatch";

export type SpaceValidationIssue = {
  code: SpaceValidationIssueCode;
  spaceId: ViewSpaceId;
  detail?: string;
};

export function asViewSpaceId(value: string): ViewSpaceId {
  return value as ViewSpaceId;
}

export function asSlotId(value: string): SlotId {
  return value as SlotId;
}

export function createSlot(
  id: SlotId,
  memberTabKey: TabKey | null = null,
): SpaceLayoutNode {
  return { kind: "slot", id, memberTabKey };
}

export function createSplit(
  id: string,
  direction: "row" | "column",
  ratio: number,
  first: SpaceLayoutNode,
  second: SpaceLayoutNode,
): SpaceLayoutNode {
  return { kind: "split", id, direction, ratio, first, second };
}

export function collectLayoutSlots(
  layout: SpaceLayoutNode,
): Array<Extract<SpaceLayoutNode, { kind: "slot" }>> {
  if (layout.kind === "slot") return [layout];
  return [
    ...collectLayoutSlots(layout.first),
    ...collectLayoutSlots(layout.second),
  ];
}

export function mapLayoutSlots(
  layout: SpaceLayoutNode,
  map: (
    slot: Extract<SpaceLayoutNode, { kind: "slot" }>,
  ) => Extract<SpaceLayoutNode, { kind: "slot" }>,
): SpaceLayoutNode {
  if (layout.kind === "slot") return map(layout);
  const first = mapLayoutSlots(layout.first, map);
  const second = mapLayoutSlots(layout.second, map);
  if (first === layout.first && second === layout.second) return layout;
  return { ...layout, first, second };
}

export function updateLayoutSplitRatio(
  layout: SpaceLayoutNode,
  splitId: string,
  ratio: number,
): SpaceLayoutNode {
  if (layout.kind === "slot") return layout;
  if (layout.id === splitId) {
    const nextRatio = Number.isFinite(ratio)
      ? Math.min(Math.max(ratio, 0.01), 0.99)
      : layout.ratio;
    return nextRatio === layout.ratio
      ? layout
      : { ...layout, ratio: nextRatio };
  }
  const first = updateLayoutSplitRatio(layout.first, splitId, ratio);
  const second = updateLayoutSplitRatio(layout.second, splitId, ratio);
  if (first === layout.first && second === layout.second) return layout;
  return { ...layout, first, second };
}

export function validateViewSpaces(
  spaces: readonly ViewSpace[],
  liveTabKeys?: ReadonlySet<TabKey>,
  maxSlots = 4,
): SpaceValidationIssue[] {
  const issues: SpaceValidationIssue[] = [];
  const seenSpaces = new Set<ViewSpaceId>();
  const seenMembers = new Set<TabKey>();

  for (const space of spaces) {
    if (seenSpaces.has(space.id)) {
      issues.push({ code: "duplicate-space-id", spaceId: space.id });
    }
    seenSpaces.add(space.id);

    const layoutIds = new Set<string>();
    const slotIds = new Set<SlotId>();
    const layoutMembers: TabKey[] = [];
    let slotCount = 0;

    const walk = (
      node: SpaceLayoutNode,
      ancestors: ReadonlySet<SpaceLayoutNode>,
    ): void => {
      if (ancestors.has(node)) {
        issues.push({ code: "cyclic-layout", spaceId: space.id });
        return;
      }
      if (layoutIds.has(node.id)) {
        issues.push({
          code: "duplicate-layout-id",
          spaceId: space.id,
          detail: node.id,
        });
      }
      layoutIds.add(node.id);

      if (node.kind === "slot") {
        slotCount += 1;
        slotIds.add(node.id);
        if (node.memberTabKey) layoutMembers.push(node.memberTabKey);
        return;
      }

      if (!Number.isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1) {
        issues.push({
          code: "invalid-ratio",
          spaceId: space.id,
          detail: node.id,
        });
      }
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(node);
      walk(node.first, nextAncestors);
      walk(node.second, nextAncestors);
    };

    walk(space.layout, new Set());

    if (slotCount > maxSlots) {
      issues.push({ code: "too-many-slots", spaceId: space.id });
    }
    if (space.focusedSlotId && !slotIds.has(space.focusedSlotId)) {
      issues.push({
        code: "unknown-focused-slot",
        spaceId: space.id,
        detail: space.focusedSlotId,
      });
    }

    const orderMembers = new Set<TabKey>();
    for (const member of space.memberOrder) {
      if (orderMembers.has(member)) {
        issues.push({
          code: "duplicate-member-order",
          spaceId: space.id,
          detail: member,
        });
      }
      orderMembers.add(member);
    }

    const layoutMemberSet = new Set(layoutMembers);
    if (
      layoutMembers.length !== layoutMemberSet.size ||
      layoutMemberSet.size !== orderMembers.size ||
      [...layoutMemberSet].some((member) => !orderMembers.has(member))
    ) {
      issues.push({ code: "member-order-mismatch", spaceId: space.id });
    }

    for (const member of layoutMembers) {
      if (seenMembers.has(member)) {
        issues.push({
          code: "duplicate-member",
          spaceId: space.id,
          detail: member,
        });
      }
      seenMembers.add(member);
      if (liveTabKeys && !liveTabKeys.has(member)) {
        issues.push({
          code: "unknown-member",
          spaceId: space.id,
          detail: member,
        });
      }
    }
  }

  return issues;
}
