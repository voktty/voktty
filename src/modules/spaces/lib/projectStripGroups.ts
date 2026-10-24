import type { ProjectedStripItem } from "@/modules/spaces/lib/spaceProjection";
import {
  groupProjectTabs,
  tabProject,
} from "@/modules/spaces/lib/projectTabGroups";

export function projectStripLabel(item: ProjectedStripItem | undefined) {
  return item?.kind === "tab" && item.spaceId === null
    ? tabProject(item.tab)
    : undefined;
}

export function projectStripGroupStart(
  items: readonly ProjectedStripItem[],
  index: number,
) {
  const project = projectStripLabel(items[index]);
  return project && project.key !== projectStripLabel(items[index - 1])?.key
    ? project
    : undefined;
}

export function groupProjectStripItems(
  items: ProjectedStripItem[],
): ProjectedStripItem[] {
  if (!items.some((item) => projectStripLabel(item))) return items;
  const result: ProjectedStripItem[] = [];
  let run: Extract<ProjectedStripItem, { kind: "tab" }>[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const byKey = new Map(run.map((item) => [item.tabKey, item]));
    for (const group of groupProjectTabs(run.map((item) => item.tab)))
      for (const tab of group.tabs) {
        const item = byKey.get(tab.tabKey);
        if (item) result.push(item);
      }
    run = [];
  };
  for (const item of items) {
    if (item.kind === "tab" && item.spaceId === null) run.push(item);
    else {
      flush();
      result.push(item);
    }
  }
  flush();
  return result;
}
