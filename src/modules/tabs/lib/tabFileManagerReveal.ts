import { commandSurfaceUnavailableReason } from "@/modules/shortcuts/lib/commandSurface";
import type { WorkspaceEnv } from "@/modules/workspace";
import { getTabPath } from "@/modules/tabs/lib/tabMetadata";
import type { Tab } from "@/modules/tabs/lib/useTabs";

export const FILE_MANAGER_COMMAND = "tab.revealInFileManager";

export function tabFileManagerRevealPath(
  tab: Tab,
  workspace: WorkspaceEnv | undefined,
  windows: boolean,
): string | null {
  const path = getTabPath(tab);
  if (!path || /[\x00-\x1f\x7f]/.test(path)) return null;
  if (tab.kind === "terminal" && tab.collaboration) return null;
  const kind =
    tab.kind === "terminal" || tab.kind === "harness"
      ? tab.kind
      : tab.kind === "editor" || tab.kind === "markdown"
        ? "editor"
        : "other";
  if (commandSurfaceUnavailableReason(FILE_MANAGER_COMMAND, { kind }))
    return null;
  const nativeWindowsPath =
    /^[a-zA-Z]:[/\\]/.test(path) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/.test(path);
  const env =
    "workspaceEnv" in tab && tab.workspaceEnv
      ? tab.workspaceEnv
      : tab.kind === "harness"
        ? undefined
        : workspace;
  const document = tab.kind === "editor" || tab.kind === "markdown";
  if (
    env &&
    env.kind !== "local" &&
    !(nativeWindowsPath && (document || env.kind === "wsl"))
  )
    return null;
  if (windows) return nativeWindowsPath ? path : null;
  return path.startsWith("/") && !path.startsWith("//") ? path : null;
}
