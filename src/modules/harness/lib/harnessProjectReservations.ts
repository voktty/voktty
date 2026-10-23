import { projectKey } from "@/modules/harness/lib/paths";
import { normalizeProjectPath } from "@/modules/harness/lib/recents";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";

const CAPACITY = 256;
const keyFor = (path: string) => projectKey(normalizeProjectPath(path));

export type HarnessProjectRemovalScope = {
  path: string;
  owner: PersistencePermit;
};

export function createHarnessProjectReservations() {
  const entries = new Map<
    string,
    {
      retired: boolean;
      activity: number;
      started: boolean;
      receipt: PersistencePermit | null;
    }
  >();
  const listeners = new Set<() => void>();
  let active = true;
  const collect = () =>
    Object.freeze({ projectPaths: Object.freeze([...entries.keys()].sort()) });
  let snapshot = collect();
  const publish = () => {
    snapshot = collect();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* Observers cannot undo reservations. */
      }
    }
  };
  return {
    getSnapshot: () => snapshot,
    has: (path: string) => entries.has(keyFor(path)),
    owns(path: string, receipt: PersistencePermit) {
      const entry = entries.get(keyFor(path));
      return (
        entry?.receipt === receipt &&
        receipt.isCurrent() &&
        entries.get(keyFor(path)) === entry
      );
    },
    subscribe(listener: () => void) {
      if (!listeners.has(listener) && listeners.size >= CAPACITY)
        throw new RangeError("Harness project subscriber capacity exceeded");
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reserve(path: string, request: PersistencePermit) {
      if (!path.trim() || path.length > 4096 || path.includes("\0"))
        throw new TypeError("Invalid Harness project reservation");
      const key = keyFor(path);
      if (
        !request.isCurrent() ||
        !active ||
        entries.has(key) ||
        entries.size >= CAPACITY
      )
        return null;
      const entry = {
        retired: false,
        activity: 0,
        started: false,
        receipt: null as PersistencePermit | null,
      };
      entries.set(key, entry);
      const current = () =>
        active &&
        entries.get(key) === entry &&
        !entry.retired &&
        request.isCurrent() &&
        active &&
        entries.get(key) === entry &&
        !entry.retired;
      const finish = () => {
        if (!entry.retired || entry.activity > 0 || entries.get(key) !== entry)
          return;
        entries.delete(key);
        publish();
      };
      const receipt = {
        isCurrent: current,
        seal: () => null,
        async run(write: () => Promise<unknown>) {
          if (!current()) return false;
          entry.activity++;
          let accepted = false;
          try {
            accepted = await request.run(async () => {
              if (current()) await write();
            });
            accepted = accepted && current();
            return accepted;
          } finally {
            if (!accepted) entry.retired = true;
            entry.activity--;
            finish();
          }
        },
        async perform(action: () => Promise<boolean>) {
          if (entry.started || !current()) return false;
          entry.started = true;
          entry.activity++;
          let accepted = false;
          try {
            accepted = (await action()) && current();
            return accepted;
          } finally {
            if (!accepted) entry.retired = true;
            entry.activity--;
            finish();
          }
        },
        release() {
          entry.retired = true;
          finish();
        },
      };
      entry.receipt = receipt;
      publish();
      if (!current()) {
        receipt.release();
        return null;
      }
      return receipt;
    },
    dispose() {
      active = false;
      for (const [key, entry] of entries) {
        entry.retired = true;
        if (entry.activity === 0) entries.delete(key);
      }
      publish();
    },
  };
}
