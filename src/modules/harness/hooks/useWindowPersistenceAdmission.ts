import { useCallback, useEffect, useRef, useState } from "react";
import {
  windowPersistenceAdmission,
  type PersistenceOwner,
} from "@/modules/harness/lib/persistenceAdmission";

export function useWindowPersistenceAdmission(
  onResume: () => void,
  authority: typeof windowPersistenceAdmission = windowPersistenceAdmission,
) {
  const ownerRef = useRef<PersistenceOwner | null>(null);
  const resumeRef = useRef(onResume);
  const [revision, setRevision] = useState(0);
  resumeRef.current = onResume;

  useEffect(() => {
    const owner = authority.createOwner(() => {
      resumeRef.current();
      setRevision((value) => value + 1);
    });
    ownerRef.current = owner;
    return () => {
      owner.retire();
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [authority]);

  const getOwner = useCallback(() => ownerRef.current, []);
  return { getOwner, revision };
}
