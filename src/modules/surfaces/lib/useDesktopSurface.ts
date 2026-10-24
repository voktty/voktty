import { useCallback, useEffect, useMemo, useRef } from "react";
import { desktopSurfaceInput, surfaceDirectoryTarget, type DesktopSurfaceSelection } from "@/modules/surfaces/lib/desktopSurface";
import { publishActiveSurface, useActiveSurfaceStore } from "@/modules/surfaces/lib/activeSurfaceStore";

export function useDesktopSurface({ ownerId, tabKind, projectCwd, focusFolder, cwd, editorFolder, workspaceEnv }: DesktopSurfaceSelection) {
  useEffect(() => {
    publishActiveSurface(desktopSurfaceInput({ ownerId, tabKind, projectCwd, focusFolder, cwd, editorFolder, workspaceEnv }));
  }, [ownerId, tabKind, projectCwd, focusFolder, cwd, editorFolder, workspaceEnv]);
}

export function useSurfaceDirectoryNavigation(ownerId: number | undefined, selectProject: (path: string) => void, sendCd: (path: string) => void) {
  const operation = useMemo(() => ({ ownerId, selectProject, sendCd }), [ownerId, selectProject, sendCd]);
  const latest = useRef(operation);
  latest.current = operation;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return useCallback((path: string) => {
    if (!mounted.current || latest.current !== operation) return;
    const target = surfaceDirectoryTarget(useActiveSurfaceStore.getState().surface, path);
    if (target?.ownerId !== operation.ownerId) return;
    if (target?.kind === "project") selectProject(target.path);
    else if (target?.kind === "terminal") sendCd(target.path);
  }, [operation, selectProject, sendCd]);
}
