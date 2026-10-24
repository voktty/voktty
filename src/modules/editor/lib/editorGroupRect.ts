import type { WorkspaceRect } from "@/modules/spaces/lib/spaceGeometry";

type Bounds = { left: number; top: number; width: number; height: number };

export function editorGroupRect(
  root: Bounds,
  slot: Bounds,
): WorkspaceRect | null {
  if (
    ![
      root.left,
      root.top,
      root.width,
      root.height,
      slot.left,
      slot.top,
      slot.width,
      slot.height,
    ].every(Number.isFinite) ||
    root.width <= 0 ||
    root.height <= 0 ||
    slot.width <= 0 ||
    slot.height <= 0
  )
    return null;
  const left = Math.max(0, slot.left - root.left);
  const top = Math.max(0, slot.top - root.top);
  const right = Math.min(root.width, slot.left - root.left + slot.width);
  const bottom = Math.min(root.height, slot.top - root.top + slot.height);
  if (right <= left || bottom <= top) return null;
  return {
    x: left / root.width,
    y: top / root.height,
    width: (right - left) / root.width,
    height: (bottom - top) / root.height,
  };
}
