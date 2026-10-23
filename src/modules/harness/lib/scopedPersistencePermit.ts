import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";

export function restrictPersistencePermit(
  permit: PersistencePermit,
  guard: () => boolean,
): PersistencePermit {
  const isCurrent = () => permit.isCurrent() && guard();
  return {
    isCurrent,
    run: (write) => {
      if (!isCurrent()) return Promise.resolve(false);
      return permit.run(async () => {
        if (isCurrent()) await write();
      });
    },
    seal: () => null,
  };
}
