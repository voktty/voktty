import { flushSessionCheckpoint } from "@/modules/harness/lib/checkpoint";
import type { Session } from "@/modules/harness/lib/session";
import {
  deleteSession,
  setSessionArchived,
  shouldPersistSession,
  upsertSession,
  type SessionSummary,
} from "@/modules/harness/lib/sessionStore";

export async function persistSessionRemoval({
  sessionId,
  mode,
  session,
  isCurrent,
}: {
  sessionId: string;
  mode: "archive" | "delete";
  session: Session | undefined;
  isCurrent: () => boolean;
}): Promise<{ summary?: SessionSummary } | null> {
  if (!isCurrent()) return null;
  if (session) {
    await flushSessionCheckpoint(sessionId);
    if (!isCurrent()) return null;
  }
  if (mode === "delete") {
    await deleteSession(sessionId);
    return isCurrent() ? {} : null;
  }
  let summary: SessionSummary | undefined;
  if (session && shouldPersistSession(session)) {
    const saved = await upsertSession(session);
    if (!isCurrent()) return null;
    if (!saved) throw new Error("The conversation could not be saved.");
    summary = saved;
  }
  if (!isCurrent()) return null;
  await setSessionArchived(sessionId, true);
  return isCurrent() ? { summary } : null;
}
