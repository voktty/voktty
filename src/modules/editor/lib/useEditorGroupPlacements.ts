import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceRect } from "@/modules/spaces/lib/spaceGeometry";
import {
  editorGroupLeaves,
  type EditorGroupNode,
} from "@/modules/editor/lib/editorGroupLayout";
import { editorGroupRect } from "@/modules/editor/lib/editorGroupRect";

const FULL_RECT: WorkspaceRect = { x: 0, y: 0, width: 1, height: 1 };
const EMPTY = new Map<number, WorkspaceRect>();

export function useEditorGroupPlacements(
  tree: EditorGroupNode | undefined,
  enabled: boolean,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef(new Map<number, HTMLDivElement>());
  const [measured, setMeasured] = useState<{
    tree: EditorGroupNode;
    rects: Map<number, WorkspaceRect>;
  } | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !tree || tree.kind === "leaf") return;
    const root = rootRef.current;
    if (!root) return;
    let current = true;
    let frame: number | null = null;
    const slots = editorGroupLeaves(tree).flatMap(({ groupId }) => {
      const node = groupRefs.current.get(groupId);
      return node ? [{ groupId, node }] : [];
    });
    const measure = () => {
      frame = null;
      if (!current) return;
      const bounds = root.getBoundingClientRect();
      const rects = new Map<number, WorkspaceRect>();
      for (const { groupId, node } of slots) {
        const rect = editorGroupRect(bounds, node.getBoundingClientRect());
        if (rect) rects.set(groupId, rect);
      }
      setMeasured((previous) => {
        if (!current) return previous;
        if (
          previous?.tree === tree &&
          previous.rects.size === rects.size &&
          [...rects].every(([id, rect]) => {
            const old = previous.rects.get(id);
            return (
              old &&
              old.x === rect.x &&
              old.y === rect.y &&
              old.width === rect.width &&
              old.height === rect.height
            );
          })
        )
          return previous;
        return { tree, rects };
      });
    };
    const schedule = () => {
      if (current && frame === null) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(root);
    for (const { node } of slots) observer?.observe(node);
    if (!observer) window.addEventListener("resize", schedule);
    return () => {
      current = false;
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, tree]);
  const rects = useMemo(() => {
    if (!enabled || !tree) return EMPTY;
    if (tree.kind === "leaf") return new Map([[tree.groupId, FULL_RECT]]);
    return measured?.tree === tree ? measured.rects : EMPTY;
  }, [enabled, tree, measured]);
  return { rootRef, groupRefs, rects };
}
