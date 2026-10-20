import { isRemoteProjectPath, sameProjectPath } from "./recents";

const matches = (path: string, set: ReadonlySet<string>): boolean => {
  for (const item of set) if (sameProjectPath(item, path)) return true;
  return false;
};

/**
 * Projects that can be dropped in one go: folders this computer cannot find.
 * Never a project on a remote host (this computer cannot judge those), one with
 * a running agent, or the one on screen.
 */
export function removableUnavailableProjects(
  paths: readonly string[],
  unavailable: ReadonlySet<string>,
  busy: ReadonlySet<string>,
  current: string,
): string[] {
  const seen: string[] = [];
  for (const path of paths) {
    if (!path || path === "~" || isRemoteProjectPath(path)) continue;
    if (!matches(path, unavailable)) continue;
    if (matches(path, busy) || sameProjectPath(path, current)) continue;
    if (seen.some((known) => sameProjectPath(known, path))) continue;
    seen.push(path);
  }
  return seen;
}