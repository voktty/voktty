import { useLayoutEffect, useRef } from "react";
import type { useHarnessWindow } from "@/modules/harness/components/HarnessWindowHost";
import type { HarnessWindowViewInput } from "@/modules/harness/lib/harnessWindowViews";
import type { HarnessWindowViewCohort } from "@/modules/harness/lib/harnessWindowViews";
import type { HarnessNavigationView } from "@/modules/harness/lib/harnessWindowNavigation";
import type {
  PersistenceOwner,
  PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import type { Session } from "@/modules/harness/lib/session";

type Inputs = {
  runtime: ReturnType<typeof useHarnessWindow>;
  ownerId: number;
  seeds: readonly Session[];
  revision: object;
  read: () => HarnessWindowViewInput;
  getOwner: () => PersistenceOwner | null;
  openSession: (id: string, permit: PersistencePermit) => Promise<boolean>;
  activate: () => boolean | Promise<boolean>;
  onRegistered?: (view: HarnessNavigationView) => void;
  restore?: HarnessWindowViewCohort;
};

export function useHarnessViewRegistration(inputs: Inputs) {
  const latest = useRef(inputs);
  latest.current = inputs;
  const {
    views,
    navigation: { register },
    admitSeeds,
  } = inputs.runtime;
  const { ownerId, revision } = inputs;
  const handle = useRef<ReturnType<typeof views.register> | null>(null);
  useLayoutEffect(() => {
    const original = latest.current;
    const view =
      (original.restore && views.restore(ownerId, original.restore)) ||
      views.register(ownerId, original.read());
    const cohort = views
      .getSnapshot()
      .cohorts.find((entry) => entry.ownerId === ownerId);
    const current = () =>
      view.isCurrent() && latest.current.ownerId === ownerId;
    let binding: HarnessNavigationView | null = null;
    try {
      binding = register(ownerId, {
        isCurrent: current,
        capture: () =>
          current() ? (latest.current.getOwner()?.capture() ?? null) : null,
        async openSession(id, permit) {
          if (!current() || !permit.isCurrent()) return false;
          const opened = await latest.current.openSession(id, permit);
          return opened && current() && permit.isCurrent();
        },
        activate: () => current() && latest.current.activate(),
      });
      if (!binding || !admitSeeds(original.seeds, current))
        throw new Error("Harness view registration was not admitted");
      handle.current = view;
      original.onRegistered?.(binding);
    } catch (error) {
      binding?.release();
      view.release();
      const failed = views
        .getSnapshot()
        .cohorts.find((entry) => entry.ownerId === ownerId);
      if (failed && !failed.active && failed.sequence === cohort?.sequence)
        views.retire(failed);
      if (handle.current === view) handle.current = null;
      throw error;
    }
    return () => {
      binding?.release();
      view.release();
      if (handle.current === view) handle.current = null;
    };
  }, [views, register, admitSeeds, ownerId]);
  useLayoutEffect(() => {
    const view = handle.current;
    const original = latest.current;
    if (!view?.isCurrent() || original.revision !== revision) return;
    view.update(original.read());
    original.runtime.engine.flushForegroundHarnessEvents();
  }, [revision]);
}
