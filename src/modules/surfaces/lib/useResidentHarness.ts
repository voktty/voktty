import { type RefObject, useEffect } from "react";

type TabLike = { kind: string; spaceId: string };

type Options = {
  /** Tabs restored and spaces hydrated: creating earlier would duplicate a restored Harness. */
  ready: boolean;
  spaceId: string | null;
  tabsRef: RefObject<readonly TabLike[]>;
  localRoot: string | undefined;
  newHarnessTab: (
    spaceId?: string,
    cwd?: string,
    sessionId?: string,
    options?: { activate?: boolean },
  ) => number;
};

function hasHarness(tabs: readonly TabLike[], spaceId: string): boolean {
  return tabs.some((tab) => tab.kind === "harness" && tab.spaceId === spaceId);
}

/**
 * Keeps a Harness mounted in the active space so opening it (or anything
 * routed through it, such as automations) never waits for a cold start. It
 * is created once the app is idle, without stealing focus, unless the space
 * has nothing else to show.
 */
export function useResidentHarness({
  ready,
  spaceId,
  tabsRef,
  localRoot,
  newHarnessTab,
}: Options): void {
  useEffect(() => {
    if (!ready || !spaceId || hasHarness(tabsRef.current, spaceId)) return;
    const create = () => {
      const tabs = tabsRef.current;
      if (hasHarness(tabs, spaceId)) return;
      const alone = !tabs.some((tab) => tab.spaceId === spaceId);
      newHarnessTab(spaceId, localRoot, undefined, { activate: alone });
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(create, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(create, 800);
    return () => window.clearTimeout(handle);
  }, [ready, spaceId, tabsRef, localRoot, newHarnessTab]);
}
