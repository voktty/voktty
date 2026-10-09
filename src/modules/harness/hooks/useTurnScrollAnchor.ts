import { type RefObject, useLayoutEffect } from "react";

type TurnSize = { top: number; height: number; previous: number | undefined };

function anchorShift(sizes: TurnSize[], viewportTop: number): number {
  let shift = 0;
  let precedingDelta = 0;
  for (const { top, height, previous } of sizes) {
    if (previous === undefined) continue;
    if (top - precedingDelta + previous <= viewportTop)
      shift += height - previous;
    precedingDelta += height - previous;
  }
  return shift;
}

/** Correct late layout changes above the reader when native anchoring is off. */
export function useTurnScrollAnchor(
  el: HTMLDivElement | null,
  enabled: boolean,
  stickToBottom: RefObject<boolean>,
  onAdjust: (el: HTMLElement) => void,
) {
  useLayoutEffect(() => {
    const inner = el?.querySelector("[data-transcript-content]");
    if (!enabled || !el || !inner) return;
    const heights = new WeakMap<Element, number>();
    const resize = new ResizeObserver((entries) => {
      if (!el.isConnected) return;
      const byTurn = new Map(entries.map((entry) => [entry.target, entry]));
      const sizes: TurnSize[] = [];
      // Positions include earlier height changes, so reconcile in DOM order.
      for (const turn of inner.children) {
        const entry = byTurn.get(turn);
        if (!entry) continue;
        const height =
          entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const previous = heights.get(turn);
        heights.set(turn, height);
        sizes.push({ top: turn.getBoundingClientRect().top, height, previous });
      }
      if (stickToBottom.current) return;
      const shift = anchorShift(sizes, el.getBoundingClientRect().top);
      if (shift) {
        el.scrollTop += shift;
        onAdjust(el);
      }
    });
    let observed = new WeakSet<Element>();
    const observeTurns = () => {
      for (const turn of inner.children) {
        if (observed.has(turn) || !turn.classList.contains("transcript-turn"))
          continue;
        observed.add(turn);
        resize.observe(turn);
      }
    };
    const mutations = new MutationObserver((records) => {
      // Re-observe after removals so the observer cannot retain detached turns.
      if (records.some((record) => record.removedNodes.length > 0)) {
        resize.disconnect();
        observed = new WeakSet();
      }
      observeTurns();
    });
    mutations.observe(inner, { childList: true });
    observeTurns();
    return () => {
      mutations.disconnect();
      resize.disconnect();
    };
  }, [el, enabled, stickToBottom, onAdjust]);
}
