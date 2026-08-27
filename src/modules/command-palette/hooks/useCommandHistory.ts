import { historyList } from "@/modules/terminal/block/lib/history";
import { useCallback } from "react";
import { type AsyncQueryState, useAsyncQuery } from "./useAsyncQuery";

const LIMIT = 60;
const DEBOUNCE_MS = 80;

export function useCommandHistory(
  term: string,
  enabled: boolean,
): AsyncQueryState<string> {
  const run = useCallback(
    async (q: string) => {
      const entries = await historyList(q, undefined, LIMIT);
      return Array.from(new Set(entries.map((e) => e.cmd)));
    },
    [],
  );

  return useAsyncQuery({
    enabled,
    term,
    minLength: 0,
    debounceMs: DEBOUNCE_MS,
    run,
  });
}
