import { normalizeHarnessSessionViewReport } from "@/modules/harness/lib/harnessSessionViews";

const KINDS = ["opening", "removing", "switching", "transfer"] as const;
export type HarnessSessionHoldKind = (typeof KINDS)[number];
const CAPACITY = 256;

export function createHarnessWindowSessionHolds() {
  const entries = new Map<
    object,
    { kind: HarnessSessionHoldKind; ids: readonly string[]; retired: boolean }
  >();
  const bySession = new Map<string, object>();
  const listeners = new Set<() => void>();
  const collect = () =>
    Object.freeze({ sessionIds: Object.freeze([...bySession.keys()].sort()) });
  let snapshot = collect();
  const publish = () => {
    snapshot = collect();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* Observers cannot undo an admitted reservation. */
      }
    }
  };
  const find = (id: string) => {
    const token = bySession.get(id);
    return token ? entries.get(token) : undefined;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (!listeners.has(listener) && listeners.size >= CAPACITY)
        throw new RangeError("Harness hold subscriber capacity exceeded");
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    has: (kind: HarnessSessionHoldKind, id: string) => find(id)?.kind === kind,
    hasAny: (id: string) => bySession.has(id),
    invalidateOpening(id: string) {
      const entry = find(id);
      if (entry?.kind === "opening") entry.retired = true;
    },
    acquire(
      kind: HarnessSessionHoldKind,
      sessionIds: readonly string[],
      isCurrent: () => boolean,
    ) {
      if (!KINDS.includes(kind))
        throw new TypeError("Invalid Harness hold kind");
      const ids = normalizeHarnessSessionViewReport({
        referencedSessionIds: sessionIds,
      }).referencedSessionIds;
      if (!isCurrent()) return null;
      if (
        !ids.length ||
        entries.size >= CAPACITY ||
        bySession.size + ids.length > CAPACITY ||
        ids.some((id) => bySession.has(id))
      )
        return null;
      const token = {};
      const entry = { kind, ids, retired: false };
      entries.set(token, entry);
      for (const id of ids) bySession.set(id, token);
      publish();
      return {
        isCurrent: () =>
          entries.get(token) === entry &&
          !entry.retired &&
          isCurrent() &&
          entries.get(token) === entry &&
          !entry.retired,
        release() {
          if (!entries.delete(token)) return;
          for (const id of ids)
            if (bySession.get(id) === token) bySession.delete(id);
          publish();
        },
      };
    },
  };
}
