import { projectKey } from "./paths";
import { clearProjectLogo } from "./projectLogos";
import { clearProjectChatBackground } from "./chatBackground";
import { clearProjectChatBackgroundSetting } from "./projectChatBackground";
import { isRemoteProjectPath, normalizeProjectPath } from "./recents";
import { deleteSession, listSessionsByProject } from "./sessionStore";
import { clearTabGroupSettings } from "./tabGroups";
import { removeProjectGroupAssignment } from "./projectGroups";
import { forgetRemoteProject } from "@/modules/connections/model/remoteProjects";
import {
  windowPersistenceAdmission,
  type PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import { normalizeHarnessSessionViewReport } from "@/modules/harness/lib/harnessSessionViews";

/** Saved chats filed under this project, so the confirm prompt can count them. */
export async function projectSessionCount(path: string): Promise<number> {
  const sessions = await listSessionsByProject(path).catch(() => []);
  return sessions.length;
}

/** Everything we persist for a project: saved chats plus its rail appearance. */
export async function removeProjectData(
  path: string,
  permit?: PersistencePermit,
  liveSessionIds: readonly string[] = [],
): Promise<boolean> {
  const owner = permit ? null : windowPersistenceAdmission.createOwner();
  const request = permit ?? owner?.capture();
  try {
    if (!request?.isCurrent()) return false;
    const capturedIds = normalizeHarnessSessionViewReport({
      referencedSessionIds: liveSessionIds,
    }).referencedSessionIds;
    const normalized = normalizeProjectPath(path);
    const key = projectKey(normalized);
    // Remote conversations belong to the project's `.voktty` folder.
    const sessions = isRemoteProjectPath(normalized)
      ? []
      : await listSessionsByProject(normalized).catch(() => []);
    const write = async (action: () => unknown | Promise<unknown>) => {
      if (!request.isCurrent()) return false;
      const admitted = await request.run(async () => {
        if (request.isCurrent()) await action();
      });
      return admitted && request.isCurrent();
    };
    const ids = isRemoteProjectPath(normalized)
      ? []
      : [
          ...new Set([
            ...capturedIds,
            ...sessions.map((session) => session.id),
          ]),
        ];
    for (const id of ids) {
      if (!(await write(() => deleteSession(id).catch(() => undefined))))
        return false;
    }
    if (!(await write(() => clearProjectLogo(key).catch(() => undefined))))
      return false;
    if (
      !(await write(() =>
        clearProjectChatBackground(key).catch(() => undefined),
      ))
    )
      return false;
    return await write(() => {
      if (request.isCurrent()) clearProjectChatBackgroundSetting(key);
      if (request.isCurrent()) clearTabGroupSettings(key);
      if (request.isCurrent()) removeProjectGroupAssignment(normalized);
      if (request.isCurrent()) forgetRemoteProject(normalized);
    });
  } finally {
    owner?.retire();
  }
}
