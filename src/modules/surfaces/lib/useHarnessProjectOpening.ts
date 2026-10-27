import { useCallback, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { Tab } from "@/modules/tabs";
import { harnessProjectTargetMatches, parseHarnessProjectRequest, requestHarnessProject, subscribeHarnessProjectOpenings, type HarnessProjectTarget } from "@/modules/surfaces/lib/harnessProjectRequest";

type Props = {
  spaceId: string;
  selectedTabKey: string | undefined;
  localRoot: string | undefined;
  tabsRef: RefObject<Tab[]>;
  getTab: (id: number) => Tab | undefined;
  newHarnessTab: (spaceId?: string, cwd?: string) => number;
  activateTab: (id: number) => void;
  createWorktree: (root: string, name: string) => Promise<string>;
  onError: (error: unknown) => void;
  onMissingProject: () => void;
};

export function useHarnessProjectOpening({ spaceId, selectedTabKey, localRoot, tabsRef, getTab, newHarnessTab, activateTab, createWorktree, onError, onMissingProject }: Props) {
  const binding = useMemo(() => ({ spaceId, selectedTabKey, localRoot }), [spaceId, selectedTabKey, localRoot]);
  const lifetime = useRef<{ binding: typeof binding; current: boolean } | null>(null);
  const pending = useRef(0);
  useLayoutEffect(() => {
    const owner = { binding, current: true };
    lifetime.current = owner;
    return () => { owner.current = false; };
  }, [binding]);
  const capture = useCallback(() => {
    const owner = lifetime.current;
    return owner?.binding === binding && owner.current ? owner : null;
  }, [binding]);

  const openProject = useCallback((path: string) => {
    const owner = capture();
    if (!owner || !parseHarnessProjectRequest({ path })) return;
    const id = newHarnessTab(spaceId, path);
    if (!owner.current) return;
    const tab = getTab(id);
    if (tab?.kind !== "harness" || tab.spaceId !== spaceId) return;
    const target = { ownerId: id, tabKey: tab.tabKey };
    activateTab(id);
    const current = getTab(id);
    if (owner.current && current?.spaceId === spaceId && harnessProjectTargetMatches(target, current))
      requestHarnessProject(path, target);
  }, [capture, spaceId, newHarnessTab, getTab, activateTab]);

  const openNewHarness = useCallback(() => {
    if (!capture()) return;
    const id = newHarnessTab(spaceId, localRoot);
    activateTab(id);
  }, [capture, newHarnessTab, spaceId, localRoot, activateTab]);

  const openNewHarnessInWorktree = useCallback(async () => {
    const owner = capture();
    if (!owner) return;
    if (!localRoot) { onMissingProject(); return; }
    if (pending.current >= 256) {
      onError(new Error("Too many pending worktree requests."));
      return;
    }
    const candidates = tabsRef.current.filter((tab) => tab.kind === "harness" && tab.spaceId === spaceId);
    const original = candidates.find((tab) => tab.tabKey === selectedTabKey) ?? candidates[0];
    const target: HarnessProjectTarget | undefined = original ? { ownerId: original.id, tabKey: original.tabKey } : undefined;
    const isCurrent = () => {
      if (!owner.current) return false;
      if (!target) return true;
      const tab = getTab(target.ownerId);
      return !!tab && tab.spaceId === spaceId && harnessProjectTargetMatches(target, tab);
    };
    pending.current++;
    try {
      const path = await createWorktree(localRoot, crypto.randomUUID());
      if (!isCurrent()) return;
      if (target) {
        activateTab(target.ownerId);
        requestHarnessProject(path, target);
      } else {
        openProject(path);
      }
    } catch (error) {
      if (isCurrent()) onError(error);
    } finally {
      pending.current--;
    }
  }, [capture, localRoot, tabsRef, spaceId, selectedTabKey, getTab, createWorktree, activateTab, openProject, onError, onMissingProject]);

  useLayoutEffect(() => subscribeHarnessProjectOpenings(openProject), [openProject]);

  return { openNewHarness, openNewHarnessInWorktree };
}
