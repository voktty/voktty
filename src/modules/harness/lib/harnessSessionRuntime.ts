import type { Session } from "./session";
import {
  type HarnessSessionViewReport,
  normalizeHarnessSessionViewReport,
  sameHarnessSessionViewReport,
  referencedHarnessSessionIds,
  foregroundHarnessSessionIds,
} from "./harnessSessionViews";

export class HarnessSessionCapacityError extends Error {
  readonly code = "HARNESS_SESSION_CAPACITY";
  constructor() {
    super("The shared Harness session runtime is at capacity.");
    this.name = "HarnessSessionCapacityError";
  }
}
export class HarnessSessionCancelledError extends Error {
  readonly code = "HARNESS_SESSION_CANCELLED";
  constructor() {
    super("The Harness session operation was replaced or removed.");
    this.name = "HarnessSessionCancelledError";
  }
}
export type HarnessSessionToken = Readonly<{
  sessionId: string;
  incarnation: number;
  generation: number;
}>;
export type HarnessSessionRuntimeSnapshot = Readonly<{
  sessions: readonly Readonly<Session>[];
  loadingSessionIds: readonly string[];
  pendingOperationCount: number;
  busySessionIds: readonly string[];
  views: readonly Readonly<{
    ownerId: number;
    report: HarnessSessionViewReport;
  }>[];
  referencedSessionIds: readonly string[];
  foregroundSessionIds: readonly string[];
}>;
type SessionEntry = {
  session: Readonly<Session>;
  incarnation: number;
  generation: number;
};
type PendingLoad = { promise: Promise<Readonly<Session> | undefined> };
type ViewEntry = { report: HarnessSessionViewReport };
type RuntimeLimits = {
  maxSessions?: number;
  maxLoads?: number;
  maxViews?: number;
  maxReferences?: number;
};

function assertSessionId(id: string) {
  if (typeof id !== "string" || !id.trim() || id.length > 256)
    throw new TypeError("Harness session identity is invalid.");
}
function ownSession(input: Session): Readonly<Session> {
  assertSessionId(input.id);
  const result = {
    ...input,
    modelSettings: { ...input.modelSettings },
    blocks: [...input.blocks],
  };
  Object.freeze(result.modelSettings);
  Object.freeze(result.blocks);
  return Object.freeze(result);
}
function limit(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > 256)
    throw new RangeError("Harness runtime limit is invalid.");
  return result;
}

