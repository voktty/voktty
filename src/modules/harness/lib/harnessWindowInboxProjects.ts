import {
  looksLikeProject,
  normalizeProjectPath,
  type RecentProject,
} from "@/modules/harness/lib/recents";

const MAX_PROJECTS = 500;

export function collectHarnessWindowInboxProjects(
  recents: readonly RecentProject[],
  livePaths: readonly string[],
): RecentProject[] {
  const paths = new Set<string>();
  const add = (path: string) => {
    const normalized = normalizeProjectPath(path);
    if (paths.size < MAX_PROJECTS && looksLikeProject(normalized))
      paths.add(normalized);
  };
  for (const path of livePaths.slice(0, MAX_PROJECTS)) add(path);
  for (const project of recents.slice(0, MAX_PROJECTS)) add(project.path);
  return [...paths].sort().map((path) => ({ path, openedAt: 0 }));
}
