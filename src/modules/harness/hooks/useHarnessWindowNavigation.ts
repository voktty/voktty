import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  createHarnessWindowNavigation,
  type CreateHarnessNavigationView,
} from "@/modules/harness/lib/harnessWindowNavigation";
import type { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import type {
  PersistenceOwner,
  PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import { restrictPersistencePermit } from "@/modules/harness/lib/scopedPersistencePermit";

export function useHarnessWindowNavigation(
  views: ReturnType<typeof createHarnessWindowViews>,
  getOwner: () => PersistenceOwner | null,
  createView?: CreateHarnessNavigationView,
) {
  const router = useMemo(() => createHarnessWindowNavigation(views), [views]);
  useSyncExternalStore(router.subscribe, router.getSnapshot);
  const callbacks = useRef({ getOwner, createView });
  callbacks.current = { getOwner, createView };
  const lifetime = useRef<object | null>(null);
  useEffect(() => {
    const owner = {};
    lifetime.current = owner;
    return () => {
      if (lifetime.current === owner) lifetime.current = null;
    };
  }, []);
  const openSession = useCallback(
    async (id: string, original?: PersistencePermit) => {
      const owner = lifetime.current;
      const current = callbacks.current;
      if (!owner || (original && !original.isCurrent())) return false;
      const permit = current.getOwner()?.capture();
      if (!permit) return false;
      return router.openSession(
        id,
        restrictPersistencePermit(
          permit,
          () =>
            lifetime.current === owner && (!original || original.isCurrent()),
        ),
        current.createView,
      );
    },
    [router],
  );
  return {
    register: router.register,
    openSession,
    available: !!createView || router.hasTarget(),
  };
}
