import { useEffect, useRef } from "react";
import type { HarnessSummarySource } from "@/modules/harness/lib/harnessSummaryUpdates";

export function useHarnessSummaryUpdates(
  source: HarnessSummarySource,
  onSummary: Parameters<HarnessSummarySource["subscribe"]>[0],
) {
  const latest = useRef(onSummary);
  latest.current = onSummary;
  useEffect(
    () =>
      source.subscribe((summary, isCurrent) =>
        latest.current(summary, isCurrent),
      ),
    [source],
  );
}
