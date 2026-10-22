export type PersistencePermit = {
  isCurrent: () => boolean;
  run: (write: () => Promise<unknown>) => Promise<boolean>;
  seal: () => PersistenceFinal | null;
};

export type PersistenceFinal = PersistencePermit & {
  pending: Promise<void> | null;
  cancel: () => void;
};

export type PersistenceOwner = {
  capture: () => PersistencePermit | null;
  retire: () => void;
};

const MAX_PENDING_WRITES = 256;

export function createPersistenceAdmission() {
  const pending = new Set<Promise<void>>();
  const owners = new Set<{ resume?: () => void; denied: boolean }>();
  let epoch = 0;
  let sealed: PersistenceFinal | null = null;
  let backpressure = false;

  const notify = (onlyDenied = false) => {
    for (const owner of [...owners]) {
      if (!owners.has(owner) || (onlyDenied && !owner.denied)) continue;
      owner.denied = false;
      try {
        owner.resume?.();
      } catch {
        // A departed subscriber must not prevent other owners from resuming.
      }
    }
  };

  const run = async (
    registration: { denied: boolean },
    current: () => boolean,
    write: () => Promise<unknown>,
  ): Promise<boolean> => {
    if (!current()) return false;
    if (pending.size >= MAX_PENDING_WRITES) {
      registration.denied = true;
      backpressure = true;
      return false;
    }
    let settled!: () => void;
    const receipt = new Promise<void>((resolve) => {
      settled = resolve;
    });
    pending.add(receipt);
    try {
      await write();
      return true;
    } finally {
      pending.delete(receipt);
      settled();
      if (backpressure && !sealed && pending.size < MAX_PENDING_WRITES) {
        backpressure = false;
        notify(true);
      }
    }
  };

  return {
    createOwner(resume?: () => void): PersistenceOwner {
      const registration = { resume, denied: false };
      let active = true;
      let ownedFinal: PersistenceFinal | null = null;
      owners.add(registration);
      const owner: PersistenceOwner = {
        capture() {
          if (!active || sealed) return null;
          const capturedEpoch = epoch;
          const isCurrent = () => active && !sealed && epoch === capturedEpoch;
          return {
            isCurrent,
            run: (write) => run(registration, isCurrent, write),
            seal() {
              if (!isCurrent()) return null;
              const final: PersistenceFinal = {
                pending: pending.size
                  ? Promise.all([...pending]).then(() => undefined)
                  : null,
                isCurrent: () => active && sealed === final,
                run: (write) => run(registration, final.isCurrent, write),
                seal: () => null,
                cancel() {
                  if (sealed !== final) return;
                  sealed = null;
                  epoch++;
                  backpressure = false;
                  notify();
                },
              };
              sealed = final;
              ownedFinal = final;
              epoch++;
              return final;
            },
          };
        },
        retire() {
          if (!active) return;
          active = false;
          owners.delete(registration);
          ownedFinal?.cancel();
        },
      };
      return owner;
    },
  };
}

export const windowPersistenceAdmission = createPersistenceAdmission();
