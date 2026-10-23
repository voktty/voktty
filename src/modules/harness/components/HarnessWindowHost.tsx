import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useHarnessSessionEngine } from "@/modules/harness/hooks/useHarnessSessionEngine";
import { useHarnessCatalogBootstrap } from "@/modules/harness/hooks/useHarnessCatalogBootstrap";
import { useRemoteSessionAlerts } from "@/modules/harness/hooks/useRemoteSessionAlerts";
import { useIdleSessionDetach } from "@/modules/harness/hooks/useIdleSessionDetach";
import { useUnseenFinishedSessions } from "@/modules/harness/hooks/useUnseenFinishedSessions";
import { harnessSessionDeltas } from "@/modules/harness/lib/harnessSessionEngineState";
import {
  loadLiveAgentsEnabled,
  subscribeLiveAgentsEnabled,
} from "@/modules/harness/lib/settings";
import type { OrchestrationRun } from "@/modules/orchestration/model/orchestration";
import { useHarnessAutomations } from "@/modules/harness/hooks/useHarnessAutomations";
import { useHarnessWindowInbox } from "@/modules/harness/hooks/useHarnessWindowInbox";
import { HarnessInboxContext } from "@/modules/harness/hooks/harnessInboxContext";
import { HarnessReminderWindowContext } from "@/modules/harness/hooks/harnessReminderWindowContext";
import { useHarnessReminderWindow } from "@/modules/harness/hooks/useHarnessReminderWindow";
import { useHarnessReminderService } from "@/modules/harness/hooks/useHarnessReminderService";
import { useHarnessWindowNavigation } from "@/modules/harness/hooks/useHarnessWindowNavigation";
import type { CreateHarnessNavigationView } from "@/modules/harness/lib/harnessWindowNavigation";
import {
  HarnessReminderServiceContext,
  type ConfirmedReminderSessionOpener,
} from "@/modules/harness/hooks/harnessReminderServiceContext";
import { leafIds } from "@/modules/harness/lib/layout";
import {
  createHarnessSummaryUpdates,
  type HarnessSummarySource,
} from "@/modules/harness/lib/harnessSummaryUpdates";
import { summaryFromSession } from "@/modules/harness/lib/sessionHistory";
import { useHarnessWindowAttention } from "@/modules/harness/hooks/useHarnessWindowAttention";
import { useHarnessTranscriptPersistence } from "@/modules/harness/hooks/useHarnessTranscriptPersistence";
import { useHarnessWindowPersistence } from "@/modules/harness/hooks/useHarnessWindowPersistence";
import { useWindowPersistenceAdmission } from "@/modules/harness/hooks/useWindowPersistenceAdmission";
import { bindResumedSessions } from "@/modules/harness/lib/appLifecycle";
import {
  registerBuiltinHarnesses,
  startHarnessBridge,
} from "@/modules/harness/lib/harness";
import {
  captureHarnessWindowSnapshot,
  createHarnessWindowViews,
} from "@/modules/harness/lib/harnessWindowViews";
import type { Session } from "@/modules/harness/lib/session";
import { normalizeHarnessSessionViewReport } from "@/modules/harness/lib/harnessSessionViews";
import { createHarnessWindowSessionHolds } from "@/modules/harness/lib/harnessWindowSessionHolds";
import { createHarnessWindowViewRemoval } from "@/modules/harness/lib/harnessWindowViewRemoval";
import { createInboxSessionOperations } from "@/modules/harness/lib/inboxSessionOperations";
import { createHarnessProjectReservations } from "@/modules/harness/lib/harnessProjectReservations";
import { useActiveSurfaceStore } from "@/modules/surfaces";
import { createLegacyTerminalMigrations } from "@/modules/harness/lib/legacyTerminalMigrations";
import {
  captureLegacyPtyMigration,
  hasLegacyPty,
} from "@/modules/harness/lib/pty";
import { HarnessTerminalMigrationContext } from "@/modules/harness/hooks/harnessTerminalMigrationContext";
import { confirmCloseTerminal } from "@/modules/harness/lib/terminalClose";

