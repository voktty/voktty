import type { HarnessNavigationView } from "@/modules/harness/lib/harnessWindowNavigation";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";

const CAPACITY = 256;
const DEADLINE_MS = 10_000;

export function createHarnessViewCreation() {
  type Waiter = {
    permit: PersistencePermit;
    resolve: (view: HarnessNavigationView | null) => void;
  };
  type Opening = {
    ownerId: number | null;
    waiters: Set<Waiter>;
    timer: ReturnType<typeof setTimeout>;
  };
  let active = true;
  let pending: Opening | null = null;
  const finish = (opening: Opening, view: HarnessNavigationView | null) => {
    if (pending !== opening) return;
    pending = null;
    clearTimeout(opening.timer);
    for (const waiter of opening.waiters)
      waiter.resolve(active && waiter.permit.isCurrent() ? view : null);
    opening.waiters.clear();
  };
  return {
    create(openTab: () => number, permit: PersistencePermit) {
      if (
        !active ||
        !permit.isCurrent() ||
        (pending?.waiters.size ?? 0) >= CAPACITY
      )
        return Promise.resolve(null);
      return new Promise<HarnessNavigationView | null>((resolve) => {
        const existing = pending;
        const opening: Opening = existing ?? {
          ownerId: null,
          waiters: new Set(),
          timer: setTimeout(() => finish(opening, null), DEADLINE_MS),
        };
        pending = opening;
        opening.waiters.add({ permit, resolve });
        if (existing) return;
        try {
          opening.ownerId = openTab();
          if (!Number.isSafeInteger(opening.ownerId) || opening.ownerId < 1)
            finish(opening, null);
        } catch {
          finish(opening, null);
        }
      });
    },
    registered(view: HarnessNavigationView) {
      const opening = pending;
      if (!opening) return;
      queueMicrotask(() => {
        if (
          active &&
          pending === opening &&
          opening.ownerId === view.ownerId &&
          view.isCurrent()
        )
          finish(opening, view);
      });
    },
    observeTabs(ids: readonly number[]) {
      if (pending?.ownerId != null && !ids.includes(pending.ownerId))
        finish(pending, null);
    },
    dispose() {
      active = false;
      if (pending) finish(pending, null);
    },
  };
}
