import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";
import {
  requestHarnessProject,
  type HarnessProjectTarget,
} from "@/modules/surfaces/lib/harnessProjectRequest";

export const HarnessProjectOwner =
  createContext<Readonly<HarnessProjectTarget> | null>(null);

export function useHarnessProjectSelection(cwd: string) {
  const owner = useContext(HarnessProjectOwner);
  const ownerId = owner?.ownerId;
  const tabKey = owner?.tabKey;
  const lifetime = useRef<
    (Readonly<HarnessProjectTarget> & { cwd: string }) | null
  >(null);
  useLayoutEffect(() => {
    const original =
      ownerId !== undefined && tabKey ? { ownerId, tabKey, cwd } : null;
    lifetime.current = original;
    return () => {
      if (lifetime.current === original) lifetime.current = null;
    };
  }, [ownerId, tabKey, cwd]);

  return useCallback(() => {
    const original = lifetime.current;
    if (!original) return null;
    let active = true;
    const isCurrent = () => active && lifetime.current === original;
    return {
      isCurrent,
      retire: () => {
        active = false;
      },
      select: (path: string) => {
        if (!isCurrent()) return;
        active = false;
        requestHarnessProject(path, original);
      },
    };
  }, []);
}