type WindowRuntime = {
  engine: ReturnType<typeof useHarnessSessionEngine>;
  views: ReturnType<typeof createHarnessWindowViews>;
  holds: ReturnType<typeof createHarnessWindowSessionHolds>;
  removals: ReturnType<typeof createHarnessWindowViewRemoval>;
  inboxOperations: ReturnType<typeof createInboxSessionOperations>;
  projects: ReturnType<typeof createHarnessProjectReservations>;
  persistence: ReturnType<typeof useWindowPersistenceAdmission>;
  transcripts: ReturnType<typeof useHarnessTranscriptPersistence>;
  automations: ReturnType<typeof useHarnessAutomations>;
  summaries: HarnessSummarySource;
  reminderRegistrationError: string | null;
  reminders: ReturnType<typeof useHarnessReminderService>;
  navigation: ReturnType<typeof useHarnessWindowNavigation>;
  unseenFinishedIds: Set<string>;
  admitSeeds: (
    sessions: readonly Session[],
    isCurrent: () => boolean,
  ) => boolean;
};

export const HarnessWindowContext = createContext<WindowRuntime | null>(null);

export function useHarnessWindow() {
  const runtime = useContext(HarnessWindowContext);
  if (!runtime) throw new Error("Harness window host is missing");
  return runtime;
}

