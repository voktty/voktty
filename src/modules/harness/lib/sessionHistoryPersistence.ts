import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
import {
  formatSessionTitle,
  type Session,
} from "@/modules/harness/lib/session";
import {
  getSession,
  setSessionArchived,
  setSessionPinned,
  shouldPersistSession,
  upsertSession,
  type SessionSummary,
} from "@/modules/harness/lib/sessionStore";

export async function renameHistorySession({
  permit,
  sessionId,
  displayTitle,
  open,
  updateOpen,
  onPersisted,
}: {
  permit: PersistencePermit;
  sessionId: string;
  displayTitle: string;
  open: Session | undefined;
  updateOpen: (session: Session) => void;
  onPersisted: (session: Session, summary: SessionSummary) => void;
}): Promise<boolean> {
  const title = displayTitle.trim();
  if (!title || !permit.isCurrent()) return false;
  const source =
    open ?? (await getSession(sessionId, permit).catch(() => null));
  if (!source || !permit.isCurrent()) return false;
  const updated = {
    ...source,
    title: formatSessionTitle(source.harness, title),
  };
  const admitted = await permit.run(async () => {
    if (open) updateOpen(updated);
    if (!permit.isCurrent()) return;
    const summary = await upsertSession(updated).catch(() => null);
    if (summary && permit.isCurrent()) onPersisted(updated, summary);
  });
  return admitted && permit.isCurrent();
}

export async function pinHistorySession({
  permit,
  sessionId,
  pinned,
  open,
  commit,
}: {
  permit: PersistencePermit;
  sessionId: string;
  pinned: boolean;
  open: Session | undefined;
  commit: () => void;
}): Promise<boolean> {
  const admitted = await permit.run(async () => {
    if (open && shouldPersistSession(open)) {
      await upsertSession(open).catch(() => undefined);
    }
    if (!permit.isCurrent()) return;
    await setSessionPinned(sessionId, pinned).catch(() => undefined);
    if (permit.isCurrent()) commit();
  });
  return admitted && permit.isCurrent();
}

export async function unarchiveHistorySession({
  permit,
  sessionId,
  commit,
}: {
  permit: PersistencePermit;
  sessionId: string;
  commit: () => void;
}): Promise<boolean> {
  const admitted = await permit.run(() => setSessionArchived(sessionId, false));
  if (!admitted || !permit.isCurrent()) return false;
  commit();
  return permit.isCurrent();
}
