import { useCallback, useLayoutEffect, useRef } from "react";
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

export function loadGeom(): Geom | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Geom>;
    if (
      typeof p.x === "number" &&
      typeof p.y === "number" &&
      typeof p.w === "number" &&
      typeof p.h === "number"
    ) {
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
    if (typeof p.x === "number" && typeof p.y === "number") {
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
 * an in-flight gesture. Writes are batched into a single rAF per frame. */
export function useMiniWindowGeometry() {
  const ref = useRef<HTMLDivElement>(null);
  const geom = useRef<Geom>({ x: 0, y: 0, w: 0, h: 0 });
  const frame = useRef(0);
  const pending = useRef<Geom | null>(null);

  const flush = useCallback(() => {
    frame.current = 0;
    const el = ref.current;
    const g = pending.current;
    if (!el || !g) return;
    el.style.left = `${g.x}px`;
    el.style.top = `${g.y}px`;
    el.style.width = `${g.w}px`;
    el.style.height = `${g.h}px`;
  }, []);

  const write = useCallback(
    (g: Geom) => {
      geom.current = g;
      pending.current = g;
      if (frame.current === 0) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  useLayoutEffect(() => {
    const g = clampGeom(loadGeom() ?? defaultGeom(viewport()), viewport());
    geom.current = g;
    const el = ref.current;
    if (el) {
      el.style.left = `${g.x}px`;
      el.style.top = `${g.y}px`;
      el.style.width = `${g.w}px`;
      el.style.height = `${g.h}px`;
    }
    // Reclamp into the new viewport; persistence is left to the next gesture
    // since loadGeom re-clamps on startup anyway.
    const onResize = () => write(clampGeom(geom.current, viewport()));
    const onUnload = () => saveGeom(geom.current);
    window.addEventListener("resize", onResize);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("beforeunload", onUnload);
      saveGeom(geom.current);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [write]);

  const beginGesture = useCallback(
    (e: React.PointerEvent, compute: Compute, threshold: number) => {
      const el = e.currentTarget as HTMLElement;
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      const start = geom.current;
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
        saveGeom(geom.current);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },
    [write],
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
    saveGeom(geom.current);
  }, []);

  return { ref, geom, onHeaderPointerDown, startResize, saveCurrentGeom };
}
