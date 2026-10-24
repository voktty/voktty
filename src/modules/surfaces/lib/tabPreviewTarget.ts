import type { Tab } from "@/modules/tabs/lib/useTabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import { tabDirectoryTarget } from "@/modules/surfaces/lib/tabDirectoryTarget";

export function tabPreviewTarget(
  tab: Tab,
  space?: { root: string | null; env: WorkspaceEnv },
) {
  const target = tabDirectoryTarget(tab, space);
  const owner =
    ("workspaceEnv" in tab ? tab.workspaceEnv : undefined) ?? space?.env;
  if (
    (tab.kind === "editor" || tab.kind === "markdown") &&
    (owner?.kind === "docker" || owner?.kind === "serial") &&
    !/^(?:[A-Za-z]:[/\\]|[/\\]{2})/.test(tab.path)
  )
    return null;
  if (
    target?.workspace.kind !== "local" ||
    !/^(?:[A-Za-z]:[/\\]|[/\\])/.test(target.path) ||
    target.path.startsWith("remote://")
  )
    return null;
  const file =
    (tab.kind === "editor" || tab.kind === "markdown") &&
    /\.(?:html?|php|svg)$/i.test(tab.path)
      ? tab.path.split(/[/\\]/).pop()
      : undefined;
  return { ...target, file };
}

export function previewTargetUrl(origin: string, file?: string) {
  return file
    ? `${origin.replace(/\/$/, "")}/${encodeURIComponent(file)}`
    : origin;
}
