import type {
  PersistenceOwner,
  PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import { restrictPersistencePermit } from "@/modules/harness/lib/scopedPersistencePermit";
import type { Session } from "@/modules/harness/lib/session";

export async function openSessionNavigation({
  sessionId,
  owner,
  request,
  begin,
  load,
  commit,
}: {
  sessionId: string;
  owner: PersistenceOwner | null;
  request?: PersistencePermit;
  begin: () => void;
  load: (id: string, permit: PersistencePermit) => Promise<Session | null>;
  commit: (session: Session, permit: PersistencePermit) => boolean;
}): Promise<boolean> {
  if (request && !request.isCurrent()) return false;
  const viewPermit = owner?.capture();
  if (!viewPermit) return false;
  const permit = restrictPersistencePermit(
    viewPermit,
    () => !request || request.isCurrent(),
  );
  if (!permit.isCurrent()) return false;
  try {
    begin();
    if (!permit.isCurrent()) return false;
    const session = await load(sessionId, permit);
    if (!session || session.id !== sessionId || !permit.isCurrent())
      return false;
    return commit(session, permit) && permit.isCurrent();
  } catch (error) {
    if (!permit.isCurrent()) return false;
    throw error;
  }
}
