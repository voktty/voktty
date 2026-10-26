import type { WorkspaceEnv } from "@/modules/workspace";

export function fileReadCacheKey(
  path: string,
  workspace: WorkspaceEnv,
): string {
  const filesystem =
    workspace.kind === "ssh"
      ? [
          workspace.kind,
          workspace.root,
          workspace.sessionId,
          Object.entries(workspace.connection)
            .filter(([, value]) => value !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        ]
      : workspace.kind === "wsl"
        ? [workspace.kind, workspace.distro]
        : [workspace.kind];
  return JSON.stringify([filesystem, path]);
}
