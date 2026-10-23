import { useRef } from "react";
import { isLiveAgentSession } from "../lib/liveAgents";
import type { Session } from "../lib/session";
import { nextUnseenFinishedSessions } from "../lib/sessionDone";

export function useUnseenFinishedSessions(
  sessions: Session[],
  busySessionIds: ReadonlySet<string>,
  activeSessionId?: string,
  foregroundSessionIds?: ReadonlySet<string>,
): Set<string> {
  const busyForDoneRef = useRef(busySessionIds);
  const sessionsForDoneRef = useRef(sessions);
  const focusedForDoneRef = useRef(activeSessionId);
  const foregroundForDoneRef = useRef(foregroundSessionIds);
  const unseenFinishedRef = useRef<Set<string>>(new Set());
  if (
    sessionsForDoneRef.current !== sessions ||
    busyForDoneRef.current !== busySessionIds ||
    focusedForDoneRef.current !== activeSessionId ||
    foregroundForDoneRef.current !== foregroundSessionIds
  ) {
    const tracked = new Set(
      sessions.filter(isLiveAgentSession).map((session) => session.id),
    );
    unseenFinishedRef.current = nextUnseenFinishedSessions({
      previousBusyIds: busyForDoneRef.current,
      busyIds: busySessionIds,
      previousUnseenIds: unseenFinishedRef.current,
      focusedSessionId: activeSessionId,
      focusedSessionIds: foregroundSessionIds,
      untrackedIds: new Set(
        [...busyForDoneRef.current, ...unseenFinishedRef.current].filter(
          (id) => !tracked.has(id),
        ),
      ),
    });
    busyForDoneRef.current = busySessionIds;
    sessionsForDoneRef.current = sessions;
    focusedForDoneRef.current = activeSessionId;
    foregroundForDoneRef.current = foregroundSessionIds;
  }
  return unseenFinishedRef.current;
}
