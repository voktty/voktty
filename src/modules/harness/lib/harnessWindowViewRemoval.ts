import {
  harnessViewSessionReferences,
  type createHarnessWindowViews,
} from "@/modules/harness/lib/harnessWindowViews";
import type { createHarnessWindowSessionHolds } from "@/modules/harness/lib/harnessWindowSessionHolds";
import { normalizeHarnessSessionViewReport } from "@/modules/harness/lib/harnessSessionViews";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
import { restrictPersistencePermit } from "@/modules/harness/lib/scopedPersistencePermit";
import { removeRetainedSessionReferences } from "@/modules/harness/lib/retainedSessionReferences";

export type PreparedHarnessViewRemoval = {
  isCurrent: () => boolean;
  commit: () => Promise<boolean>;
};
export type HarnessViewRemovalTarget = {
  isCurrent: () => boolean;
  capture: () => PersistencePermit | null;
  prepare: (
    ids: readonly string[],
    permit: PersistencePermit,
  ) => Promise<PreparedHarnessViewRemoval | null>;
};

export function createHarnessWindowViewRemoval(
  views: ReturnType<typeof createHarnessWindowViews>,
  holds: ReturnType<typeof createHarnessWindowSessionHolds>,
) {
  const targets = new Map<number, { target: HarnessViewRemovalTarget }>();
  const operations = new Set<() => void>();
  let active = true;
  const activeOwner = (id: number) =>
    views
      .getSnapshot()
      .cohorts.some((cohort) => cohort.ownerId === id && cohort.active);
  return {
    register(ownerId: number, input: HarnessViewRemovalTarget) {
      if (!Number.isSafeInteger(ownerId) || ownerId < 1)
        throw new TypeError("Invalid Harness removal owner");
      if (!active || !activeOwner(ownerId) || !input.isCurrent()) return null;
      if (!targets.has(ownerId) && targets.size >= 256)
        throw new RangeError("Harness removal target capacity exceeded");
      const entry = { target: Object.freeze({ ...input }) };
      targets.set(ownerId, entry);
      return {
        release() {
          if (targets.get(ownerId) === entry) targets.delete(ownerId);
        },
      };
    },
    async prepare(
      sourceOwnerId: number | null,
      sessionIds: readonly string[],
      request: PersistencePermit,
      kind: "removing" | "transfer" = "removing",
    ) {
      if (
        sourceOwnerId !== null &&
        (!Number.isSafeInteger(sourceOwnerId) || sourceOwnerId < 1)
      )
        throw new TypeError("Invalid Harness removal source");
      if (kind !== "removing" && kind !== "transfer")
        throw new TypeError("Invalid Harness removal kind");
      const ids = normalizeHarnessSessionViewReport({
        referencedSessionIds: sessionIds,
      }).referencedSessionIds;
      if (!active || !request.isCurrent()) return null;
      const hold = holds.acquire(kind, ids, request.isCurrent);
      if (!hold) return null;
      let retired = false;
      let activity = 1;
      let committed = false;
      let started = false;
      let commitPromise: Promise<boolean> | undefined;
      const prepared: Array<{
        action: PreparedHarnessViewRemoval;
        permit: PersistencePermit;
      }> = [];
      const finish = () => {
        if (!retired || activity > 0) return;
        hold.release();
        operations.delete(release);
        prepared.length = 0;
      };
      const release = () => {
        retired = true;
        finish();
      };
      operations.add(release);
      const current = () =>
        active &&
        !retired &&
        request.isCurrent() &&
        hold.isCurrent() &&
        active &&
        !retired;
      const affected = (
        cohort: ReturnType<typeof views.getSnapshot>["cohorts"][number],
      ) => {
        const refs = harnessViewSessionReferences(cohort.state);
        for (const [, id] of cohort.state.returnTargets) refs.add(id);
        return ids.some((id) => refs.has(id));
      };
      let admitted = false;
      try {
        if (!current()) return null;
        const captured = views
          .getSnapshot()
          .cohorts.filter(
            (cohort) => cohort.ownerId !== sourceOwnerId && affected(cohort),
          );
        const retained = captured.filter((cohort) => !cohort.active);
        const retainedCurrent = () =>
          retained.every((cohort) =>
            views.getSnapshot().cohorts.includes(cohort),
          );
        for (const cohort of retained)
          if (!removeRetainedSessionReferences(cohort.state, ids)) return null;
        for (const cohort of captured.filter((cohort) => cohort.active)) {
          if (!current() || !retainedCurrent()) return null;
          const entry = targets.get(cohort.ownerId);
          if (!entry?.target.isCurrent()) return null;
          const original = entry.target.capture();
          if (!original) return null;
          const permit = restrictPersistencePermit(
            original,
            () =>
              current() &&
              targets.get(cohort.ownerId) === entry &&
              activeOwner(cohort.ownerId) &&
              entry.target.isCurrent(),
          );
          if (!permit.isCurrent()) return null;
          const action = await entry.target.prepare(ids, permit);
          if (!action) return null;
          const owned = Object.freeze({ ...action });
          if (!permit.isCurrent() || !owned.isCurrent()) return null;
          prepared.push({ action: owned, permit });
        }
        if (
          !current() ||
          !retainedCurrent() ||
          prepared.some(
            (item) => !item.permit.isCurrent() || !item.action.isCurrent(),
          )
        )
          return null;
        admitted = true;
        return {
          isCurrent: current,
          seal: () => null,
          async perform(action: () => Promise<boolean>): Promise<boolean> {
            if (started || !current()) return false;
            started = true;
            activity++;
            let accepted = false;
            try {
              accepted = (await action()) && current();
              return accepted;
            } finally {
              if (!accepted) retired = true;
              activity--;
              finish();
            }
          },
          async run(write: () => Promise<unknown>): Promise<boolean> {
            if (!committed || !current()) return false;
            activity++;
            let accepted = false;
            try {
              const admitted = await request.run(async () => {
                if (current()) await write();
              });
              accepted = admitted && current();
              return accepted;
            } finally {
              if (!accepted) retired = true;
              activity--;
              finish();
            }
          },
          commit(): Promise<boolean> {
            if (commitPromise) return commitPromise;
            if (!current()) return Promise.resolve(false);
            commitPromise = (async () => {
              activity++;
              let accepted = false;
              try {
                for (const item of prepared) {
                  if (
                    !current() ||
                    !retainedCurrent() ||
                    !item.permit.isCurrent() ||
                    !item.action.isCurrent()
                  )
                    return false;
                  const applied = await item.action.commit();
                  if (!applied || !item.permit.isCurrent() || !current())
                    return false;
                }
                if (!current() || !retainedCurrent()) return false;
                for (const cohort of retained)
                  if (!views.pruneRetained(cohort, ids, current)) return false;
                if (
                  !current() ||
                  views
                    .getSnapshot()
                    .cohorts.some(
                      (cohort) =>
                        cohort.ownerId !== sourceOwnerId && affected(cohort),
                    )
                )
                  return false;
                committed = true;
                accepted = true;
                return true;
              } finally {
                if (!accepted) retired = true;
                activity--;
                finish();
              }
            })();
            return commitPromise;
          },
          release,
        };
      } finally {
        if (!admitted) retired = true;
        activity--;
        finish();
      }
    },
    dispose() {
      active = false;
      targets.clear();
      for (const release of [...operations]) release();
    },
  };
}
