import {
  initialBootIntent,
  type LaunchRequest,
  launchRequestCwd,
} from "@/lib/launchRequest";
import type { StartupSurface } from "@/modules/settings/store";
import type { HarnessTab } from "@/modules/tabs";
import type { Tab } from "@/modules/tabs";
import { freshHarnessTab, hydrateTabs } from "./serialize";
import type { SpaceMeta, SpaceState } from "./store";

export type SpacesBootPlan = {
  restoreLastCleanSession: boolean;
  root: string | null;
  createTerminal: boolean;
  createHarness: boolean;
};

export function planSpacesBoot(
  request: LaunchRequest | null,
  launchCwd: string | null,
  home: string | null,
  startupSurface: StartupSurface = "harness",
): SpacesBootPlan {
  const intent = initialBootIntent(request);
  return {
    restoreLastCleanSession: intent === "restoreLastSession",
    root: launchRequestCwd(request) ?? launchCwd ?? home ?? null,
    createTerminal:
      startupSurface === "terminal" &&
      (intent === "openDirectoryOnly" || intent === "restoreLastSession"),
    createHarness:
      startupSurface === "harness" &&
      (intent === "openDirectoryOnly" || intent === "restoreLastSession"),
  };
}

export function hydratePersistedSpaceTabs(
  spaces: readonly SpaceMeta[],
  states: ReadonlyMap<string, SpaceState>,
  allocId: () => number,
): Tab[] {
  return spaces.flatMap((space) => {
    const state = states.get(space.id);
    return state ? hydrateTabs(state.tabs, space.id, allocId, space.env) : [];
  });
}

export function missingStartupHarnessTabs(
  spaces: readonly SpaceMeta[],
  tabs: readonly Tab[],
  allocId: () => number,
): HarnessTab[] {
  const occupied = new Set(
    tabs.filter((tab) => tab.kind === "harness").map((tab) => tab.spaceId),
  );
  return spaces
    .filter((space) => !occupied.has(space.id))
    .map((space) =>
      freshHarnessTab(
        space.id,
        space.env.kind === "local" || space.root?.startsWith("remote://")
          ? space.root
          : null,
        allocId,
      ),
    );
}
