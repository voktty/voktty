import { useCallback, useLayoutEffect, useRef } from "react";
import { IS_WINDOWS } from "@/lib/platform";
import { revealInFinder } from "@/modules/explorer/lib/contextActions";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { tabFileManagerRevealPath } from "@/modules/tabs/lib/tabFileManagerReveal";
import type { Tab } from "@/modules/tabs/lib/useTabs";

export function useTabFileManagerReveal(tabs: readonly Tab[]) {
  const spaces = useSpaces((state) => state.spaces);
  const committed = useRef<{
    tabs: readonly Tab[];
    spaces: typeof spaces;
  } | null>(null);
  useLayoutEffect(() => {
    const current = { tabs, spaces };
    committed.current = current;
    return () => {
      if (committed.current === current) committed.current = null;
    };
  }, [tabs, spaces]);
  const pathFor = useCallback(
    (tab: Tab) =>
      tabFileManagerRevealPath(
        tab,
        spaces.find((space) => space.id === tab.spaceId)?.env,
        IS_WINDOWS,
      ),
    [spaces],
  );
  const reveal = useCallback(
    (tab: Tab) => {
      const current = committed.current;
      const live = current?.tabs.find(
        (candidate) =>
          candidate.id === tab.id && candidate.tabKey === tab.tabKey,
      );
      if (!live || !current) return;
      const workspace = current.spaces.find(
        (space) => space.id === live.spaceId,
      )?.env;
      const path = tabFileManagerRevealPath(live, workspace, IS_WINDOWS);
      if (path === null || path !== pathFor(tab)) return;
      void revealInFinder(path);
    },
    [pathFor],
  );
  return { pathFor, reveal };
}
