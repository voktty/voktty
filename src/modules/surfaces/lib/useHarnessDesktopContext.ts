import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import type { Tab } from "@/modules/tabs";
import { coerceCwd } from "@/modules/surfaces/lib/cwd";
import { resolveActiveSurface } from "@/modules/surfaces/lib/activeSurface";
import { selectHarnessSurface, useHarnessSurfaceStore } from "@/modules/surfaces/lib/harnessSurfaceStore";
import { harnessProjectTargetMatches, parseHarnessProjectRequest, requestHarnessProject } from "@/modules/surfaces/lib/harnessProjectRequest";

type Props = {
  activeTab: Tab | undefined;
  tabsRef: RefObject<Tab[]>;
  updateTab: (id: number, patch: { cwd: string }) => void;
  lastProjectPath: () => string | null;
};

export function useHarnessDesktopContext({ activeTab, tabsRef, updateTab, lastProjectPath }: Props) {
  const [fallback, setProjectFallback] = useState<string | null>(() => {
    try { return lastProjectPath(); } catch { return null; }
  });
  const harness = activeTab?.kind === "harness" ? activeTab : undefined;
  const ownerId = harness?.id;
  const tabKey = harness?.tabKey;
  const sourceCwd = harness?.cwd;
  const navigation = useMemo(() => ({ current: false, ownerId, tabKey, sourceCwd }), [ownerId, tabKey, sourceCwd]);
  useLayoutEffect(() => {
    navigation.current = true;
    return () => { navigation.current = false; };
  }, [navigation]);
  const selectProject = useCallback((path: string) => {
    const { ownerId, tabKey, sourceCwd } = navigation;
    if (ownerId === undefined || tabKey === undefined) return;
    const target = { ownerId, tabKey };
    if (!parseHarnessProjectRequest({ path, target })) return;
    const current = () => navigation.current && tabsRef.current.some((tab) =>
      tab.kind === "harness" && harnessProjectTargetMatches(target, tab) && tab.cwd === sourceCwd);
    if (!current()) return;
    requestHarnessProject(path, target);
    if (current()) setProjectFallback((previous) => current() ? path : previous);
  }, [navigation, tabsRef]);
  const focusFolder = useHarnessSurfaceStore((state) => ownerId === undefined
    ? null : selectHarnessSurface(state, ownerId).focusFolder);
  const reportedProject = useHarnessSurfaceStore((state) => ownerId === undefined
    ? null : selectHarnessSurface(state, ownerId).projectCwd);
  const projectCwd = harness ? harness.cwd || fallback || lastProjectPath() : null;
  const folder = harness ? resolveActiveSurface({ kind: "harness", projectCwd, focusFolder }).folder : null;
  const workspaceTab = useMemo(() => harness && folder ? { ...harness, cwd: folder } : activeTab,
    [activeTab, harness, folder]);

  useEffect(() => {
    if (ownerId === undefined) return;
    const cwd = coerceCwd(reportedProject);
    if (cwd === null) return;
    const current = tabsRef.current.find((tab) => tab.id === ownerId);
    if (current?.kind !== "harness" || current.tabKey !== tabKey) return;
    setProjectFallback(cwd);
    if (current.cwd !== cwd) updateTab(current.id, { cwd });
  }, [ownerId, tabKey, reportedProject, tabsRef, updateTab]);

  return { projectCwd, folder, workspaceTab, setProjectFallback, selectProject };
}
