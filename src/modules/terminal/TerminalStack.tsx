import type { WorkspacePlacement } from "@/modules/spaces";
import { useSpaces } from "@/modules/spaces";
import type { Tab } from "@/modules/tabs";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import type { SearchAddon } from "@xterm/addon-search";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { selectLiveTerminals } from "./lib/liveTerminals";
import { leafIds } from "./lib/panes";
import { PaneTreeView } from "./PaneTreeView";
import type { TerminalPaneHandle } from "./TerminalPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  /** Register/unregister handle by leaf id (not tab id). */
  registerHandle: (leafId: number, handle: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
  onTitle?: (leafId: number, title: string) => void;
  onFocusLeaf: (tabId: number, leafId: number) => void;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
};

type Bundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
  onTitle: (leafId: number, title: string) => void;
};

export function TerminalStack({
  tabs,
  activeId,
  registerHandle,
  onSearchReady,
  onCwd,
  onExit,
  onTitle,
  onFocusLeaf,
  placements,
}: Props) {
  const terminals = useMemo(() => selectLiveTerminals(tabs), [tabs]);
  const spaces = useSpaces((s) => s.spaces);
  const spaceEnvs = useMemo(
    () => new Map(spaces.map((space) => [space.id, space.env])),
    [spaces],
  );

  const registerRef = useRef(registerHandle);
  const searchReadyRef = useRef(onSearchReady);
  const cwdRef = useRef(onCwd);
  const exitRef = useRef(onExit);
  const titleRef = useRef(onTitle);
  const focusLeafRef = useRef(onFocusLeaf);
  useEffect(() => {
    focusLeafRef.current = onFocusLeaf;
  }, [onFocusLeaf]);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    searchReadyRef.current = onSearchReady;
  }, [onSearchReady]);
  useEffect(() => {
    cwdRef.current = onCwd;
  }, [onCwd]);
  useEffect(() => {
    exitRef.current = onExit;
  }, [onExit]);
  useEffect(() => {
    titleRef.current = onTitle;
  }, [onTitle]);

  const bundles = useRef(new Map<number, Bundle>());
  // Identity-stable: PaneTreeView is memoized, and a fresh getBundle on every
  // render would miss that memo and re-render every pane of every terminal
  // tab on each tab switch, not just the one being shown.
  const getBundle = useCallback((leafId: number): Bundle => {
    let b = bundles.current.get(leafId);
    if (!b) {
      b = {
        setRef: (h) => registerRef.current(leafId, h),
        onSearchReady: (id, addon) => searchReadyRef.current(id, addon),
        onCwd: (id, cwd) => cwdRef.current(id, cwd),
        onExit: (id, code) => exitRef.current(id, code),
        onTitle: (id, title) => titleRef.current?.(id, title),
      };
      bundles.current.set(leafId, b);
    }
    return b;
  }, []);

  // Same reason as getBundle, but keyed by tab: an inline arrow here would
  // hand every PaneTreeView a new onFocusLeaf on each render.
  const focusHandlers = useRef(new Map<number, (leafId: number) => void>());
  const getFocusLeaf = useCallback((tabId: number) => {
    let handler = focusHandlers.current.get(tabId);
    if (!handler) {
      handler = (leafId: number) => focusLeafRef.current(tabId, leafId);
      focusHandlers.current.set(tabId, handler);
    }
    return handler;
  }, []);

  useEffect(() => {
    const live = new Set<number>();
    for (const t of terminals)
      for (const id of leafIds(t.paneTree)) live.add(id);
    for (const id of bundles.current.keys()) {
      if (!live.has(id)) bundles.current.delete(id);
    }
    const liveTabs = new Set(terminals.map((t) => t.id));
    for (const id of focusHandlers.current.keys()) {
      if (!liveTabs.has(id)) focusHandlers.current.delete(id);
    }
  }, [terminals]);

  return (
    <div className="relative h-full w-full">
      {terminals.map((t) => {
        const placement = placements?.get(t.id);
        const tabVisible = placements
          ? placement !== undefined
          : t.id === activeId;
        const isTabFocused = placements
          ? Boolean(placement?.focused)
          : t.id === activeId;
        return (
          <div
            key={t.id}
            data-terminal-tab={t.id}
            data-space-slot={placement?.slotId}
            data-space-tab={t.id}
            className="absolute bg-background"
            style={{
              left: placement ? `${placement.rect.x * 100}%` : 0,
              top: placement ? `${placement.rect.y * 100}%` : 0,
              width: placement ? `${placement.rect.width * 100}%` : "100%",
              height: placement ? `${placement.rect.height * 100}%` : "100%",
              visibility: tabVisible ? "visible" : "hidden",
              pointerEvents: tabVisible ? "auto" : "none",
              contain: "strict",
              isolation: "isolate",
            }}
            aria-hidden={!tabVisible}
          >
            <PaneTreeView
              node={t.paneTree}
              tabVisible={tabVisible}
              activeLeafId={isTabFocused ? t.activeLeafId : null}
              blocks={t.blocks ?? false}
              workspaceEnv={
                t.workspaceEnv ?? spaceEnvs.get(t.spaceId) ?? LOCAL_WORKSPACE
              }
              shellOverride={t.shellOverride}
              onFocusLeaf={getFocusLeaf(t.id)}
              getBundle={getBundle}
            />
          </div>
        );
      })}
    </div>
  );
}
