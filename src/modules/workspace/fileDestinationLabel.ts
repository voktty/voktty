import { isWindowsNativePath, type WorkspaceEnv } from "@/modules/workspace";

export function fileDestinationLabel(
  path: string,
  workspace: WorkspaceEnv | undefined,
  localLabel: string,
  serialLabel: string,
): string {
  if (!workspace || workspace.kind === "local" || isWindowsNativePath(path))
    return localLabel;
  if (workspace.kind === "wsl") return `WSL · ${workspace.distro}`;
  if (workspace.kind === "ssh") {
    const { name, host, user, port } = workspace.connection;
    const hostname =
      host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return ["SSH", name, `${user ? `${user}@` : ""}${hostname}:${port ?? 22}`]
      .filter(Boolean)
      .join(" · ");
  }
  if (workspace.kind === "docker")
    return `Docker · ${workspace.connection.containerName || workspace.connection.containerId}`;
  return `${serialLabel} · ${workspace.portName}`;
}
