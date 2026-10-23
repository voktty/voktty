import { useEffect, useRef } from "react";
import type {
  PersistenceOwner,
  PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";

export function useInitialHarnessSession(
  sessionId: string | undefined,
  getOwner: () => PersistenceOwner | null,
  open: (
    sessionId: string,
    permit: PersistencePermit,
  ) => Promise<void> | Promise<boolean>,
  admissionRevision = 0,
) {
  const initializedOwner = useRef<PersistenceOwner | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Admission recovery retries only a request that was never admitted.
  useEffect(() => {
    const owner = getOwner();
    if (!sessionId || !owner || initializedOwner.current === owner) return;
    const permit = owner.capture();
    if (!permit) return;
    initializedOwner.current = owner;
    void open(sessionId, permit);
  }, [sessionId, getOwner, open, admissionRevision]);
}
