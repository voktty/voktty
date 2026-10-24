import type { Tab } from "@/modules/tabs/lib/useTabs";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import { tabPreviewTarget } from "@/modules/surfaces/lib/tabPreviewTarget";
import { parentPath } from "@/modules/explorer/lib/path";

export type PreviewOpeningOptions = {
  source?: Tab;
  filesystem?: { root: string | null; workspace: WorkspaceEnv };
  splitWithActive?: boolean;
  current?: () => boolean;
};
export type PreviewDocumentAction = (
  path: string,
  current?: () => boolean,
) => unknown;
export type PreviewOpeningAction = (
  target?: string,
  options?: PreviewOpeningOptions,
) => unknown;

export function isWebPreviewablePath(path: string): boolean {
  return /\.(?:html?|php|svg)$/i.test(path);
}

export function previewOpeningTarget(
  target: string,
  source: Tab | undefined,
  space: { root: string | null; env: WorkspaceEnv } | undefined,
  filesystem?: PreviewOpeningOptions["filesystem"],
) {
  if (/[\x00-\x1f\x7f]/.test(target)) return null;
  const explicit = target;
  const webUrl = target.trim();
  if (/^https?:/i.test(webUrl)) {
    try {
      const url = new URL(webUrl);
      if (!url.hostname || url.username || url.password) return null;
      return { kind: "url" as const, url: url.href };
    } catch {
      return null;
    }
  }
  const projected = source ? tabPreviewTarget(source, space) : null;
  if (!filesystem && source && !projected) return null;
  const workspace =
    filesystem?.workspace ??
    projected?.workspace ??
    space?.env ??
    LOCAL_WORKSPACE;
  if (workspace.kind !== "local") return null;
  const path =
    explicit || filesystem?.root || projected?.path || space?.root || "";
  if (
    /[\x00-\x1f\x7f]/.test(path) ||
    path.split(/[/\\]/).some((segment) => segment === "." || segment === "..")
  )
    return null;
  const webFile = explicit && isWebPreviewablePath(explicit);
  const root = webFile ? parentPath(path) : path;
  if (
    !/^(?:[A-Za-z]:[/\\]|[/\\])/.test(root) ||
    /[\x00-\x1f\x7f]/.test(root) ||
    root.split(/[/\\]/).some((segment) => segment === "." || segment === "..")
  )
    return null;
  const file = webFile
    ? path.split(/[/\\]/).pop()
    : !explicit && !filesystem
      ? projected?.file
      : undefined;
  return { kind: "server" as const, root, file };
}
