import { useLayoutEffect, useState } from "react";
import {
  searchProject,
  type ProjectSearchResult,
} from "@/modules/harness/lib/search";
import type { useProjectFileIndex } from "@/modules/harness/lib/useProjectFileIndex";

type Presentation = ProjectSearchResult & {
  isCurrent: () => boolean;
  loading: boolean;
  error: string | null;
};
const EMPTY: Presentation = {
  matches: [],
  truncated: false,
  loading: false,
  error: null,
  isCurrent: () => false,
};
let pending = 0;
const MAX_PENDING = 256;

export function useProjectContentSearch(
  cwd: string,
  query: string,
  enabled: boolean,
  { source, isCurrent: sourceCurrent }: ReturnType<typeof useProjectFileIndex>,
) {
  const [presentation, setPresentation] = useState(EMPTY);
  useLayoutEffect(() => {
    let current = true;
    const isCurrent = () => current && enabled && sourceCurrent();
    const publish = (result: Presentation) => {
      if (!isCurrent()) return;
      setPresentation((previous) => (isCurrent() ? result : previous));
    };
    setPresentation({ ...EMPTY, isCurrent });
    if (!enabled || !query || !sourceCurrent())
      return () => {
        current = false;
      };
    const timer = window.setTimeout(() => {
      void (async () => {
        if (!isCurrent()) return;
        if (pending >= MAX_PENDING) {
          publish({
            ...EMPTY,
            isCurrent,
            error: "Project search capacity exceeded.",
          });
          return;
        }
        pending++;
        try {
          publish({ ...EMPTY, isCurrent, loading: true });
          if (!isCurrent()) return;
          const result = source
            ? await source.searchContent(query, isCurrent)
            : await searchProject({ cwd, query });
          publish({ ...result, isCurrent, loading: false, error: null });
        } catch (error) {
          publish({
            ...EMPTY,
            isCurrent,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          pending--;
        }
      })();
    }, 200);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [cwd, query, enabled, source, sourceCurrent]);
  return presentation;
}
