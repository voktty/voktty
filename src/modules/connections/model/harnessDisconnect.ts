import type { Tab } from "@/modules/tabs";
import type { HarnessProjectTarget } from "@/modules/surfaces/lib/harnessProjectRequest";
import { parseRemotePath } from "@/modules/connections/model/remoteProjects";
import { remoteSshConnectionIdForEnvironment } from "@/modules/connections/model/remoteSshProfiles";

export type HarnessDisconnectTarget = HarnessProjectTarget & {
  cwd: string | undefined;
  spaceId: string;
  selected: boolean;
};

export function planHarnessDisconnect(
  tabs: readonly Tab[],
  selected: Tab | undefined,
  profileIds: ReadonlySet<string>,
  workspaceAffected: boolean,
): HarnessDisconnectTarget[] {
  return tabs.flatMap((tab) => {
    if (tab.kind !== "harness") return [];
    const isSelected = selected?.kind === "harness" && tab.id === selected.id && tab.tabKey === selected.tabKey;
    const environmentId = parseRemotePath(typeof tab.cwd === "string" ? tab.cwd : "")?.environmentId;
    const profileId = environmentId === undefined ? undefined : remoteSshConnectionIdForEnvironment(environmentId);
    if (!(isSelected && workspaceAffected) && !(profileId !== undefined && profileIds.has(profileId))) return [];
    return [{ ownerId: tab.id, tabKey: tab.tabKey, cwd: tab.cwd, spaceId: tab.spaceId, selected: isSelected }];
  });
}

export function isHarnessDisconnectTarget(tab: Tab | undefined, target: HarnessDisconnectTarget): boolean {
  return tab?.kind === "harness" && tab.id === target.ownerId && tab.tabKey === target.tabKey &&
    tab.spaceId === target.spaceId && tab.cwd === target.cwd;
}
