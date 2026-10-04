import {
  initialBootIntent,
  type LaunchRequest,
  launchRequestCwd,
} from "@/lib/launchRequest";
import type { Tab } from "@/modules/tabs";
import { hydrateTabs } from "./serialize";
import type { SpaceMeta, SpaceState } from "./store";

export type SpacesBootPlan = {
  restoreLastCleanSession: boolean;
  root: string | null;
  createTerminal: boolean;
};

export function planSpacesBoot(
  request: LaunchRequest | null,
  launchCwd: string | null,
  home: string | null,
): SpacesBootPlan {
  const intent = initialBootIntent(request);
  return {
    restoreLastCleanSession: intent === "restoreLastSession",
    root: launchRequestCwd(request) ?? launchCwd ?? home ?? null,
    createTerminal:
      intent === "openDirectoryOnly" || intent === "restoreLastSession",
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
