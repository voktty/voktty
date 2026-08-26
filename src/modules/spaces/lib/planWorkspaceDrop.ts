import type { TabKey } from "@/modules/tabs/lib/tabIdentity";
import {
  collectLayoutSlots,
  type SlotId,
  type ViewSpace,
  type ViewSpaceId,
} from "./spaceLayout";
import {
  MAX_VISIBLE_TERMINAL_LEAVES,
  tabAssignmentPaneBudget,
  type PaneBudgetTab,
} from "./spacePaneBudget";
import type { WorkspaceDragSource, WorkspaceDropTarget } from "./workspaceDrag";

export type WorkspaceDropReason =
  | "missing-space"
  | "missing-slot"
  | "slot-occupied"
  | "same-target"
  | "same-space"
  | "max-slots"
  | "renderer-capacity"
  | "source-not-tab"
  | "source-already-loose"
  | "resource-requires-view";

export type WorkspaceDropPlan =
  | {
      accepted: true;
      operation: "assign";
      source: Extract<WorkspaceDragSource, { tabId: number }>;
      viewSpaceId: ViewSpaceId;
      slotId: SlotId;
    }
  | {
      accepted: true;
      operation: "swap";
      source: Extract<WorkspaceDragSource, { tabId: number }>;
      viewSpaceId: ViewSpaceId;
      sourceSlotId: SlotId;
      targetSlotId: SlotId;
    }
  | {
      accepted: true;
      operation: "append";
      source: Extract<WorkspaceDragSource, { tabId: number }>;
      viewSpaceId: ViewSpaceId;
    }
  | {
      accepted: true;
      operation: "extract";
      source: Extract<WorkspaceDragSource, { tabId: number }>;
    }
  | {
      accepted: true;
      operation: "new-space";
      source: Extract<WorkspaceDragSource, { tabId: number }>;
    }
  | {
      accepted: true;
      operation: "reference-resource";
      source: Extract<WorkspaceDragSource, { kind: "file" | "directory" }>;
      viewSpaceId: ViewSpaceId;
      slotId: SlotId;
    }
  | {
      accepted: false;
      reason: WorkspaceDropReason;
    };

type Input = {
  source: WorkspaceDragSource;
  target: WorkspaceDropTarget;
  viewSpaces: readonly ViewSpace[];
  tabs?: readonly PaneBudgetTab[];
  maxVisiblePanes?: number;
  maxSlots?: number;
};

function tabSource(
  source: WorkspaceDragSource,
): Extract<WorkspaceDragSource, { tabId: number }> | null {
  return "tabId" in source ? source : null;
}

function resourceSource(
  source: WorkspaceDragSource,
): Extract<WorkspaceDragSource, { kind: "file" | "directory" }> | null {
  return source.kind === "file" || source.kind === "directory" ? source : null;
}

function invalid(reason: WorkspaceDropReason): WorkspaceDropPlan {
  return { accepted: false, reason };
}

export function planWorkspaceDrop({
  source,
  target,
  viewSpaces,
  tabs = [],
  maxVisiblePanes = MAX_VISIBLE_TERMINAL_LEAVES,
  maxSlots = 4,
}: Input): WorkspaceDropPlan {
  const tab = tabSource(source);
  const resource = resourceSource(source);
  if (target.kind === "loose-strip") {
    if (resource) return invalid("resource-requires-view");
    return tab
      ? tab.kind === "space-member"
        ? { accepted: true, operation: "extract", source: tab }
        : invalid("source-already-loose")
      : invalid("source-not-tab");
  }
  if (target.kind === "new-space") {
    if (resource) return invalid("resource-requires-view");
    return tab
      ? { accepted: true, operation: "new-space", source: tab }
      : invalid("source-not-tab");
  }
  if (!tab && !resource) return invalid("source-not-tab");

  const targetSpace =
    target.kind === "space"
      ? viewSpaces.find((space) => space.id === target.viewSpaceId)
      : viewSpaces.find((space) => space.id === target.viewSpaceId);
  if (!targetSpace) return invalid("missing-space");

  const tabPaneBudget = tab
    ? tabAssignmentPaneBudget(
        tabs,
        targetSpace.memberOrder,
        tab.tabKey,
        maxVisiblePanes,
      )
    : null;
  const tabCapacityError = tabPaneBudget?.allowed
    ? null
    : tabPaneBudget
      ? invalid("renderer-capacity")
      : null;

  if (target.kind === "space") {
    if (resource) return invalid("resource-requires-view");
    if (!tab) return invalid("source-not-tab");
    if (tab.kind === "space-member" && tab.viewSpaceId === targetSpace.id) {
      return invalid("same-space");
    }
    const slot = collectLayoutSlots(targetSpace.layout).find(
      (candidate) => candidate.memberTabKey === null,
    );
    if (slot) {
      if (tabCapacityError) return tabCapacityError;
      return {
        accepted: true,
        operation: "assign",
        source: tab,
        viewSpaceId: targetSpace.id,
        slotId: slot.id,
      };
    }
    if (targetSpace.memberOrder.length >= maxSlots) {
      return invalid("max-slots");
    }
    if (tabCapacityError) return tabCapacityError;
    return {
      accepted: true,
      operation: "append",
      source: tab,
      viewSpaceId: targetSpace.id,
    };
  }

  const targetSlot = collectLayoutSlots(targetSpace.layout).find(
    (slot) => slot.id === target.slotId,
  );
  if (!targetSlot) return invalid("missing-slot");

  if (targetSlot.memberTabKey === null) {
    if (resource) return invalid("resource-requires-view");
    if (!tab) return invalid("source-not-tab");
    if (tabCapacityError) return tabCapacityError;
    return {
      accepted: true,
      operation: "assign",
      source: tab,
      viewSpaceId: target.viewSpaceId,
      slotId: target.slotId,
    };
  }
  if (resource) {
    return {
      accepted: true,
      operation: "reference-resource",
      source: resource,
      viewSpaceId: targetSpace.id,
      slotId: target.slotId,
    };
  }
  if (!tab) return invalid("slot-occupied");
  if (targetSlot.memberTabKey === tab.tabKey) return invalid("same-target");
  if (
    tab.kind === "space-member" &&
    tab.viewSpaceId === target.viewSpaceId &&
    tab.slotId &&
    collectLayoutSlots(targetSpace.layout).some(
      (slot) => slot.id === tab.slotId && slot.memberTabKey === tab.tabKey,
    )
  ) {
    return {
      accepted: true,
      operation: "swap",
      source: tab,
      viewSpaceId: target.viewSpaceId,
      sourceSlotId: tab.slotId,
      targetSlotId: target.slotId,
    };
  }
  if (tab.kind === "space-member" && tab.viewSpaceId === target.viewSpaceId) {
    return invalid("same-space");
  }
  if (targetSpace.memberOrder.length >= maxSlots) {
    return invalid("max-slots");
  }
  if (tabCapacityError) return tabCapacityError;
  return {
    accepted: true,
    operation: "append",
    source: tab,
    viewSpaceId: targetSpace.id,
  };
}

export function slotIdForTab(
  viewSpace: ViewSpace,
  tabKey: TabKey,
): SlotId | null {
  return (
    collectLayoutSlots(viewSpace.layout).find(
      (slot) => slot.memberTabKey === tabKey,
    )?.id ?? null
  );
}
