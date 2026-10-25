import { isNativeFolderPath } from "@/modules/explorer/lib/nativeFolderSelection";
import { isWindowsNativePath, type WorkspaceEnv } from "@/modules/workspace";

export function resolveFileActionPath(path: string, repoRoot?: string): string {
  if (
    !repoRoot ||
    /^(?:[a-zA-Z]:[/\\]|[/\\]{2}|\/|[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)/.test(path)
  )
    return path;
  const cleanRoot = repoRoot.replace(/[/\\]+$/, "");
  const cleanRel = path.replace(/^[/\\]+/, "");
  return `${cleanRoot}/${cleanRel}`;
}

export function nativeFileActionPath(
  path: string,
  workspace: WorkspaceEnv,
  windows: boolean,
): string | null {
  if (!isNativeFolderPath(path)) return null;
  const windowsPath = isWindowsNativePath(path);
  if (workspace.kind !== "local" && !(workspace.kind === "wsl" && windowsPath))
    return null;
  return (
    windows
      ? windowsPath
      : path.startsWith("/") && !path.startsWith("//")
  )
    ? path
    : null;
}
