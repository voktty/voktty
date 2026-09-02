import { useCallback, useRef } from "react";

/** Stop macOS rubber-band bounce when a scroller reaches any edge. */
export function useLockOverscroll<T extends HTMLElement>() {
  const cleanup = useRef<(() => void) | null>(null);

  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const canScrollX = el.scrollWidth > el.clientWidth + 1;
      const canScrollY = el.scrollHeight > el.clientHeight + 1;
      const atTop = canScrollY && el.scrollTop <= 0 && e.deltaY < 0;
      const atBottom =
        canScrollY &&
        el.scrollTop + el.clientHeight >= el.scrollHeight - 1 &&
        e.deltaY > 0;
      const atLeft = canScrollX && el.scrollLeft <= 0 && e.deltaX < 0;
      const atRight =
        canScrollX &&
        el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 &&
        e.deltaX > 0;
      if (atTop || atBottom || atLeft || atRight) e.preventDefault();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    cleanup.current = () => el.removeEventListener("wheel", onWheel);
  }, []);
}
