import { useCallback, useEffect, useRef } from "react";
import {
  applyDrag,
  applyResize,
  BADGE_MARGIN,
  BADGE_SIZE,
  type BadgePos,
  clampBadgePos,
  clampGeom,
  defaultGeom,
  type Geom,
  type ResizeDir,
  type Viewport,
} from "./miniWindowGeometry";

export { BADGE_MARGIN, BADGE_SIZE, type BadgePos, clampBadgePos };

export const STORE_KEY = "voktty-ui-mini-window-geom";
export const BADGE_STORE_KEY = "voktty-ui-mini-badge-pos";

export const viewport = (): Viewport => ({
  vw: window.innerWidth,
  vh: window.innerHeight,
});

/** A stored entry is user-editable text, and `JSON.parse` turns an overflowing
 * numeric literal into Infinity. That passes a `typeof` check but makes every
 * clamp comparison false, so it would reach the style string intact. */
const isCoord = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function loadGeom(): Geom | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Geom>;
    if (isCoord(p.x) && isCoord(p.y) && isCoord(p.w) && isCoord(p.h)) {
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    }
  } catch {
    // corrupt entry - fall back to default placement
  }
  return null;
}

export function saveGeom(g: Geom) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(g));
  } catch {
    // private mode / quota - geometry just will not persist
  }
}

export function getSavedGeom(): Geom {
  const vp = viewport();
  return clampGeom(loadGeom() ?? defaultGeom(vp), vp);
}

export function loadBadgePos(): BadgePos | null {
  try {
    const raw = window.localStorage.getItem(BADGE_STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<BadgePos>;
    if (isCoord(p.x) && isCoord(p.y)) {
      return { x: p.x, y: p.y };
    }
  } catch {
    // corrupt entry - fall back to default placement
  }
  return null;
}

export function saveBadgePos(pos: BadgePos) {
  try {
    window.localStorage.setItem(BADGE_STORE_KEY, JSON.stringify(pos));
  } catch {
    // private mode / quota - geometry just will not persist
  }
}

export function getSavedBadgePos(): BadgePos {
  const vp = viewport();
  const saved = loadBadgePos();
  if (saved) {
    return clampBadgePos(saved, vp);
  }
  const g = getSavedGeom();
  const x = Math.max(
    BADGE_MARGIN,
    Math.min(vp.vw - BADGE_SIZE - BADGE_MARGIN, g.x + g.w - BADGE_SIZE),
  );
  const y = Math.max(
    BADGE_MARGIN,
    Math.min(vp.vh - BADGE_SIZE - BADGE_MARGIN, g.y),
  );
  return { x, y };
}

type Compute = (start: Geom, dx: number, dy: number, vp: Viewport) => Geom;

/** Drives the mini window's position and size entirely through the DOM (no
 * React state), so neither chat streaming nor any other re-render can disturb
 * an in-flight gesture. Writes are batched into a single rAF per frame.
 *
 * Geometry is applied from a callback ref instead of a mount effect because
 * collapsing to the floating badge detaches the window node while this hook
 * stays mounted. A mount effect runs only once, so the restored window would
 * come back with no inline size and grow to fit its own content. */
export function useMiniWindowGeometry() {
  const node = useRef<HTMLDivElement | null>(null);
  const geom = useRef<Geom | null>(null);
  const frame = useRef(0);
  const pending = useRef<Geom | null>(null);

  /** Last known geometry, reclamped into the current viewport. Reads the
   * stored entry the first time it is needed. */
  const current = useCallback((): Geom => {
    const vp = viewport();
    const g = clampGeom(geom.current ?? loadGeom() ?? defaultGeom(vp), vp);
    geom.current = g;
    return g;
  }, []);

  const paint = useCallback((el: HTMLElement, g: Geom) => {
    el.style.left = `${g.x}px`;
    el.style.top = `${g.y}px`;
    el.style.width = `${g.w}px`;
    el.style.height = `${g.h}px`;
  }, []);

  const flush = useCallback(() => {
    frame.current = 0;
    const el = node.current;
    const g = pending.current;
    if (!el || !g) return;
    paint(el, g);
  }, [paint]);

  const write = useCallback(
    (g: Geom) => {
      geom.current = g;
      pending.current = g;
      if (frame.current === 0) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      node.current = el;
      if (el) paint(el, current());
    },
    [current, paint],
  );

  useEffect(() => {
    // Reclamp into the new viewport; persistence is left to the next gesture
    // since loadGeom re-clamps on startup anyway.
    const onResize = () => write(current());
    const onUnload = () => saveGeom(current());
    window.addEventListener("resize", onResize);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("beforeunload", onUnload);
      saveGeom(current());
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [current, write]);

  const beginGesture = useCallback(
    (e: React.PointerEvent, compute: Compute, threshold: number) => {
      const el = e.currentTarget as HTMLElement;
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      const start = current();
      // Don't capture the pointer or call preventDefault until the gesture
      // actually moves past the threshold, so a plain click on the header
      // still reaches its buttons, dropdowns and focus handlers.
      let armed = threshold <= 0;
      if (armed) {
        e.preventDefault();
        el.setPointerCapture?.(pointerId);
        document.body.style.userSelect = "none";
      }

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!armed) {
          if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
          armed = true;
          el.setPointerCapture?.(pointerId);
          document.body.style.userSelect = "none";
        }
        write(compute(start, dx, dy, viewport()));
      };
      const onUp = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        if (!armed) return;
        el.releasePointerCapture?.(pointerId);
        document.body.style.userSelect = "";
        saveGeom(current());
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
    [current, write],
  );

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (
        target.closest(
          "button, input, select, textarea, a, [role], [data-no-drag]",
        )
      )
        return;
      beginGesture(e, applyDrag, 4);
    },
    [beginGesture],
  );

  const startResize = useCallback(
    (dir: ResizeDir) => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      beginGesture(e, (start, dx, dy, vp) => applyResize(start, dir, dx, dy, vp), 0);
    },
    [beginGesture],
  );

  const saveCurrentGeom = useCallback(() => {
    saveGeom(current());
  }, [current]);

  return { ref, geom, onHeaderPointerDown, startResize, saveCurrentGeom };
}
