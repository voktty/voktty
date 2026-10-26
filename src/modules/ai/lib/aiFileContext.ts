import type { Tab } from "@/modules/tabs";
import { tabDirectoryTarget } from "@/modules/surfaces/lib/tabDirectoryTarget";
import { isWindowsNativePath, type WorkspaceEnv } from "@/modules/workspace";

export type AiFileContext = {
  directory: string;
  workspace: WorkspaceEnv;
};

export function resolveAiFileContext(
  tab: Tab | undefined,
  terminalWorkspace?: WorkspaceEnv,
): AiFileContext | null {
  if (!tab || (tab.kind === "terminal" && (tab.private || tab.collaboration)))
    return null;
  const workspace =
    tab.kind === "terminal"
      ? (terminalWorkspace ?? tab.workspaceEnv)
      : "workspaceEnv" in tab
        ? tab.workspaceEnv
        : undefined;
  const nativeDocument = "path" in tab && isWindowsNativePath(tab.path);
  if (
    !nativeDocument &&
    (workspace?.kind === "docker" || workspace?.kind === "serial")
  )
    return null;
  const target = tabDirectoryTarget(
    tab.kind === "terminal" ? { ...tab, workspaceEnv: workspace } : tab,
  );
  if (!target || target.path.startsWith("remote://")) return null;
  let directory = target.path;
  if (
    (tab.kind === "editor" || tab.kind === "markdown") &&
    tab.path.startsWith("/") &&
    !nativeDocument
  )
    directory = tab.path.slice(0, Math.max(1, tab.path.lastIndexOf("/")));
  if (!directory.startsWith("/") && !isWindowsNativePath(directory))
    return null;
  return { directory, workspace: structuredClone(target.workspace) };
}
