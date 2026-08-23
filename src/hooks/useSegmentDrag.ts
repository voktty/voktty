import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { setGrabbing, suppressTextSelection } from "../lib/drag";

const THRESHOLD = 5;

export function useSegmentDrag(
  segmentCount: number,
  onMove: (fromIndex: number, toIndex: number) => void,
) {
  const countRef = useRef(segmentCount);
  countRef.current = segmentCount;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const nodes = useRef(new Map<number, HTMLElement>());
  const drag = useRef<{
    fromIndex: number;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    toIndex: number;
  } | null>(null);
  const suppressClickUntil = useRef(0);

  const [draggingFromIndex, setDraggingFromIndex] = useState<number | null>(
    null,
  );
  const [toIndex, setToIndex] = useState<number | null>(null);

  const setSegmentRef = useCallback((index: number, el: HTMLElement | null) => {
    if (el) nodes.current.set(index, el);
    else nodes.current.delete(index);
  }, []);

  const indexAt = useCallback((x: number) => {
    const count = countRef.current;
    let next = count - 1;
    for (let i = 0; i < count; i++) {
      const rect = nodes.current.get(i)?.getBoundingClientRect();
      if (!rect) continue;
      const mid = rect.left + rect.width / 2;
      if (x < mid) {
        next = i;
        break;
      }
    }
    return next;
  }, []);

  const onSegmentPointerDown = useCallback(
    (fromIndex: number, event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      if (countRef.current < 2) return;
      if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
        return;
      }
      const handle = event.currentTarget as HTMLElement;

      const state = {
        fromIndex,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        toIndex: fromIndex,
      };
      drag.current = state;
      handle.setPointerCapture(event.pointerId);
      const restoreSelection = suppressTextSelection();

      const onMove = (ev: PointerEvent) => {
        const current = drag.current;
        if (!current || current.fromIndex !== fromIndex) return;
        if (!current.active) {
          if (
            Math.hypot(ev.clientX - current.startX, ev.clientY - current.startY) <
            THRESHOLD
          ) {
            return;
          }
          current.active = true;
          setGrabbing(true);
          setDraggingFromIndex(fromIndex);
          setToIndex(fromIndex);
        }
        const next = indexAt(ev.clientX);
        if (next === current.toIndex) return;
        current.toIndex = next;
        setToIndex(next);
      };

      const onUp = () => stop(true);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          stop(false);
        }
      };

      function stop(commit: boolean) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("keydown", onKey);
        const current = drag.current;
        drag.current = null;
        restoreSelection();
        setGrabbing(false);
        setDraggingFromIndex(null);
        setToIndex(null);
        try {
          handle.releasePointerCapture(state.pointerId);
        } catch {
          /* already released */
        }
        if (!current?.active) return;
        if (!commit) return;
        suppressClickUntil.current = performance.now() + 400;
        if (current.toIndex !== current.fromIndex) {
          onMoveRef.current(current.fromIndex, current.toIndex);
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("keydown", onKey);
    },
    [indexAt],
  );

  const consumeClick = useCallback(
    () => performance.now() < suppressClickUntil.current,
    [],
  );

  return {
    draggingFromIndex,
    toIndex: draggingFromIndex != null ? toIndex : null,
    setSegmentRef,
    onSegmentPointerDown,
    consumeClick,
  };
}