export function createHarnessSessionRuntime(
  dependencies: { loadSession: (id: string) => Promise<Session | undefined> },
  limits: RuntimeLimits = {},
) {
  const maxSessions = limit(limits.maxSessions, 256);
  const maxLoads = limit(limits.maxLoads, 256);
  const maxViews = limit(limits.maxViews, 256);
  const maxReferences = limit(limits.maxReferences, 256);
  const sessions = new Map<string, SessionEntry>();
  const pendingLoads = new Map<string, PendingLoad>();
  const operations = new Set<PendingLoad>();
  const views = new Map<number, ViewEntry>();
  const tokens = new WeakMap<
    HarnessSessionToken,
    { entry: SessionEntry; generation: number }
  >();
  const listeners = new Set<() => void>();
  let incarnation = 0;
  const snapshot = (): HarnessSessionRuntimeSnapshot => {
    const ordered = [...sessions.values()].sort((a, b) =>
      a.session.id < b.session.id ? -1 : a.session.id > b.session.id ? 1 : 0,
    );
    const reports = [...views.entries()]
      .sort(([a], [b]) => a - b)
      .map(([ownerId, entry]) =>
        Object.freeze({ ownerId, report: entry.report }),
      );
    return Object.freeze({
      sessions: Object.freeze(ordered.map((entry) => entry.session)),
      loadingSessionIds: Object.freeze([...pendingLoads.keys()].sort()),
      pendingOperationCount: operations.size,
      busySessionIds: Object.freeze(
        ordered
          .filter((entry) => entry.session.busy)
          .map((entry) => entry.session.id),
      ),
      views: Object.freeze(reports),
      referencedSessionIds: Object.freeze([
        ...referencedHarnessSessionIds(reports.map((view) => view.report)),
      ]),
      foregroundSessionIds: Object.freeze([
        ...foregroundHarnessSessionIds(reports.map((view) => view.report)),
      ]),
    });
  };
  let currentSnapshot = snapshot();
  const publish = () => {
    currentSnapshot = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* A view observer cannot invalidate runtime admission or cleanup. */
      }
    }
  };
  const nextIncarnation = () => {
    if (incarnation === Number.MAX_SAFE_INTEGER)
      throw new HarnessSessionCapacityError();
    incarnation += 1;
    return incarnation;
  };
  const installSession = (input: Session) => {
    const entry = {
      session: ownSession(input),
      incarnation: nextIncarnation(),
      generation: 0,
    };
    sessions.set(input.id, entry);
    return entry.session;
  };
  const admitSession = (input: Session): Readonly<Session> => {
    assertSessionId(input.id);
    const existing = sessions.get(input.id);
    if (existing) return existing.session;
    if (
      sessions.size + pendingLoads.size + (pendingLoads.has(input.id) ? 0 : 1) >
      maxSessions
    )
      throw new HarnessSessionCapacityError();
    const result = installSession(input);
    pendingLoads.delete(input.id);
    publish();
    return result;
  };
  const ensureSessionLoaded = (
    id: string,
  ): Promise<Readonly<Session> | undefined> => {
    try {
      assertSessionId(id);
    } catch (error) {
      return Promise.reject(error);
    }
    const existing = sessions.get(id);
    if (existing) return Promise.resolve(existing.session);
    const pending = pendingLoads.get(id);
    if (pending) return pending.promise;
    if (
      operations.size >= maxLoads ||
      sessions.size + pendingLoads.size >= maxSessions
    )
      return Promise.reject(new HarnessSessionCapacityError());
    let operation: PendingLoad;
    const promise = Promise.resolve().then(async () => {
      try {
        if (pendingLoads.get(id) !== operation)
          throw new HarnessSessionCancelledError();
        const loaded = await dependencies.loadSession(id);
        if (pendingLoads.get(id) !== operation)
          throw new HarnessSessionCancelledError();
        if (!loaded) return undefined;
        if (loaded.id !== id)
          throw new Error(
            "Persisted Harness session identity does not match the request.",
          );
        return sessions.get(id)?.session ?? installSession(loaded);
      } finally {
        if (pendingLoads.get(id) === operation) pendingLoads.delete(id);
        operations.delete(operation);
        publish();
      }
    });
    operation = { promise };
    pendingLoads.set(id, operation);
    operations.add(operation);
    publish();
    return promise;
  };
  const removeSession = (id: string) => {
    assertSessionId(id);
    const removed = sessions.delete(id);
    const cancelled = pendingLoads.delete(id);
    if (removed || cancelled) publish();
    return removed || cancelled;
  };
  const capture = (entry: SessionEntry): HarnessSessionToken => {
    const token = Object.freeze({
      sessionId: entry.session.id,
      incarnation: entry.incarnation,
      generation: entry.generation,
    });
    tokens.set(token, { entry, generation: entry.generation });
    return token;
  };
  const entryFor = (token: HarnessSessionToken) => {
    const captured = tokens.get(token);
    return captured &&
      sessions.get(token.sessionId) === captured.entry &&
      captured.entry.generation === captured.generation
      ? captured.entry
      : undefined;
  };
  const captureSession = (id: string) => {
    const entry = sessions.get(id);
    return entry ? capture(entry) : undefined;
  };
  const updateSession = (
    token: HarnessSessionToken,
    update: (session: Readonly<Session>) => Session,
  ) => {
    const entry = entryFor(token);
    if (!entry) return false;
    const next = update(entry.session);
    if (next.id !== token.sessionId)
      throw new Error(
        "Harness session identity cannot change during an update.",
      );
    if (entryFor(token) !== entry) return false;
    if (next === entry.session) return true;
    entry.session = ownSession(next);
    publish();
    return true;
  };
  const advance = (entry: SessionEntry) => {
    if (entry.generation === Number.MAX_SAFE_INTEGER)
      throw new HarnessSessionCapacityError();
    entry.generation += 1;
  };
  const beginTurn = (id: string) => {
    const entry = sessions.get(id);
    if (
      !entry ||
      entry.session.worktreeRemoved ||
      entry.session.busy ||
      entry.session.pendingQuestion ||
      entry.session.blocks.some(
        (block) => block.approval && !block.approval.decided,
      )
    )
      return undefined;
    advance(entry);
    entry.session = ownSession({ ...entry.session, busy: true });
    const token = capture(entry);
    publish();
    return token;
  };
  const completeTurn = (token: HarnessSessionToken) => {
    const entry = entryFor(token);
    if (!entry) return false;
    advance(entry);
    entry.session = ownSession({ ...entry.session, busy: false });
    publish();
    return true;
  };
  const registerView = (ownerId: number) => {
    if (!Number.isSafeInteger(ownerId) || ownerId < 1)
      throw new TypeError("Harness view owner is invalid.");
    if (!views.has(ownerId) && views.size >= maxViews)
      throw new HarnessSessionCapacityError();
    const entry: ViewEntry = {
      report:
        views.get(ownerId)?.report ??
        normalizeHarnessSessionViewReport(
          { referencedSessionIds: [] },
          maxReferences,
        ),
    };
    views.set(ownerId, entry);
    publish();
    return {
      report: (
        input: Parameters<typeof normalizeHarnessSessionViewReport>[0],
      ) => {
        if (views.get(ownerId) !== entry) return;
        const normalized = normalizeHarnessSessionViewReport(
          input,
          maxReferences,
        );
        if (sameHarnessSessionViewReport(entry.report, normalized)) return;
        const prospective = [...views.values()].map((view) =>
          view === entry ? normalized : view.report,
        );
        if (referencedHarnessSessionIds(prospective).length > maxReferences)
          throw new HarnessSessionCapacityError();
        entry.report = normalized;
        publish();
      },
      release: () => {
        if (views.get(ownerId) === entry) {
          views.delete(ownerId);
          publish();
        }
      },
    };
  };
  return {
    getSnapshot: () => currentSnapshot,
    getSession: (id: string) => sessions.get(id)?.session,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    admitSession,
    ensureSessionLoaded,
    removeSession,
    captureSession,
    updateSession,
    beginTurn,
    completeTurn,
    registerView,
    isCurrent: (token: HarnessSessionToken) => entryFor(token) !== undefined,
  };
}
