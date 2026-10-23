import { useCallback, useEffect, useMemo, useRef } from "react";
import { leafIds } from "@/modules/harness/lib/layout";
import type { WorkspaceTab } from "@/modules/harness/lib/layout";
import type {
  PersistenceOwner,
  PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import type { Session } from "@/modules/harness/lib/session";
import {
  persistFingerprint,
  shouldPersistSession,
  upsertSession,
  upsertSessions,
  type SessionSummary,
} from "@/modules/harness/lib/sessionStore";

type Inputs = {
  sessions: Session[];
  tabsRef: Readonly<{ current: WorkspaceTab[] }>;
  getOwner: () => PersistenceOwner | null;
  revision: number;
  imported?: Session[];
  onSaved: (summary: SessionSummary, isCurrent: () => boolean) => void;
};

function lastUserBlockId(session: Session): string | undefined {
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    if (session.blocks[index]?.role === "user")
      return session.blocks[index]?.id;
  }
  return undefined;
}

export function useHarnessTranscriptPersistence(inputs: Inputs) {
  const latest = useRef(inputs);
  latest.current = inputs;
  const persisted = useRef(new Map<string, string>());
  const boundProviders = useRef(new Map<string, string>());
  const userBlocks = useRef(new Map<string, string>());
  const observed = useRef(new Map<string, Session>());
  const pending = useRef(new Map<string, Session>());
  const imported = useRef(false);
  const lastRevision = useRef(inputs.revision);
  const lifetime = useRef<object | null>(null);
  useEffect(() => {
    const owner = {};
    lifetime.current = owner;
    return () => {
      if (lifetime.current === owner) lifetime.current = null;
    };
  }, []);
  const { sessions, tabsRef, getOwner, revision } = inputs;
  useEffect(() => {
    if (imported.current || !inputs.imported?.length) return;
    imported.current = true;
    for (const session of inputs.imported) {
      observed.current.set(session.id, session);
      persisted.current.set(session.id, persistFingerprint(session));
      const userId = lastUserBlockId(session);
      if (userId) userBlocks.current.set(session.id, userId);
      if (session.providerSessionId)
        boundProviders.current.set(session.id, session.providerSessionId);
    }
  }, [inputs.imported]);

  const persistSession = useCallback(
    (session: Session | undefined, capturedPermit?: PersistencePermit) => {
      if (!session || !shouldPersistSession(session)) return;
      const owner = lifetime.current;
      const permit = capturedPermit ?? latest.current.getOwner()?.capture();
      if (!owner || !permit) return;
      const fingerprint = persistFingerprint(session);
      const isCurrent = () => lifetime.current === owner && permit.isCurrent();
      void permit
        .run(async () => {
          if (!isCurrent()) return;
          const summary = await upsertSession(session);
          if (!isCurrent() || !summary) return;
          persisted.current.set(session.id, fingerprint);
          latest.current.onSaved(summary, isCurrent);
        })
        .catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    if (lastRevision.current !== revision) {
      lastRevision.current = revision;
      persisted.current.clear();
      observed.current.clear();
      pending.current.clear();
    }
    const owner = lifetime.current;
    const permit = getOwner()?.capture();
    if (!owner || !permit) return;
    const isCurrent = () => lifetime.current === owner && permit.isCurrent();
    const liveIds = new Set(sessions.map((session) => session.id));
    const visibleIds = new Set(
      tabsRef.current.flatMap((tab) => leafIds(tab.layout)),
    );
    for (const session of sessions) {
      if (observed.current.get(session.id) === session) continue;
      observed.current.set(session.id, session);
      const parked = !visibleIds.has(session.id);
      const newlyBound =
        !!session.providerSessionId &&
        boundProviders.current.get(session.id) !== session.providerSessionId;
      const userId = lastUserBlockId(session);
      const newUserTurn =
        !!userId && userBlocks.current.get(session.id) !== userId;
      if (newlyBound && session.providerSessionId)
        boundProviders.current.set(session.id, session.providerSessionId);
      if (newUserTurn && userId) userBlocks.current.set(session.id, userId);
      if ((newlyBound || newUserTurn) && shouldPersistSession(session))
        persistSession(session, permit);
      if (
        shouldPersistSession(session) &&
        (!session.busy ||
          parked ||
          newlyBound ||
          newUserTurn ||
          !persisted.current.has(session.id))
      ) {
        pending.current.set(session.id, session);
      }
    }
    for (const id of observed.current.keys()) {
      if (liveIds.has(id)) continue;
      observed.current.delete(id);
      pending.current.delete(id);
    }
    if (pending.current.size === 0) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active || !isCurrent()) return;
      void permit
        .run(async () => {
          if (!active || !isCurrent()) return;
          const dirty = [...pending.current.values()];
          pending.current.clear();
          const changed = dirty.filter(
            (session) =>
              persisted.current.get(session.id) !== persistFingerprint(session),
          );
          if (changed.length === 0) return;
          const summaries = await upsertSessions(changed);
          for (const summary of summaries) {
            if (!isCurrent()) return;
            const session = changed.find((item) => item.id === summary.id);
            if (session)
              persisted.current.set(session.id, persistFingerprint(session));
            latest.current.onSaved(summary, isCurrent);
          }
        })
        .catch(() => undefined);
    }, 650);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [sessions, tabsRef, getOwner, revision, persistSession]);

  return useMemo(
    () => ({
      persistSession,
      markPersisted: (session: Session) => {
        persisted.current.set(session.id, persistFingerprint(session));
      },
      forgetFingerprint: (id: string) => {
        persisted.current.delete(id);
      },
      dropPending: (id: string) => {
        pending.current.delete(id);
      },
    }),
    [persistSession],
  );
}
