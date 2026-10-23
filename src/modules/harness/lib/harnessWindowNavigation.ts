import type { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { normalizeHarnessSessionViewReport } from "@/modules/harness/lib/harnessSessionViews";
import { leafIds } from "@/modules/harness/lib/layout";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
import { restrictPersistencePermit } from "@/modules/harness/lib/scopedPersistencePermit";

export type HarnessNavigationView = Readonly<{
  ownerId: number;
  release: () => void;
}>;

export type HarnessNavigationTarget = Readonly<{
  isCurrent: () => boolean;
  capture: () => PersistencePermit | null;
  openSession: (id: string, permit: PersistencePermit) => Promise<boolean>;
  activate: () => boolean;
}>;

export type CreateHarnessNavigationView = (
  sessionId: string,
  permit: PersistencePermit,
) => Promise<HarnessNavigationView | null>;

const CAPACITY = 256;

export function createHarnessWindowNavigation(
  views: Pick<
    ReturnType<typeof createHarnessWindowViews>,
    "getSnapshot" | "subscribe"
  >,
) {
  const entries = new Map<
    number,
    {
      handle: HarnessNavigationView;
      target: HarnessNavigationTarget;
    }
  >();
  const pending = new Set<string>();
  const listeners = new Set<() => void>();
  let revision = 0;
  let snapshot = Object.freeze({ revision, views: views.getSnapshot() });
  const publish = () => {
    revision++;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* Admission does not depend on observers. */
      }
    }
  };
  const candidates = () =>
    views
      .getSnapshot()
      .cohorts.filter(
        (cohort) =>
          cohort.active && entries.get(cohort.ownerId)?.target.isCurrent(),
      );
  const choose = (sessionId: string) => {
    const available = candidates();
    const selected = views.getSnapshot().selectedOwnerId;
    const owning = available.filter((cohort) =>
      cohort.state.layout.tabs.some((tab) =>
        leafIds(tab.layout).includes(sessionId),
      ),
    );
    return (
      owning.find((cohort) => cohort.ownerId === selected) ??
      owning[0] ??
      available.find((cohort) => cohort.ownerId === selected) ??
      available[0]
    );
  };
  return {
    getSnapshot() {
      const current = views.getSnapshot();
      if (snapshot.revision !== revision || snapshot.views !== current)
        snapshot = Object.freeze({ revision, views: current });
      return snapshot;
    },
    subscribe(listener: () => void) {
      if (listeners.size >= CAPACITY)
        throw new RangeError("Harness navigation subscriber capacity exceeded");
      listeners.add(listener);
      const stop = views.subscribe(listener);
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
    hasTarget: () => candidates().length > 0,
    register(
      ownerId: number,
      input: HarnessNavigationTarget,
    ): HarnessNavigationView | null {
      if (!Number.isSafeInteger(ownerId) || ownerId < 1)
        throw new TypeError("Invalid Harness navigation owner");
      if (
        !views
          .getSnapshot()
          .cohorts.some(
            (cohort) => cohort.ownerId === ownerId && cohort.active,
          ) ||
        !input.isCurrent()
      )
        return null;
      if (!entries.has(ownerId) && entries.size >= CAPACITY)
        throw new RangeError("Harness navigation view capacity exceeded");
      const target = Object.freeze({ ...input });
      const handle: HarnessNavigationView = Object.freeze({
        ownerId,
        release() {
          if (entries.get(ownerId)?.handle !== handle) return;
          entries.delete(ownerId);
          publish();
        },
      });
      entries.set(ownerId, { handle, target });
      publish();
      return handle;
    },
    async openSession(
      sessionId: string,
      request: PersistencePermit,
      createView?: CreateHarnessNavigationView,
    ): Promise<boolean> {
      normalizeHarnessSessionViewReport({ referencedSessionIds: [sessionId] });
      if (
        !request.isCurrent() ||
        pending.has(sessionId) ||
        pending.size >= CAPACITY
      )
        return false;
      pending.add(sessionId);
      try {
        const chosen = choose(sessionId);
        let entry = chosen ? entries.get(chosen.ownerId) : undefined;
        if (!entry && createView) {
          if (!request.isCurrent()) return false;
          const created = await createView(sessionId, request);
          if (!created || !request.isCurrent()) return false;
          const registered = entries.get(created.ownerId);
          if (registered?.handle !== created) return false;
          entry = registered;
        }
        if (!entry || !request.isCurrent()) return false;
        const captured = entry;
        const viewPermit = captured.target.capture();
        if (!viewPermit) return false;
        const permit = restrictPersistencePermit(
          viewPermit,
          () =>
            request.isCurrent() &&
            entries.get(captured.handle.ownerId) === captured &&
            captured.target.isCurrent() &&
            views
              .getSnapshot()
              .cohorts.some(
                (cohort) =>
                  cohort.active && cohort.ownerId === captured.handle.ownerId,
              ),
        );
        if (!permit.isCurrent()) return false;
        const opened = await captured.target.openSession(sessionId, permit);
        if (!opened || !permit.isCurrent()) return false;
        return captured.target.activate() && permit.isCurrent();
      } finally {
        pending.delete(sessionId);
      }
    },
  };
}
