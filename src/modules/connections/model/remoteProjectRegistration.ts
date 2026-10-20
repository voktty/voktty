import {
  normalizeRemoteProjectPath,
  remoteProjectPathIssue,
} from "./remoteProjectBrowser";
import {
  parseRemotePath,
  rememberRemoteProject,
  remoteProjectForPath,
  type RemoteProject,
} from "./remoteProjects";
import { remoteSshConnectionIdForEnvironment } from "./remoteSshProfiles";

type SavedProfile = { id: string; name: string };

export function sshProjectId(profileId: string, cwd: string): string {
  return `ssh-${profileId}-${cwd}`;
}

/**
 * Remote file commands only run inside a registered project root. Any entry
 * point that selects a `remote://voktty-ssh-*` folder must go through here so
 * the folder is registered before the first file, Git or search request.
 * Only exact saved-profile identities are accepted; no fuzzy matching.
 */
export function registerSshProjectPath(
  path: string,
  savedProfiles: readonly SavedProfile[],
): RemoteProject | undefined {
  const parsed = parseRemotePath(path);
  if (!parsed) return undefined;
  const existing = remoteProjectForPath(path);
  if (existing) return existing;
  const profileId = remoteSshConnectionIdForEnvironment(parsed.environmentId);
  if (!profileId) return undefined;
  const profile = savedProfiles.find((entry) => entry.id === profileId);
  if (!profile) return undefined;
  if (remoteProjectPathIssue(parsed.hostPath)) return undefined;
  const cwd = normalizeRemoteProjectPath(parsed.hostPath);
  const segments = cwd.split("/").filter(Boolean);
  return rememberRemoteProject(parsed.environmentId, {
    id: sshProjectId(profile.id, cwd),
    cwd,
    name: segments[segments.length - 1] ?? profile.name,
  });
}