export function HarnessWindowHost({
  children,
  initialSessions = () => [],
  skipSnapshot = false,
  onOpenReminder,
  createNavigationView,
}: {
  children: ReactNode;
  initialSessions?: () => Session[];
  skipSnapshot?: boolean;
  onOpenReminder?: ConfirmedReminderSessionOpener;
  createNavigationView?: CreateHarnessNavigationView;
}) {
  const [holds] = useState(createHarnessWindowSessionHolds);
  const [projects] = useState(createHarnessProjectReservations);
  const [views] = useState(() => createHarnessWindowViews(holds, projects));
  const [terminalMigrations] = useState(() =>
    createLegacyTerminalMigrations(
      views,
      captureLegacyPtyMigration,
      confirmCloseTerminal,
      hasLegacyPty,
    ),
  );
  const [removals] = useState(() =>
    createHarnessWindowViewRemoval(views, holds, projects),
  );
  const [inboxOperations] = useState(createInboxSessionOperations);
  const removalLifetime = useRef<object | null>(null);
  useEffect(() => {
    const owner = {};
    removalLifetime.current = owner;
    return () => {
      if (removalLifetime.current === owner) removalLifetime.current = null;
      // StrictMode replaces the effect owner before this final cleanup runs.
      queueMicrotask(() => {
        if (removalLifetime.current === null) {
          removals.dispose();
          inboxOperations.dispose();
          projects.dispose();
          terminalMigrations.dispose();
        }
      });
    };
  }, [removals, inboxOperations, projects, terminalMigrations]);
  const projectReservations = useSyncExternalStore(
    projects.subscribe,
    projects.getSnapshot,
  );
  const held = useSyncExternalStore(holds.subscribe, holds.getSnapshot);
  const [summaries] = useState(createHarnessSummaryUpdates);
  const [imported] = useState(initialSessions);
  const cohortSnapshot = useSyncExternalStore(
    views.subscribe,
    views.getSnapshot,
  );
  const engine = useHarnessSessionEngine({
    initialSessions: () => imported,
    isForeground: views.isForeground,
    isProjectReserved: projects.has,
    reservationRevision: projectReservations,
    isRemoving: (id) => holds.has("removing", id) || views.isRemoving(id),
    isSwitching: (id) =>
      holds.has("opening", id) ||
      holds.has("switching", id) ||
      holds.has("transfer", id) ||
      views.isSwitching(id),
  });
  const boundSeeds = useRef(new WeakSet<Session>());
  const { admitSession, sessionsRef: canonicalSessions } = engine;
  const admitSeeds = useCallback(
    (seeds: readonly Session[], isCurrent: () => boolean) => {
      if (seeds.length > 256)
        throw new RangeError("Harness seed capacity exceeded");
      normalizeHarnessSessionViewReport({
        referencedSessionIds: seeds.map((session) => session.id),
      });
      if (!isCurrent()) return false;
      const ids = new Set([
        ...canonicalSessions.current.map((session) => session.id),
        ...seeds.map((session) => session.id),
      ]);
      if (ids.size > 256)
        throw new RangeError("Harness session capacity exceeded");
      if (
        seeds.some(
          (session) =>
            !canonicalSessions.current.some(
              (existing) => existing.id === session.id,
            ) && projects.has(session.cwd),
        )
      )
        return false;
      registerBuiltinHarnesses();
      for (const session of seeds) {
        if (!isCurrent()) return false;
        if (
          canonicalSessions.current.some(
            (existing) => existing.id === session.id,
          )
        )
          continue;
        admitSession(session, "immediate");
        bindResumedSessions([session]);
        boundSeeds.current.add(session);
      }
      return isCurrent();
    },
    [admitSession, canonicalSessions, projects],
  );
  const busyIds = useMemo(
    () =>
      new Set(
        engine.sessions
          .filter((session) => session.busy)
          .map((session) => session.id),
      ),
    [engine.sessions],
  );
  const foregroundIds = useMemo(
    () =>
      new Set(
        cohortSnapshot.cohorts
          .filter((cohort) => cohort.active)
          .flatMap((cohort) => [...cohort.state.report.foregroundSessionIds]),
      ),
    [cohortSnapshot],
  );
  const unseenFinishedIds = useUnseenFinishedSessions(
    engine.sessions,
    busyIds,
    undefined,
    foregroundIds,
  );
  useHarnessWindowAttention({
    sessions: engine.sessions,
    sessionsRef: engine.sessionsRef,
    isForeground: views.isForeground,
    flushHarnessEvents: engine.flushHarnessEvents,
    flushForegroundHarnessEvents: engine.flushForegroundHarnessEvents,
  });
  const persistence = useWindowPersistenceAdmission(() => undefined);
  useHarnessCatalogBootstrap(
    engine,
    persistence.getOwner,
    persistence.revision,
  );
  useRemoteSessionAlerts();
  const navigation = useHarnessWindowNavigation(
    views,
    persistence.getOwner,
    createNavigationView,
  );
  const reminders = useHarnessReminderService(
    onOpenReminder ??
      (navigation.available ? navigation.openSession : undefined),
    persistence.getOwner,
  );
  const automations = useHarnessAutomations({
    engine,
    sessions: engine.sessions,
    getOwner: persistence.getOwner,
    revision: persistence.revision,
    onCreated: (session, isCurrent) =>
      summaries.publish(summaryFromSession(session), isCurrent),
  });
  const inboxUnseen = useHarnessWindowInbox(
    [
      ...engine.sessions.map((session) => session.cwd),
      ...cohortSnapshot.cohorts.flatMap((cohort) => [
        cohort.state.layout.projectCwd,
        ...cohort.state.layout.projectTerminals.map((dock) => dock.projectPath),
      ]),
    ],
    {
      getOwner: persistence.getOwner,
      revision: persistence.revision,
      onAppeared: automations.onInboxAppeared,
    },
  );
  const surface = useActiveSurfaceStore((state) => state.surface);
  const selectedOwnerId = surface.kind === "harness" ? surface.ownerId : null;
  useEffect(() => {
    views.select(
      cohortSnapshot.cohorts.some(
        (cohort) => cohort.active && cohort.ownerId === selectedOwnerId,
      )
        ? selectedOwnerId
        : null,
    );
  }, [views, selectedOwnerId, cohortSnapshot]);

  const { sessionsRef, flushHarnessEvents } = engine;
  const read = useCallback(
    () => views.capture(sessionsRef.current),
    [views, sessionsRef],
  );
  const workspace = useMemo(
    () => captureHarnessWindowSnapshot(cohortSnapshot, engine.sessions),
    [engine.sessions, cohortSnapshot],
  );
  const activeTabs = useMemo(
    () =>
      cohortSnapshot.cohorts
        .filter((cohort) => cohort.active)
        .flatMap((cohort) => cohort.state.layout.tabs),
    [cohortSnapshot],
  );
  const reminderRegistrationError = useHarnessReminderWindow(
    [...new Set(workspace.tabs.flatMap((tab) => leafIds(tab.layout)))],
    persistence.getOwner,
    persistence.revision,
  );
  const tabsRef = useRef(activeTabs);
  tabsRef.current = activeTabs;
  const transcripts = useHarnessTranscriptPersistence({
    sessions: engine.sessions,
    tabsRef,
    getOwner: persistence.getOwner,
    revision: persistence.revision,
    imported,
    onSaved: summaries.publish,
  });
  const workspaceReady = useRef(false);
  if (cohortSnapshot.cohorts.length > 0) workspaceReady.current = true;
  const retainedTabsRef = useRef(workspace.tabs);
  retainedTabsRef.current = workspace.tabs;
  const [orchestrationRuns] = useState<OrchestrationRun[]>([]);
  const liveAgentsEnabled = useSyncExternalStore(
    subscribeLiveAgentsEnabled,
    loadLiveAgentsEnabled,
    () => true,
  );
  const openingSessionIds = useRef(new Set<string>());
  const skipForgetSessionIds = useRef(new Set<string>());
  const loadedSessionCache = useRef(new Map<string, Session>());
  const { applySessionDeltas } = engine;
  const retentionRevision = useMemo(
    () => ({ held, projectReservations }),
    [held, projectReservations],
  );
  const mutateIdleSessions = useCallback(
    (update: SetStateAction<Session[]>) => {
      const before = sessionsRef.current;
      const after = typeof update === "function" ? update(before) : update;
      const deltas = harnessSessionDeltas(before, after, [
        ...before.map((session) => session.id),
        ...after.map((session) => session.id),
      ]);
      applySessionDeltas(
        deltas.map((delta) =>
          delta.kind === "remove" && typeof update === "function"
            ? {
                ...delta,
                shouldRemove: (session: Session) =>
                  !update([session]).includes(session),
              }
            : delta,
        ),
      );
    },
    [applySessionDeltas, sessionsRef],
  );
  useIdleSessionDetach({
    sessions: engine.sessions,
    sessionsRef,
    tabs: workspace.tabs,
    tabsRef: retainedTabsRef,
    orchestrationRuns,
    liveAgentsEnabled,
    unseenFinishedIds,
    openingSessionIds,
    skipForgetSessionIds,
    loadedSessionCache,
    persistSession: transcripts.persistSession,
    setSessions: mutateIdleSessions,
    isRetained: (id) =>
      !workspaceReady.current ||
      holds.hasAny(id) ||
      projects.has(engine.readSession(id)?.cwd ?? "") ||
      views
        .getSnapshot()
        .cohorts.some((cohort) =>
          cohort.state.report.referencedSessionIds.includes(id),
        ),
    retentionRevision,
  });
  useHarnessWindowPersistence({
    getOwner: persistence.getOwner,
    revision: persistence.revision,
    workspace,
    read,
    flush: flushHarnessEvents,
    skipSnapshot: skipSnapshot || !workspaceReady.current,
  });

  useEffect(() => {
    registerBuiltinHarnesses();
    const unbound = sessionsRef.current.filter(
      (session) => !boundSeeds.current.has(session),
    );
    bindResumedSessions(unbound);
    for (const session of unbound) boundSeeds.current.add(session);
    const stop = startHarnessBridge();
    return () => stop();
  }, [sessionsRef]);

  return (
    <HarnessWindowContext.Provider
      value={{
        engine,
        views,
        holds,
        removals,
        inboxOperations,
        projects,
        persistence,
        transcripts,
        automations,
        summaries: summaries.source,
        reminderRegistrationError,
        reminders,
        navigation,
        unseenFinishedIds,
        admitSeeds,
      }}
    >
      <HarnessInboxContext.Provider value={inboxUnseen}>
        <HarnessReminderWindowContext.Provider value={true}>
          <HarnessReminderServiceContext.Provider value={reminders}>
            <HarnessTerminalMigrationContext value={terminalMigrations}>
              {children}
            </HarnessTerminalMigrationContext>
          </HarnessReminderServiceContext.Provider>
        </HarnessReminderWindowContext.Provider>
      </HarnessInboxContext.Provider>
    </HarnessWindowContext.Provider>
  );
}
