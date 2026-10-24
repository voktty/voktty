import type { Tab } from "@/modules/tabs/lib/useTabs";
import type { StripEntry } from "@/modules/spaces/lib/spaceProjection";
import { terminalProjectMetadata } from "@/modules/tabs/lib/terminalProject";
import { terminalRestoreProject } from "@/modules/tabs/lib/terminalProjectRestore";
import { pathKey, projectName } from "@/modules/harness/lib/paths";
import { resolveActiveSurface } from "@/modules/surfaces/lib/activeSurface";

export type TabProject = {
  key: string;
  cwd: string;
  name: string;
  description: string;
};

export function tabProject(tab: Tab): TabProject | undefined {
  if (tab.kind !== "terminal" || tab.private || tab.collaboration) return;
  const cwd = terminalProjectMetadata(
    tab.projectCwd,
    tab.workspaceEnv,
  ).projectCwd;
  if (!cwd) return;
  const remote = terminalRestoreProject(cwd);
  if (cwd.startsWith("remote://") && !remote) return;
  const environment = resolveActiveSurface({
    kind: "terminal",
    cwd,
    workspaceEnv: tab.workspaceEnv,
  }).environment;
  let description = cwd;
  if (remote) {
    const connection =
      tab.workspaceEnv?.kind === "ssh"
        ? tab.workspaceEnv.connection.name || remote.profileId
        : remote.profileId;
    description = [connection, remote.hostPath].join(" · ");
  } else if (environment.kind === "wsl") {
    description = [environment.distro, cwd].join(" · ");
  } else if (environment.kind === "docker") {
    const name =
      tab.workspaceEnv?.kind === "docker"
        ? tab.workspaceEnv.connection.containerName || environment.containerId
        : environment.containerId;
    description = [name, cwd].join(" · ");
  } else if (environment.kind === "serial") {
    description = [environment.portName, cwd].join(" · ");
  }
  return {
    key: JSON.stringify([
      environment,
      remote ? pathKey(remote.hostPath) : pathKey(cwd),
    ]),
    cwd,
    name: projectName(cwd),
    description,
  };
}

export type ProjectTabGroup = {
  project: TabProject | null;
  tabs: Tab[];
};

export function groupProjectTabs(
  tabs: readonly Tab[],
  entries: readonly StripEntry[] = [],
): ProjectTabGroup[] {
  const rank = new Map(
    entries.flatMap((entry, index) =>
      entry.kind === "standalone" ? [[entry.tabKey, index] as const] : [],
    ),
  );
  const ordered = tabs
    .map((tab, index) => ({ tab, index }))
    .sort(
      (a, b) =>
        (rank.get(a.tab.tabKey) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b.tab.tabKey) ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    );
  const groups = new Map<string, ProjectTabGroup>();
  const standalone: ProjectTabGroup = { project: null, tabs: [] };
  for (const { tab } of ordered) {
    const project = tabProject(tab);
    if (!project) {
      standalone.tabs.push(tab);
      continue;
    }
    let group = groups.get(project.key);
    if (!group) {
      group = { project, tabs: [] };
      groups.set(project.key, group);
    }
    group.tabs.push(tab);
  }
  return [...groups.values(), ...(standalone.tabs.length ? [standalone] : [])];
}
