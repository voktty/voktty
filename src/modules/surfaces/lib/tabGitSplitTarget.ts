import type { Tab } from "@/modules/tabs/lib/useTabs";
import { getTabPath } from "@/modules/tabs/lib/tabMetadata";
import { findLeafCwd } from "@/modules/terminal/lib/panes";
import { parentPath } from "@/modules/explorer/lib/path";
import {
  LOCAL_WORKSPACE,
  workspaceForDocumentPath,
  type WorkspaceEnv,
} from "@/modules/workspace";

export function tabGitSplitTarget(
  tab: Tab,
  space?: { root: string | null; env: WorkspaceEnv },
) {
  if (tab.kind === "terminal" && tab.collaboration) return null;
  let path =
    ("repoRoot" in tab ? tab.repoRoot : null) ||
    (tab.kind === "terminal"
      ? findLeafCwd(tab.paneTree, tab.activeLeafId) || tab.cwd
      : getTabPath(tab)) ||
    space?.root;
  if (!path || /[\x00-\x1f\x7f]/.test(path)) return null;
  let workspace =
    ("workspaceEnv" in tab ? tab.workspaceEnv : undefined) ??
    space?.env ??
    LOCAL_WORKSPACE;
  if (workspace.kind === "serial") return null;
  if (tab.kind === "editor" || tab.kind === "markdown")
    workspace = workspaceForDocumentPath(workspace, path);
  if (!("repoRoot" in tab) && "path" in tab) path = parentPath(path);
  if (path.startsWith("remote://")) workspace = LOCAL_WORKSPACE;
  return { path, workspace };
}
