import type { Tab } from "@/modules/tabs/lib/useTabs";
import { tabDirectoryTarget } from "@/modules/surfaces/lib/tabDirectoryTarget";
import { isWindowsNativePath, type WorkspaceEnv } from "@/modules/workspace";

export function isNativeFolderPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length <= 32768 &&
    !/[\x00-\x1f\x7f]/.test(path) &&
    /^(?:\/|[A-Za-z]:[/\\]|\\\\(?:[^\\?.][^\\]*\\[^\\]+|\?\\(?:[A-Za-z]:\\|UNC\\[^\\]+\\[^\\]+)))/i.test(
      path,
    )
  );
}

export function nativeFolderSource(
  source: Tab | undefined,
  space?: { root: string | null; env: WorkspaceEnv },
) {
  const target = source ? tabDirectoryTarget(source, space) : null;
  return JSON.stringify([
    source?.id,
    source?.tabKey,
    source?.kind,
    source?.spaceId,
    source?.workspaceScopeId,
    source && "path" in source ? source.path : null,
    source?.kind === "terminal" ? source.activeLeafId : null,
    target,
  ]);
}

export function nativeFolderDefaultPath(
  source: Tab | undefined,
  space: { root: string | null; env: WorkspaceEnv } | undefined,
  localLaunchCwd: string | null | undefined,
  localHome: string | null | undefined,
): string | undefined {
  const target = source ? tabDirectoryTarget(source, space) : null;
  if (
    target &&
    isNativeFolderPath(target.path) &&
    (target.workspace.kind === "local" ||
      (target.workspace.kind === "wsl" && isWindowsNativePath(target.path)))
  )
    return target.path;
  const fallback = [
    space?.env.kind === "local" ? space.root : null,
    localLaunchCwd,
    localHome,
  ];
  return fallback.find(isNativeFolderPath) ?? undefined;
}
