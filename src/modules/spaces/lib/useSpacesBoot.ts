import {
  type LaunchRequest,
  launchRequestCwd,
  refreshLaunchBootstrap,
  selectBootLaunchRequest,
} from "@/lib/launchRequest";
import { native } from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "@/modules/tabs";
import { DEFAULT_SPACE_ID, NO_ACTIVE_TAB_ID } from "@/modules/tabs/lib/useTabs";
import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";
import {
  LOCAL_WORKSPACE,
  parseWorkspaceScopeKey,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { useEffect, useRef } from "react";
import { activeSpaceEnv } from "./activeSpace";
import { planSpacesBoot } from "./bootPlan";
import { bindRestoredSshSession } from "./restoreRemoteWorkspace";
import { freshTerminalTab, hydrateTabs } from "./serialize";
import { loadAll, type SpaceMeta } from "./store";
import { useSpaces } from "./useSpaces";

type Params = {
  ready: boolean;
  initialRequest: LaunchRequest | null;
  launchCwd: string | null;
  home: string | null;
  allocId: () => number;
  replaceTabs: (tabs: Tab[], activeId: number) => void;
  markBooted: () => void;
  setActiveSpaceForNewTabs: (id: string) => void;
  adoptWorkspaceEnv: (env: WorkspaceEnv) => Promise<WorkspaceEnv | null>;
};

function uniqueCwds(tabs: Tab[]): string[] {
  const set = new Set<string>();
  const walk = (n: PaneNode) => {
    if (isLeaf(n)) {
      if (n.cwd) set.add(n.cwd);
      return;
    }
    for (const c of n.children) walk(c);
  };
  for (const t of tabs) if (t.kind === "terminal") walk(t.paneTree);
  return [...set];
}

export function useSpacesBoot({
  ready,
  initialRequest,
  launchCwd,
  home,
  allocId,
  replaceTabs,
  markBooted,
  setActiveSpaceForNewTabs,
  adoptWorkspaceEnv,
}: Params) {
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;

    void (async () => {
      try {
        const latestBootstrap = await refreshLaunchBootstrap();
        const bootRequest = selectBootLaunchRequest(
          latestBootstrap.requests,
          initialRequest,
        );
        const effectiveLaunchCwd = launchRequestCwd(bootRequest) ?? launchCwd;
        const bootPlan = planSpacesBoot(bootRequest, effectiveLaunchCwd, home);
        if (!bootPlan.restoreLastCleanSession) {
          const root = bootPlan.root;
          const now = Date.now();
          const meta: SpaceMeta = {
            id: DEFAULT_SPACE_ID,
            name: "Default",
            root,
            env: LOCAL_WORKSPACE,
            createdAt: now,
            updatedAt: now,
          };
          const initialTabs = bootPlan.createTerminal
            ? [freshTerminalTab(DEFAULT_SPACE_ID, root, allocId)]
            : [];
          const activeTab = initialTabs[0] ?? null;
          setActiveSpaceForNewTabs(DEFAULT_SPACE_ID);
          useSpaces.getState().hydrate(
            [meta],
            DEFAULT_SPACE_ID,
            {},
            {
              viewSpaces: [],
              stripEntries: activeTab
                ? [{ kind: "standalone", tabKey: activeTab.tabKey }]
                : [],
              activeStripItem: activeTab
                ? { kind: "tab", tabKey: activeTab.tabKey }
                : null,
            },
          );
          replaceTabs(initialTabs, activeTab?.id ?? NO_ACTIVE_TAB_ID);
          return;
        }
        const { spaces, activeId, states, session } = await loadAll();

        if (spaces.length === 0) {
          const root = launchCwd ?? home ?? null;
          // Hydrate prefs before reading the saved workspace env.
          await usePreferencesStore
            .getState()
            .init()
            .catch(() => {});
          const meta: SpaceMeta = {
            id: DEFAULT_SPACE_ID,
            name: "Default",
            root,
            env: parseWorkspaceScopeKey(
              usePreferencesStore.getState().defaultWorkspaceEnv,
            ),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          const initialTab = freshTerminalTab(DEFAULT_SPACE_ID, root, allocId);
          setActiveSpaceForNewTabs(DEFAULT_SPACE_ID);
          useSpaces.getState().hydrate(
            [meta],
            DEFAULT_SPACE_ID,
            {},
            {
              viewSpaces: [],
              stripEntries: [{ kind: "standalone", tabKey: initialTab.tabKey }],
              activeStripItem: { kind: "tab", tabKey: initialTab.tabKey },
            },
          );
          replaceTabs([initialTab], initialTab.id);
          return;
        }

        const restored: Tab[] = [];
        for (const space of spaces) {
          const st = states.get(space.id);
          if (!st) continue;
          restored.push(...hydrateTabs(st.tabs, space.id, allocId, space.env));
        }

        const active =
          activeId && spaces.some((s) => s.id === activeId)
            ? activeId
            : spaces[0].id;
        setActiveSpaceForNewTabs(active);

        // Apply the space's environment before authorizing restored terminals.
        // The active space may intentionally have no tabs.
        const persistedInActive = restored.filter((t) => t.spaceId === active);
        const env =
          persistedInActive.length > 0
            ? activeSpaceEnv(spaces, active)
            : LOCAL_WORKSPACE;
        const preparedEnv = await adoptWorkspaceEnv(env);
        const restoredState = bindRestoredSshSession({
          spaces,
          tabs: restored,
          activeSpaceId: active,
          requested: env,
          prepared: preparedEnv,
        });
        const inActive = restoredState.tabs.filter(
          (tab) => tab.spaceId === active,
        );

        const initialActiveIndex: Record<string, number> = {};
        for (const [id, st] of states)
          initialActiveIndex[id] = st.activeTabIndex;
        const loadedSession = session;
        useSpaces.getState().hydrate(
          restoredState.spaces,
          active,
          initialActiveIndex,
          loadedSession
            ? {
                viewSpaces: loadedSession.viewSpaces,
                stripEntries: loadedSession.stripEntries,
                activeStripItem: loadedSession.activeStripItem,
              }
            : undefined,
        );

        const activeTab =
          (loadedSession?.activeTabKey
            ? restoredState.tabs.find(
                (tab) => tab.tabKey === loadedSession.activeTabKey,
              )
            : null) ??
          inActive[states.get(active)?.activeTabIndex ?? 0] ??
          inActive[0];
        if (env.kind !== "ssh") {
          const activeRoot = restoredState.spaces.find(
            (space) => space.id === active,
          )?.root;
          const paths = new Set(activeTab ? uniqueCwds([activeTab]) : []);
          if (activeRoot) paths.add(activeRoot);
          await Promise.allSettled(
            [...paths].map((cwd) => native.workspaceAuthorize(cwd)),
          );
        }
        replaceTabs(restoredState.tabs, activeTab?.id ?? NO_ACTIVE_TAB_ID);
      } catch (e) {
        console.error("[voktty] spaces boot failed:", e);
      } finally {
        markBooted();
      }
    })();
  }, [
    ready,
    initialRequest,
    launchCwd,
    home,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
    adoptWorkspaceEnv,
  ]);
}
