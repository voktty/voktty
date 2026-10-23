import type { WorkspaceEnv } from "@/modules/workspace";

export function terminalRestoreProject(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 32768 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    return undefined;
  const match = /^remote:\/\/([A-Za-z0-9_.~%-]+)\/(.*)$/.exec(value);
  if (!match) return undefined;
  const environmentId = match[1];
  if (environmentId.length > 1024) return undefined;
  let profileId = environmentId;
  if (environmentId.startsWith("voktty-ssh-")) {
    try {
      profileId = decodeURIComponent(environmentId.slice("voktty-ssh-".length));
    } catch {
      return undefined;
    }
    if (
      !profileId ||
      profileId.trim() !== profileId ||
      profileId.length > 256 ||
      /[\x00-\x1f\x7f]/.test(profileId)
    )
      return undefined;
  }
  if (profileId.length > 256) return undefined;
  const hostPath = /^[A-Za-z]:\//.test(match[2]) ? match[2] : `/${match[2]}`;
  if (hostPath.includes("\\")) return undefined;
  return { projectCwd: value, environmentId, profileId, hostPath };
}

export function terminalRestoreCwd(projectCwd: string, value?: string): string {
  const project = terminalRestoreProject(projectCwd);
  if (!project) throw new Error("Remote terminal project is invalid.");
  if (value === undefined) return project.hostPath;
  if (value.startsWith("remote://")) {
    const folder = terminalRestoreProject(value);
    if (!folder || folder.environmentId !== project.environmentId)
      throw new Error("Remote terminal folder belongs to another connection.");
    return folder.hostPath;
  }
  if (
    !value ||
    value.length > 32768 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    (!value.startsWith("/") && !/^[A-Za-z]:[/\\]/.test(value))
  )
    throw new Error("Remote terminal requires an absolute folder.");
  return value.replace(/\\/g, "/");
}

export function terminalRestorePath(projectCwd: string, cwd?: string): string {
  const project = terminalRestoreProject(projectCwd);
  if (!project) throw new Error("Remote terminal project is invalid.");
  const path = terminalRestoreCwd(projectCwd, cwd);
  return `remote://${project.environmentId}/${path.startsWith("//") ? path.slice(1) : path.replace(/^\/+/, "")}`;
}

export function terminalRestoreWorkspace(
  projectCwd: string,
): Extract<WorkspaceEnv, { kind: "ssh" }> {
  const project = terminalRestoreProject(projectCwd);
  if (!project) throw new Error("Remote terminal project is invalid.");
  return {
    kind: "ssh",
    restoredProjectCwd: project.projectCwd,
    root: project.hostPath,
    connection: { id: project.profileId, name: project.profileId, host: "" },
  };
}

export function isTerminalRestoreResolution(
  before: WorkspaceEnv | undefined,
  after: WorkspaceEnv,
  projectCwd: string,
): boolean {
  const project = terminalRestoreProject(projectCwd);
  return (
    project !== undefined &&
    before?.kind === "ssh" &&
    before.sessionId === undefined &&
    after.kind === "ssh" &&
    before.restoredProjectCwd === projectCwd &&
    after.restoredProjectCwd === projectCwd &&
    after.sessionId !== undefined &&
    Number.isSafeInteger(after.sessionId) &&
    after.sessionId >= 0 &&
    (before.connection.id === after.connection.id ||
      !project.environmentId.startsWith("voktty-ssh-"))
  );
}
