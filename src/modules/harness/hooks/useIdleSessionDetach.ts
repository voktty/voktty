import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { OrchestrationRun } from "../../orchestration/model/orchestration";
import { rememberLoadedSession } from "../lib/sessionCache";
import { shouldPersistSession } from "../lib/sessionStore";
import { sessionChildHarnesses } from "../lib/handoff";
import type { Session } from "../lib/session";
import { hasSessionDetachHold } from "../lib/sessionDetach";
import { leafIds, type WorkspaceTab } from "../lib/layout";
import { forgetHarnessSession } from "../lib/harness/registry";

const SESSION_DETACH_DELAY_MS = 250;

export function useIdleSessionDetach({
  sessions,
  sessionsRef,
  tabs,
  tabsRef,
  orchestrationRuns,
  liveAgentsEnabled,
  unseenFinishedIds,
  openingSessionIds,
  loadedSessionCache,
  skipForgetSessionIds,
  persistSession,
  setSessions,
  isRetained: retainExternally,
  retentionRevision,
}: {
  sessions: Session[];
  sessionsRef: RefObject<Session[]>;
  tabs: WorkspaceTab[];
  tabsRef: RefObject<WorkspaceTab[]>;
  orchestrationRuns: OrchestrationRun[];
  liveAgentsEnabled: boolean;
  unseenFinishedIds: ReadonlySet<string>;
  openingSessionIds: RefObject<Set<string>>;
  loadedSessionCache: RefObject<Map<string, Session>>;
  skipForgetSessionIds: RefObject<Set<string>>;
  persistSession: (session: Session | undefined) => void;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  isRetained?: (id: string) => boolean;
  retentionRevision?: object;
}) {
  const externalRetention = useRef(retainExternally);
  externalRetention.current = retainExternally;
  const externallyRetained = useCallback(
    (session: Session) =>
      !!externalRetention.current?.(session.id) ||
      !!(
        session.orchestrationLeadId &&
        externalRetention.current?.(session.orchestrationLeadId)
      ),
    [],
  );
  // Dropping a session re-renders the whole app, so it waits until a switch
  // has painted, and a burst of switches pays for it once.
  const detachInputs = useRef({ orchestrationRuns, liveAgentsEnabled });
  detachInputs.current = { orchestrationRuns, liveAgentsEnabled };
  const unseenFinishedRef = useRef(unseenFinishedIds);
  unseenFinishedRef.current = unseenFinishedIds;
  const detachTimer = useRef<number | null>(null);
  const pendingDetach = useRef(new Set<Session>());
  const failedDetach = useRef(new WeakSet<Session>());
  const detachOwner = useRef<object | null>(null);
  useEffect(() => {
    const owner = {};
    detachOwner.current = owner;
    return () => {
      if (detachOwner.current !== owner) return;
      detachOwner.current = null;
      if (detachTimer.current != null) window.clearTimeout(detachTimer.current);
      detachTimer.current = null;
      pendingDetach.current.clear();
    };
  }, []);
  useEffect(() => {
    const owner = detachOwner.current;
    if (!owner) return;
    const committedIds = new Set(sessions.map((session) => session.id));
    const pending = [...pendingDetach.current];
    pendingDetach.current.clear();
    const restore = (session: Session) => {
      if (detachOwner.current !== owner) return;
      setSessions((prev) =>
        prev.some((current) => current.id === session.id)
          ? prev
          : [...prev, session],
      );
    };
    for (const session of pending) {
      if (
        committedIds.has(session.id) ||
        sessionsRef.current.some((current) => current.id === session.id)
      )
        continue;
      const referenced = tabsRef.current.some((tab) =>
        leafIds(tab.layout).includes(session.id),
      );
      const running = detachInputs.current.orchestrationRuns.some(
        (run) =>
          (run.leadId === session.id ||
            run.leadId === session.orchestrationLeadId) &&
          ["active", "paused"].includes(run.status),
      );
      if (
        referenced ||
        externallyRetained(session) ||
        hasSessionDetachHold(session) ||
        session.inboxAsk ||
        running ||
        openingSessionIds.current.has(session.id) ||
        skipForgetSessionIds.current.has(session.id) ||
        (detachInputs.current.liveAgentsEnabled &&
          unseenFinishedRef.current.has(session.id))
      ) {
        restore(session);
        continue;
      }
      void Promise.all(
        sessionChildHarnesses(session).map((harness) =>
          forgetHarnessSession(harness, session.id),
        ),
      ).then(
        () => {
          if (
            detachOwner.current === owner &&
            !sessionsRef.current.some((current) => current.id === session.id) &&
            shouldPersistSession(session)
          ) {
            rememberLoadedSession(loadedSessionCache.current, session);
          }
        },
        () => {
          failedDetach.current.add(session);
          restore(session);
        },
      );
    }
  }, [
    sessions,
    sessionsRef,
    tabsRef,
    openingSessionIds,
    skipForgetSessionIds,
    loadedSessionCache,
    setSessions,
    externallyRetained,
  ]);
  const detachIdleSessions = useCallback(() => {
    detachTimer.current = null;
    const sessions = sessionsRef.current;
    const { orchestrationRuns, liveAgentsEnabled } = detachInputs.current;
    const visibleIds = new Set(
      tabsRef.current.flatMap((tab) => leafIds(tab.layout)),
    );
    // Inbox owns these panes independently of project tabs. Keep their drafts
    // and attachments mounted when the panel closes or switches items.
    for (const session of sessions) {
      if (session.inboxAsk) visibleIds.add(session.id);
    }
    for (const run of orchestrationRuns) {
      if (["active", "paused"].includes(run.status)) visibleIds.add(run.leadId);
    }
    // Internal workers stay attached to the lead, even while idle between
    // turns. They must not be discarded merely because they have no tab.
    for (const session of sessions) {
      if (
        session.orchestrationLeadId &&
        (visibleIds.has(session.orchestrationLeadId) ||
          orchestrationRuns.some(
            (run) =>
              run.leadId === session.orchestrationLeadId &&
              ["active", "paused"].includes(run.status),
          ))
      )
        visibleIds.add(session.id);
    }
    for (const sessionId of visibleIds) {
      openingSessionIds.current.delete(sessionId);
      loadedSessionCache.current.delete(sessionId);
    }
    const keepUnseen = liveAgentsEnabled;
    const isRetained = (session: Session) =>
      visibleIds.has(session.id) ||
      externallyRetained(session) ||
      hasSessionDetachHold(session) ||
      failedDetach.current.has(session) ||
      openingSessionIds.current.has(session.id) ||
      (keepUnseen && unseenFinishedRef.current.has(session.id)) ||
      skipForgetSessionIds.current.has(session.id);
    const isNowReferenced = (session: Session) =>
      tabsRef.current.some((tab) => leafIds(tab.layout).includes(session.id));
    const idleDetached = sessions.filter((session) => !isRetained(session));
    if (idleDetached.length === 0) return;
    const detached = new Set<Session>();
    for (const session of idleDetached) {
      if (isRetained(session)) continue;
      persistSession(session);
      if (
        sessionsRef.current.find((entry) => entry.id === session.id) !==
          session ||
        isRetained(session) ||
        isNowReferenced(session)
      ) {
        continue;
      }
      if (pendingDetach.current.size >= 256) break;
      pendingDetach.current.add(session);
      detached.add(session);
    }
    if (detached.size === 0) return;
    setSessions((prev) =>
      prev.filter(
        (session) =>
          !detached.has(session) ||
          isRetained(session) ||
          isNowReferenced(session),
      ),
    );
  }, [
    sessionsRef,
    tabsRef,
    openingSessionIds,
    loadedSessionCache,
    skipForgetSessionIds,
    persistSession,
    setSessions,
    externallyRetained,
  ]);

  useEffect(() => {
    if (detachTimer.current != null) return;
    const owner = detachOwner.current;
    if (!owner) return;
    detachTimer.current = window.setTimeout(() => {
      if (detachOwner.current === owner) detachIdleSessions();
    }, SESSION_DETACH_DELAY_MS);
  }, [
    sessions,
    tabs,
    liveAgentsEnabled,
    orchestrationRuns,
    detachIdleSessions,
    retentionRevision,
  ]);
}
