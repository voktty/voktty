import { isPreparingHandoff } from "./handoff";
import { canAutoContinue } from "./inFlight";
import { sessionNeedsInput, type Session } from "./session";

export function hasSessionDetachHold(session: Session): boolean {
  return (
    !!session.busy ||
    sessionNeedsInput(session) ||
    !!session.queuedMessages?.length ||
    session.editingQueuedMessageId != null ||
    canAutoContinue(session) ||
    isPreparingHandoff(session)
  );
}
