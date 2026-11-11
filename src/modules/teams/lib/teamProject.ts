import type { WorkspaceEnv } from "@/modules/workspace";

export function teamBoardProject(
  space: { root: string | null; env: WorkspaceEnv } | undefined,
  customPath?: string,
  fallback?: string | null,
): string {
  if (customPath?.startsWith("remote://")) return customPath;
  if (space?.env.kind === "ssh") {
    const root = customPath ?? space.env.root;
    if (!root.startsWith("/") || root.includes("\\") || root.includes("\0") ||
      root.split("/").some((part) => part === "." || part === "..") ||
      !root.split("/").some(Boolean)) {
      throw new Error(`Invalid remote team project: ${space.env.connection.host}:${root}`);
    }
    return `remote://voktty-ssh-${encodeURIComponent(space.env.connection.id)}${root.replace(/\/+$/, "")}`;
  }
  if (space && space.env.kind !== "local") {
    throw new Error(`Team projects are unavailable for ${space.env.kind} workspaces`);
  }
  return customPath ?? space?.root ?? fallback ?? ".";
}

export async function prepareTeamProject(projectPath: string): Promise<void> {
  if (!projectPath.startsWith("remote://")) return;
  const { parseRemotePath, remoteProjectFor, rememberRemoteProject } = await import(
    "@/modules/connections/model/remoteProjects"
  );
  const { remoteSshConnectionIdForEnvironment } = await import(
    "@/modules/connections/model/remoteSshProfiles"
  );
  const parsed = parseRemotePath(projectPath);
  if (!parsed || !remoteSshConnectionIdForEnvironment(parsed.environmentId)) {
    throw new Error("Team projects require a saved SSH connection");
  }
  if (remoteProjectFor(projectPath)) return;
  rememberRemoteProject(parsed.environmentId, {
    id: projectPath,
    cwd: parsed.hostPath,
    name: parsed.hostPath.split("/").pop() || parsed.hostPath,
  });
}
