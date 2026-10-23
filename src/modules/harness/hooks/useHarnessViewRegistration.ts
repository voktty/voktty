import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { removeRetainedSessionReferences } from "@/modules/harness/lib/retainedSessionReferences";
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
  applyRemoval?: (
    state: HarnessWindowViewCohort["state"],
    ids: readonly string[],
  ) => void;
};

export function useHarnessViewRegistration(inputs: Inputs) {
  const latest = useRef(inputs);
  latest.current = inputs;
  const {
    views,
    navigation: { register },
    admitSeeds,
    removals,
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
    let removal: ReturnType<typeof removals.register> = null;
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
      removal = removals.register(ownerId, {
        isCurrent: current,
        capture: () =>
          current() ? (latest.current.getOwner()?.capture() ?? null) : null,
        async prepare(ids, permit, projectPath) {
          const applyRemoval = latest.current.applyRemoval;
          if (!current() || !permit.isCurrent() || !applyRemoval) return null;
          const input = latest.current.read();
          view.update(input);
          const captured = views
            .getSnapshot()
            .cohorts.find((entry) => entry.ownerId === ownerId);
          if (!captured) return null;
          const next = removeRetainedSessionReferences(
            {
              ...captured.state,
              layout: {
                ...captured.state.layout,
                // Active panes keep their live objects instead of sanitized snapshots.
                tabs: input.tabs,
                projectTerminals: input.projectTerminals,
              },
            },
            ids,
            projectPath,
          );
          if (!next) return null;
          const unchanged = () =>
            current() &&
            permit.isCurrent() &&
            views.getSnapshot().cohorts.includes(captured) &&
            latest.current.read().tabs === input.tabs;
          return {
            isCurrent: unchanged,
            async commit() {
              if (!unchanged()) return false;
              let applied = false;
              flushSync(() => {
                if (!unchanged()) return;
                applyRemoval(next, ids);
                applied = true;
              });
              if (!applied || !current() || !permit.isCurrent()) return false;
              view.update(latest.current.read());
              return current() && permit.isCurrent();
            },
          };
        },
      });
      if (!removal)
        throw new Error("Harness removal registration was not admitted");
      handle.current = view;
      original.onRegistered?.(binding);
    } catch (error) {
      removal?.release();
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
      removal?.release();
      binding?.release();
      view.release();
      if (handle.current === view) handle.current = null;
    };
  }, [views, register, admitSeeds, removals, ownerId]);
  useLayoutEffect(() => {
    const view = handle.current;
    const original = latest.current;
    if (!view?.isCurrent() || original.revision !== revision) return;
    view.update(original.read());
    original.runtime.engine.flushForegroundHarnessEvents();
  }, [revision]);
}
