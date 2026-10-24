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
import { useCallback, useEffect, useRef, useState } from "react";
import { activeSpaceEnv } from "./activeSpace";
import {
  hydratePersistedSpaceTabs,
  missingStartupHarnessTabs,
  planSpacesBoot,
} from "./bootPlan";
import { bindRestoredSshSession } from "./restoreRemoteWorkspace";
import { freshHarnessTab, freshTerminalTab } from "./serialize";
import { loadAll, type SpaceMeta } from "./store";
import { useSpaces } from "./useSpaces";
import { windowSessionState } from "@/modules/lifecycle/windowSessionState";

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
  for (const t of tabs)
    if (t.kind === "terminal" && t.workspaceEnv?.kind !== "ssh")
      walk(t.paneTree);
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
  const attemptedRevision = useRef<number | null>(null);
  const appliedDirectoryRequestId = useRef<string | null>(null);
  const wasDirectoryRequestAppliedAtBoot = useCallback(
    (requestId: string) => appliedDirectoryRequestId.current === requestId,
    [],
  );
  const [bootError, setBootError] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const retryBoot = () => {
    setBootError(false);
    setRetryRevision((revision) => revision + 1);
  };

  useEffect(() => {
    if (!ready || attemptedRevision.current === retryRevision) return;
    attemptedRevision.current = retryRevision;

    void (async () => {
      let succeeded = false;
      try {
        await usePreferencesStore.getState().init();
        const startupSurface = usePreferencesStore.getState().startupSurface;
        const latestBootstrap = await refreshLaunchBootstrap();
        const bootRequest = selectBootLaunchRequest(
          latestBootstrap.requests,
          initialRequest,
        );
        const effectiveLaunchCwd = launchRequestCwd(bootRequest) ?? launchCwd;
        const bootPlan = planSpacesBoot(
          bootRequest,
          effectiveLaunchCwd,
          home,
          startupSurface,
        );
        if (!bootPlan.restoreLastCleanSession) {
          windowSessionState.seed(undefined, false);
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
          const initialTabs = bootPlan.createHarness
            ? [freshHarnessTab(DEFAULT_SPACE_ID, root, allocId)]
            : bootPlan.createTerminal
              ? [freshTerminalTab(DEFAULT_SPACE_ID, root, allocId)]
              : [];
          if (bootPlan.createHarness && root && !root.startsWith("remote://"))
            await native.workspaceAuthorize(root);
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
          if (
            bootRequest?.intent === "openDirectoryOnly" &&
            (bootRequest.source === "coldStart" ||
              bootRequest.source === "opened")
          )
            appliedDirectoryRequestId.current = bootRequest.requestId;
          succeeded = true;
          return;
        }
        const { spaces, activeId, states, session } = await loadAll();
        windowSessionState.seed(session?.harness, true);

        if (spaces.length === 0) {
          const root = bootPlan.root;
          const meta: SpaceMeta = {
            id: DEFAULT_SPACE_ID,
            name: "Default",
            root,
            env: bootPlan.createHarness
              ? LOCAL_WORKSPACE
              : parseWorkspaceScopeKey(
                  usePreferencesStore.getState().defaultWorkspaceEnv,
                ),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          const initialTab = bootPlan.createHarness
            ? freshHarnessTab(DEFAULT_SPACE_ID, root, allocId)
            : freshTerminalTab(DEFAULT_SPACE_ID, root, allocId);
          if (bootPlan.createHarness && root && !root.startsWith("remote://"))
            await native.workspaceAuthorize(root);
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
          succeeded = true;
          return;
        }

        const persistedSpaces = spaces.map((space) => ({ ...space }));
        const restored = hydratePersistedSpaceTabs(spaces, states, allocId);

        for (const space of spaces) {
          if (space.env.kind === "ssh") {
            space.env = LOCAL_WORKSPACE;
            space.root = launchCwd ?? home ?? null;
          }
        }

        const active =
          activeId && spaces.some((s) => s.id === activeId)
            ? activeId
            : spaces[0].id;
        const startupTabs =
          startupSurface === "harness"
            ? missingStartupHarnessTabs(persistedSpaces, restored, allocId)
            : [];
        const startupHarness = startupTabs.find(
          (tab) => tab.spaceId === active,
        );
        const tabsWithStartup = [...restored, ...startupTabs];
        setActiveSpaceForNewTabs(active);

        // Apply the space's environment before authorizing restored terminals.
        // The active space may intentionally have no tabs.
        const persistedInActive = restored.filter((t) => t.spaceId === active);
        const env =
          !startupHarness && persistedInActive.length > 0
            ? activeSpaceEnv(spaces, active)
            : LOCAL_WORKSPACE;
        const preparedEnv = await adoptWorkspaceEnv(env);
        const restoredState = bindRestoredSshSession({
          spaces,
          tabs: tabsWithStartup,
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
          loadedSession || startupTabs.length > 0
            ? {
                viewSpaces: loadedSession?.viewSpaces ?? [],
                stripEntries: [
                  ...(loadedSession?.stripEntries ??
                    restored.map((tab) => ({
                      kind: "standalone" as const,
                      tabKey: tab.tabKey,
                    }))),
                  ...startupTabs.map((tab) => ({
                    kind: "standalone" as const,
                    tabKey: tab.tabKey,
                  })),
                ],
                activeStripItem: startupHarness
                  ? { kind: "tab", tabKey: startupHarness.tabKey }
                  : (loadedSession?.activeStripItem ?? null),
              }
            : undefined,
        );

        const activeTab =
          startupHarness ??
          (loadedSession?.activeTabKey
            ? restoredState.tabs.find(
                (tab) => tab.tabKey === loadedSession.activeTabKey,
              )
            : null) ??
          inActive[states.get(active)?.activeTabIndex ?? 0] ??
          inActive[0];
        const activeOrigin = persistedSpaces.find(
          (space) => space.id === active,
        );
        if (
          env.kind !== "ssh" &&
          (activeTab?.kind !== "harness" || activeOrigin?.env.kind === "local")
        ) {
          const activeRoot = restoredState.spaces.find(
            (space) => space.id === active,
          )?.root;
          const paths = new Set(activeTab ? uniqueCwds([activeTab]) : []);
          if (activeRoot) paths.add(activeRoot);
          await Promise.allSettled(
            [...paths]
              .filter((cwd) => !cwd.startsWith("remote://"))
              .map((cwd) => native.workspaceAuthorize(cwd)),
          );
        }
        replaceTabs(restoredState.tabs, activeTab?.id ?? NO_ACTIVE_TAB_ID);
        succeeded = true;
      } catch (e) {
        console.error("[voktty] spaces boot failed:", e);
        setBootError(true);
      } finally {
        if (succeeded) markBooted();
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
    retryRevision,
  ]);
  return { bootError, retryBoot, wasDirectoryRequestAppliedAtBoot };
}
