import { isPathInWorkspace, isPathWithinRemoteRoot } from "@/modules/remote";
import type { WorkspaceEnv } from "@/modules/workspace";

/**
 * Whether the explorer can list `path` with the filesystem it already holds.
 *
 * `isPathInWorkspace` only routes a path to a backend, so it accepts every
 * absolute remote path. A remote helper session however rejects paths outside
 * its root, so the explorer must also check that root; otherwise a `cd` above
 * the project is requested from a session that cannot serve it.
 */
export function isExplorerSourceReachable(
  env: WorkspaceEnv,
  path: string | null,
): boolean {
  if (path === null) return true;
  if (env.kind === "ssh" && env.sessionId !== undefined) {
    if (path.startsWith("remote://")) return true;
    return isPathWithinRemoteRoot(env, path);
  }
  return isPathInWorkspace(env, path);
}
