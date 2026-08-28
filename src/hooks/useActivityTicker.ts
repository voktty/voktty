import { useEffect, useState } from "react";
import {
  nextTickerIndex,
  TICKER_DWELL_MS,
} from "../surfaces/transcriptActivity";

/**
 * Which activity row the zen ticker is holding. It walks forward one row at a
 * time so a burst of fast tool calls still reads as a sequence, and gives up
 * and jumps to the live row when it has fallen too far behind.
 */
export function useActivityTicker(count: number, rolling: boolean): number {
  const [index, setIndex] = useState(count - 1);

  useEffect(() => {
    if (!rolling) {
      setIndex(count - 1);
      return;
    }
    const target = nextTickerIndex(index, count);
    if (target === index) return;
    // A skip ahead, or a stack that shrank under us, lands immediately; a
    // single step waits out the dwell so the row gets its beat on screen.
    if (target - index !== 1) {
      setIndex(target);
      return;
    }
    const timer = window.setTimeout(() => setIndex(target), TICKER_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [count, index, rolling]);

  return Math.max(0, Math.min(index, count - 1));
}
