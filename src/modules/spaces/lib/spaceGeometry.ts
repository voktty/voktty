import type { TabKey } from "@/modules/tabs/lib/tabIdentity";
import type { SlotId, SpaceLayoutNode } from "./spaceLayout";

export type WorkspaceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SpaceSlotPlacement = {
  slotId: SlotId;
  memberTabKey: TabKey | null;
  rect: WorkspaceRect;
  focused: boolean;
};

export type WorkspacePlacement = {
  tabId: number;
  slotId: SlotId;
  rect: WorkspaceRect;
  focused: boolean;
};

export type SpaceSplitHandlePlacement = {
  splitId: string;
  direction: "row" | "column";
  rect: WorkspaceRect;
};

export type SpaceGeometry = {
  slots: SpaceSlotPlacement[];
  handles: SpaceSplitHandlePlacement[];
};

export type SpaceGeometryOptions = {
  minSlotSize?: number;
};

const DEFAULT_MIN_SLOT_SIZE = 0.12;

const ROOT_RECT: WorkspaceRect = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function splitRect(
  rect: WorkspaceRect,
  direction: "row" | "column",
  ratio: number,
  minSlotSize: number,
): [WorkspaceRect, WorkspaceRect, WorkspaceRect] {
  const axis = direction === "row" ? rect.width : rect.height;
  const safeAxis = Math.max(axis, Number.EPSILON);
  const minRatio = Math.min(0.5, minSlotSize / safeAxis);
  const safeRatio = clamp(
    Number.isFinite(ratio) ? ratio : 0.5,
    minRatio,
    1 - minRatio,
  );

  if (direction === "row") {
    const firstWidth = rect.width * safeRatio;
    const first: WorkspaceRect = { ...rect, width: firstWidth };
    const second: WorkspaceRect = {
      x: rect.x + firstWidth,
      y: rect.y,
      width: rect.width - firstWidth,
      height: rect.height,
    };
    const handle: WorkspaceRect = {
      x: second.x,
      y: rect.y,
      width: 0,
      height: rect.height,
    };
    return [first, second, handle];
  }

  const firstHeight = rect.height * safeRatio;
  const first: WorkspaceRect = { ...rect, height: firstHeight };
  const second: WorkspaceRect = {
    x: rect.x,
    y: rect.y + firstHeight,
    width: rect.width,
    height: rect.height - firstHeight,
  };
  const handle: WorkspaceRect = {
    x: rect.x,
    y: second.y,
    width: rect.width,
    height: 0,
  };
  return [first, second, handle];
}

export function calculateSpaceGeometry(
  layout: SpaceLayoutNode,
  focusedSlotId: SlotId | null,
  options: SpaceGeometryOptions = {},
): SpaceGeometry {
  const minSlotSize = clamp(
    options.minSlotSize ?? DEFAULT_MIN_SLOT_SIZE,
    0,
    0.49,
  );
  const slots: SpaceSlotPlacement[] = [];
  const handles: SpaceSplitHandlePlacement[] = [];

  const visit = (node: SpaceLayoutNode, rect: WorkspaceRect): void => {
    if (node.kind === "slot") {
      slots.push({
        slotId: node.id,
        memberTabKey: node.memberTabKey,
        rect,
        focused: node.id === focusedSlotId,
      });
      return;
    }

    const [first, second, handle] = splitRect(
      rect,
      node.direction,
      node.ratio,
      minSlotSize,
    );
    handles.push({ splitId: node.id, direction: node.direction, rect: handle });
    visit(node.first, first);
    visit(node.second, second);
  };

  visit(layout, ROOT_RECT);
  return { slots, handles };
}

export function updateSpaceSplitRatio(
  layout: SpaceLayoutNode,
  splitId: string,
  pointer: number,
  bounds: WorkspaceRect,
  options: SpaceGeometryOptions = {},
): number | null {
  const minSlotSize = clamp(
    options.minSlotSize ?? DEFAULT_MIN_SLOT_SIZE,
    0,
    0.49,
  );
  const walk = (node: SpaceLayoutNode, rect: WorkspaceRect): number | null => {
    if (node.kind === "slot") return null;
    if (node.id === splitId) {
      const axisStart = node.direction === "row" ? rect.x : rect.y;
      const axisSize = node.direction === "row" ? rect.width : rect.height;
      const boundsStart = node.direction === "row" ? bounds.x : bounds.y;
      const boundsSize =
        node.direction === "row" ? bounds.width : bounds.height;
      const pointerInRoot =
        (pointer - boundsStart) / Math.max(boundsSize, Number.EPSILON);
      const normalized =
        (pointerInRoot - axisStart) / Math.max(axisSize, Number.EPSILON);
      const minRatio = Math.min(
        0.5,
        minSlotSize / Math.max(axisSize, Number.EPSILON),
      );
      return clamp(normalized, minRatio, 1 - minRatio);
    }

    const [first, second] = splitRect(
      rect,
      node.direction,
      node.ratio,
      minSlotSize,
    );
    return walk(node.first, first) ?? walk(node.second, second);
  };

  return walk(layout, ROOT_RECT);
}
