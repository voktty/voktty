import {
  parseRemotePath,
  remoteProjectKey,
} from "@/modules/connections/model/remoteProjects";
import { remoteSshEnvironmentId } from "@/modules/connections/model/remoteSshProfiles";

export type ProjectEnvironmentIdentity = {
  projectId: string;
  profileId: string;
  requestedRoot: string;
  resolvedRoot?: string;
  automatic: boolean;
};

type ProjectEntry = { identity: ProjectEnvironmentIdentity };

export function projectEnvironmentId(profileId: string, root: string): string {
  return remoteProjectKey(remoteSshEnvironmentId(profileId), root);
}

function canonicalProjectId(projectId: string): string {
  const path = parseRemotePath(projectId);
  return path ? remoteProjectKey(path.environmentId, path.hostPath) : projectId;
}

function ownEntry<T>(
  entries: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.getOwnPropertyDescriptor(entries, key)?.value;
}

/** Automatic aliases describe one actual project; explicit consumers remain independent. */
export function projectEnvironmentOwnerIds(
  projectId: string,
  projects: Readonly<Record<string, ProjectEntry>>,
): string[] {
  const canonical = canonicalProjectId(projectId);
  const directId = ownEntry(projects, projectId) ? projectId : canonical;
  const direct = ownEntry(projects, directId);
  if (direct && !direct.identity.automatic) return [directId];
  const target = direct?.identity.projectId ?? canonical;
  const aliases = Object.entries(projects)
    .filter(
      ([ownerId, { identity }]) =>
        ownerId === directId ||
        (identity.automatic && identity.projectId === target),
    )
    .map(([ownerId]) => ownerId)
    .sort();
  return direct
    ? [directId, ...aliases.filter((id) => id !== directId)]
    : aliases;
}

export function projectEnvironmentOwnerId(
  projectId: string,
  projects: Readonly<Record<string, ProjectEntry>>,
): string | undefined {
  return projectEnvironmentOwnerIds(projectId, projects)[0];
}
