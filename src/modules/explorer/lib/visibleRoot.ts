type VisibleRootInput = {
  currentVisibleRoot: string | null;
  previousSourceRoot: string | null;
  sourceRoot: string | null;
  navigationChanged: boolean;
  sourceReachable: boolean;
  workspaceRoot: string | null;
};

export function nextVisibleRoot({
  currentVisibleRoot,
  previousSourceRoot,
  sourceRoot,
  navigationChanged,
  sourceReachable,
  workspaceRoot,
}: VisibleRootInput): string | null {
  if (!sourceReachable) {
    return navigationChanged ? workspaceRoot : currentVisibleRoot;
  }
  if (navigationChanged || sourceRoot !== previousSourceRoot) return sourceRoot;
  if (sourceRoot === null || currentVisibleRoot === null) return sourceRoot;
  return currentVisibleRoot;
}
