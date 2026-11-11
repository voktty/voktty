import {
  parseRemotePath,
  remoteProjectForPath,
} from "@/modules/connections/model/remoteProjects";
import {
  remoteSshConnectionIdForEnvironment,
  remoteSshConnectionForProfile,
} from "@/modules/connections/model/remoteSshProfiles";
import { remoteSessions } from "@/modules/remote/sessionManager";
import { requestRemoteResult } from "@/modules/remote/client";
import { usePreferencesStore } from "@/modules/settings/preferences";

let pending = 0;

export async function remoteTeamFile<T>(
  operation: string,
  path: string,
  content?: string,
): Promise<T> {
  if (pending >= 256)
    throw new Error("Too many pending team filesystem operations");
  const parsed = parseRemotePath(path);
  const project = remoteProjectForPath(path);
  const connectionId =
    parsed && remoteSshConnectionIdForEnvironment(parsed.environmentId);
  const profile = usePreferencesStore
    .getState()
    .sshConnections?.find((entry) => entry.id === connectionId);
  if (!parsed || !project || !profile)
    throw new Error("The team's saved SSH project is unavailable");
  const root = project.cwd.replace(/\/+$/, "");
  if (parsed.hostPath !== root && !parsed.hostPath.startsWith(`${root}/`))
    throw new Error("Team path is outside its project");
  const relative =
    parsed.hostPath === root ? "." : parsed.hostPath.slice(root.length + 1);
  pending++;
  try {
    return await remoteSessions.use(
      { profileId: profile.id, root },
      remoteSshConnectionForProfile({ ...profile }),
      async (session) => {
        if (!session.capabilities.includes("team.fs"))
          throw new Error(
            "Update the Voktty remote helper to access team files safely",
          );
        return requestRemoteResult<T>(session.session_id, "team.fs", {
          operation,
          path: relative,
          ...(content === undefined ? {} : { content }),
        });
      },
    );
  } finally {
    pending--;
  }
}
