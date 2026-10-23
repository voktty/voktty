import { leafIds, type FilePaneTab } from "@/modules/harness/lib/layout";
import type { HarnessWindowViewsSnapshot } from "@/modules/harness/lib/harnessWindowViews";
import { sameProjectPath } from "@/modules/harness/lib/recents";
import {
  parseRemotePath,
  relativeWithinProject,
} from "@/modules/connections/model/remoteProjects";

function belongsToProject(folder: string, project: string) {
  const remote = parseRemotePath(project);
  const target = parseRemotePath(folder);
  if (remote || target)
    return (
      remote &&
      target &&
      remote.environmentId === target.environmentId &&
      relativeWithinProject(remote.hostPath, target.hostPath) !== undefined
    );
  return relativeWithinProject(project, folder) !== undefined;
}

export function hiddenLegacyTerminals(
  snapshot: HarnessWindowViewsSnapshot,
  project: string,
  includePresented = false,
) {
  const presented = new Set<string>();
  const candidates = new Map<string, FilePaneTab>();
  for (const cohort of snapshot.cohorts) {
    const layout = cohort.state.layout;
    const selected = layout.tabs.find((tab) => tab.id === layout.activeTabId);
    const visiblePanes = new Set(selected ? leafIds(selected.layout) : []);
    for (const tab of layout.tabs)
      for (const pane of [...tab.editorPanes, ...tab.terminalPanes])
        for (const file of pane.files) {
          if (!file.terminal) continue;
          if (
            cohort.active &&
            tab === selected &&
            visiblePanes.has(pane.id) &&
            pane.activeFileId === file.id
          )
            presented.add(file.id);
          if (
            !file.canonicalTerminal &&
            sameProjectPath(layout.projectCwd, project) &&
            belongsToProject(file.cwd, project)
          )
            candidates.set(file.id, file);
        }
    for (const dock of layout.projectTerminals)
      for (const file of dock.pane.files) {
        if (!file.terminal) continue;
        if (
          cohort.active &&
          dock.open &&
          sameProjectPath(dock.projectPath, layout.projectCwd) &&
          dock.pane.activeFileId === file.id
        )
          presented.add(file.id);
        if (
          !file.canonicalTerminal &&
          sameProjectPath(dock.projectPath, project)
        )
          candidates.set(file.id, file);
      }
  }
  return [...candidates.values()].filter(
    (file) => includePresented || !presented.has(file.id),
  );
}
