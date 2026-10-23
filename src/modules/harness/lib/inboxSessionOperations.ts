import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
import { restrictPersistencePermit } from "@/modules/harness/lib/scopedPersistencePermit";

export function createInboxSessionOperations() {
  const entries = new Map<
    string,
    {
      mode: "open" | "restart";
      isCurrent: () => boolean;
      promise: Promise<string>;
    }
  >();
  let active = true;
  let pending = 0;
  const unavailable = () => new Error("Inbox conversation is unavailable");
  return {
    async run(
      key: string,
      mode: "open" | "restart",
      request: PersistencePermit,
      action: (permit: PersistencePermit) => Promise<string>,
    ): Promise<string> {
      if (!key || key.length > 4096)
        throw new TypeError("Invalid Inbox conversation key");
      if (mode !== "open" && mode !== "restart")
        throw new TypeError("Invalid Inbox operation");
      if (!active || !request.isCurrent()) throw unavailable();
      if (pending >= 256)
        throw new RangeError("Inbox operation capacity exceeded");
      const existing = entries.get(key);
      if (
        existing &&
        (mode !== "open" || existing.mode !== "open" || !existing.isCurrent())
      )
        throw unavailable();
      pending++;
      try {
        let entry = existing;
        if (!entry) {
          const owned = {
            mode,
            isCurrent: () => false,
            promise: Promise.resolve(""),
          };
          const permit = restrictPersistencePermit(
            request,
            () => active && entries.get(key) === owned,
          );
          owned.isCurrent = permit.isCurrent;
          owned.promise = Promise.resolve()
            .then(() => {
              if (!permit.isCurrent()) throw unavailable();
              return action(permit);
            })
            .finally(() => {
              if (entries.get(key) === owned) entries.delete(key);
            });
          entries.set(key, owned);
          entry = owned;
        }
        const id = await entry.promise;
        if (!active || !request.isCurrent()) throw unavailable();
        return id;
      } finally {
        pending--;
      }
    },
    dispose() {
      active = false;
    },
  };
}
