import {
  parseRemotePath,
  remoteProjectForPath,
  relativeWithinProject,
  type RemoteProject,
} from "@/modules/connections/model/remoteProjects";
import { findSshProfile } from "@/modules/connections/model/remoteSshProfiles";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SshConnection } from "@/modules/ssh/types";
import { checkReadable } from "@/modules/ai/lib/security";
import { fileReadCacheKey } from "@/modules/ai/lib/filesystemCacheKey";

export type ProjectAttachmentSource = Readonly<{
  path: string;
  project: Readonly<RemoteProject>;
  profile: Readonly<SshConnection>;
  key: string;
}>;
const capturedSources = new WeakSet<ProjectAttachmentSource>();

export function captureProjectAttachment(
  path: string,
  owner?: ProjectAttachmentSource,
): ProjectAttachmentSource | null {
  try {
    if (owner && !capturedSources.has(owner)) return null;
    if (path.length > 32768 || /[\x00-\x1f\x7f]/.test(path)) return null;
    const parsed = parseRemotePath(path);
    if (!parsed || !checkReadable(parsed.hostPath).ok) return null;
    const project = owner?.project ?? remoteProjectForPath(path);
    if (
      !project ||
      typeof project.cwd !== "string" ||
      project.cwd.length > 32768 ||
      typeof project.key !== "string" ||
      typeof project.projectId !== "string"
    )
      return null;
    if (
      project.environmentId !== parsed.environmentId ||
      relativeWithinProject(project.cwd, parsed.hostPath) === undefined
    )
      return null;
    const profile =
      owner?.profile ??
      findSshProfile(
        parsed.environmentId,
        usePreferencesStore.getState().sshConnections ?? [],
        { kind: "local" },
      );
    if (!profile || JSON.stringify(profile).length > 32768) return null;
    const root = Object.freeze({
      key: project.key,
      projectId: project.projectId,
      environmentId: project.environmentId,
      cwd: project.cwd,
    });
    const connection = Object.freeze({
      id: profile.id,
      name: profile.name,
      host: profile.host,
      user: profile.user,
      port: profile.port,
      identityFile: profile.identityFile,
      extraArgs: profile.extraArgs,
      initialDirectory: profile.initialDirectory,
    });
    const source = Object.freeze({
      path,
      project: root,
      profile: connection,
      key: fileReadCacheKey(path, { kind: "ssh", root: root.cwd, connection }),
    });
    capturedSources.add(source);
    return source;
  } catch {
    return null;
  }
}

export function isCapturedProjectAttachment(
  source: ProjectAttachmentSource,
  path: string,
): boolean {
  return capturedSources.has(source) && source.path === path;
}
