import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceEnv } from "@/modules/workspace";
import { nextVisibleRoot } from "@/modules/explorer/lib/visibleRoot";

export function useExplorerVisibleRoot({
  sourceRoot,
  sourceReachable,
  workspace,
  workspaceKey,
  navigationKey,
}: {
  sourceRoot: string | null;
  sourceReachable: boolean;
  workspace: WorkspaceEnv;
  workspaceKey?: string;
  navigationKey?: string;
}) {
  const filesystem = JSON.stringify(workspace);
  const workspaceRoot = workspace.kind === "ssh" ? workspace.root : null;
  const navigationFilesystem =
    workspace.kind === "ssh"
      ? JSON.stringify({
          connection: workspace.connection,
          project: workspace.restoredProjectCwd,
        })
      : filesystem;
  const navigationWorkspace =
    workspace.kind === "ssh" ? undefined : workspaceKey;
  const navigation = useMemo(
    () => ({
      sourceRoot,
      navigationKey,
      navigationFilesystem,
      navigationWorkspace,
    }),
    [sourceRoot, navigationKey, navigationFilesystem, navigationWorkspace],
  );
  const source = useMemo(
    () => ({
      sourceRoot,
      sourceReachable,
      filesystem,
      workspaceRoot,
      workspaceKey,
      navigationKey,
      navigation,
    }),
    [
      sourceRoot,
      sourceReachable,
      filesystem,
      workspaceRoot,
      workspaceKey,
      navigationKey,
      navigation,
    ],
  );
  const [state, setState] = useState(() => ({
    source,
    rootPath: sourceReachable ? sourceRoot : workspaceRoot,
  }));
  let rootPath = state.rootPath;
  if (state.source !== source) {
    rootPath = nextVisibleRoot({
      currentVisibleRoot: state.rootPath,
      previousSourceRoot: state.source.sourceRoot,
      sourceRoot,
      sourceReachable,
      workspaceRoot,
      navigationChanged:
        state.source.navigation.navigationKey !== navigationKey ||
        state.source.navigation.navigationFilesystem !== navigationFilesystem ||
        state.source.navigation.navigationWorkspace !== navigationWorkspace,
    });
    setState({ source, rootPath });
  }
  const current = useRef<typeof source | null>(null);
  useLayoutEffect(() => {
    current.current = source;
    return () => {
      if (current.current === source) current.current = null;
    };
  }, [source]);
  const navigate = useCallback(
    (path: string) => {
      if (current.current?.navigation !== navigation) return;
      setState((previous) =>
        current.current?.navigation === navigation &&
        previous.source.navigation === navigation
          ? { source: previous.source, rootPath: path }
          : previous,
      );
    },
    [navigation],
  );
  return { rootPath, navigate, source };
}
