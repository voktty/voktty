import { getTabPath } from "@/modules/tabs/lib/tabMetadata";
import { commandSurfaceUnavailableReason } from "@/modules/shortcuts/lib/commandSurface";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import {
  isWindowsNativePath,
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace";

export type TabExplorerTarget = {
  id: number;
  tabKey: Tab["tabKey"];
  spaceId: string;
  path: string;
  workspace: WorkspaceEnv;
  directory: boolean;
};
export const TAB_EXPLORER_COMMAND = "tab.revealInExplorer";

export function matchesTabExplorerTarget(
  target: TabExplorerTarget,
  tabs: readonly Tab[],
  spaces: readonly { id: string; env?: WorkspaceEnv }[],
): boolean {
  const tab = tabs.find(
    (tab) => tab.id === target.id && tab.tabKey === target.tabKey,
  );
  if (!tab) return false;
  const current = tabExplorerTarget(
    tab,
    spaces.find((space) => space.id === tab.spaceId)?.env,
  );
  return (
    current?.path === target.path &&
    current.spaceId === target.spaceId &&
    current.workspace === target.workspace &&
    current.directory === target.directory
  );
}

export function tabExplorerTarget(
  tab: Tab,
  owningWorkspace?: WorkspaceEnv,
): TabExplorerTarget | null {
  let path = getTabPath(tab);
  if (!path || /[\x00-\x1f\x7f]/.test(path)) return null;
  const kind =
    tab.kind === "terminal" || tab.kind === "harness"
      ? tab.kind
      : tab.kind === "editor" || tab.kind === "markdown"
        ? "editor"
        : "other";
  if (commandSurfaceUnavailableReason(TAB_EXPLORER_COMMAND, { kind }))
    return null;
  path = path.replace(/\\/g, "/");
  if (tab.kind === "terminal" && tab.collaboration) return null;
  if (
    "repoRoot" in tab &&
    "path" in tab &&
    !/^(?:[A-Za-z]:[/\\]|[/\\]|remote:\/\/)/.test(path)
  ) {
    path = `${tab.repoRoot.replace(/[/\\]+$/, "")}/${path.replace(/\\/g, "/")}`;
  }
  const namespace = remoteExplorerNamespace(path);
  if (!namespace && !/^(?:[A-Za-z]:[/\\]|[/\\])/.test(path)) return null;
  let workspace =
    "workspaceEnv" in tab
      ? (tab.workspaceEnv ?? owningWorkspace)
      : owningWorkspace;
  if (tab.kind === "harness" || namespace) workspace = LOCAL_WORKSPACE;
  else if (
    (tab.kind === "editor" || tab.kind === "markdown") &&
    isWindowsNativePath(path)
  )
    workspace = LOCAL_WORKSPACE;
  workspace ??= LOCAL_WORKSPACE;
  if (workspace.kind === "serial") return null;
  return {
    id: tab.id,
    tabKey: tab.tabKey,
    spaceId: tab.spaceId,
    path,
    workspace,
    directory: !("path" in tab),
  };
}

export function remoteExplorerNamespace(path: string): string | null {
  return /^remote:\/\/([^/]+)\//.exec(path.replace(/\\/g, "/"))?.[1] ?? null;
}

export function sameExplorerFilesystem(
  first: WorkspaceEnv,
  second: WorkspaceEnv,
): boolean {
  if (first.kind !== second.kind) return false;
  if (first.kind === "local" && second.kind === "local") return true;
  if (first.kind === "wsl" && second.kind === "wsl")
    return first.distro === second.distro;
  if (first.kind === "docker" && second.kind === "docker")
    return first.connection.containerId === second.connection.containerId;
  if (first.kind === "ssh" && second.kind === "ssh") {
    const a = first.connection;
    const b = second.connection;
    return (
      a.id === b.id &&
      a.host === b.host &&
      a.user === b.user &&
      (a.port ?? 22) === (b.port ?? 22) &&
      a.identityFile === b.identityFile &&
      a.extraArgs === b.extraArgs
    );
  }
  return false;
}

export function explorerCanReveal(
  target: TabExplorerTarget,
  root: string | null,
  workspace: WorkspaceEnv,
): boolean {
  if (!root) return false;
  const targetNamespace = remoteExplorerNamespace(target.path);
  const rootNamespace = remoteExplorerNamespace(root);
  if (targetNamespace || rootNamespace)
    return targetNamespace !== null && targetNamespace === rootNamespace;
  return sameExplorerFilesystem(target.workspace, workspace);
}
