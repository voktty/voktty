import { isWindowsNativePath, type WorkspaceEnv } from "@/modules/workspace";

export function isLocalLspDocument(
  path: string | null,
  workspace: WorkspaceEnv | undefined,
): boolean {
  if (
    !path ||
    !workspace ||
    path.length > 32768 ||
    /[\u0000-\u001f\u007f]/.test(path)
  )
    return false;
  if (isWindowsNativePath(path)) return true;
  return workspace.kind === "local" && path.startsWith("/");
}
