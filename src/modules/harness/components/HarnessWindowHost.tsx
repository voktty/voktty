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
} from "react";
import { useHarnessSessionEngine } from "@/modules/harness/hooks/useHarnessSessionEngine";
import { useHarnessAutomations } from "@/modules/harness/hooks/useHarnessAutomations";
import { useHarnessWindowInbox } from "@/modules/harness/hooks/useHarnessWindowInbox";
import { HarnessInboxContext } from "@/modules/harness/hooks/harnessInboxContext";
import { HarnessReminderWindowContext } from "@/modules/harness/hooks/harnessReminderWindowContext";
import { useHarnessReminderWindow } from "@/modules/harness/hooks/useHarnessReminderWindow";
import { useHarnessReminderService } from "@/modules/harness/hooks/useHarnessReminderService";
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
import { useActiveSurfaceStore } from "@/modules/surfaces";

type WindowRuntime = {
  engine: ReturnType<typeof useHarnessSessionEngine>;
  views: ReturnType<typeof createHarnessWindowViews>;
  persistence: ReturnType<typeof useWindowPersistenceAdmission>;
  transcripts: ReturnType<typeof useHarnessTranscriptPersistence>;
  automations: ReturnType<typeof useHarnessAutomations>;
  summaries: HarnessSummarySource;
  reminderRegistrationError: string | null;
  reminders: ReturnType<typeof useHarnessReminderService>;
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
}: {
  children: ReactNode;
  initialSessions?: () => Session[];
  skipSnapshot?: boolean;
  onOpenReminder?: ConfirmedReminderSessionOpener;
}) {
  const [views] = useState(createHarnessWindowViews);
  const [summaries] = useState(createHarnessSummaryUpdates);
  const [imported] = useState(initialSessions);
  const cohortSnapshot = useSyncExternalStore(
    views.subscribe,
    views.getSnapshot,
  );
  const engine = useHarnessSessionEngine({
    initialSessions: () => imported,
    isForeground: views.isForeground,
    isRemoving: views.isRemoving,
    isSwitching: views.isSwitching,
  });
  useHarnessWindowAttention({
    sessions: engine.sessions,
    sessionsRef: engine.sessionsRef,
    isForeground: views.isForeground,
    flushHarnessEvents: engine.flushHarnessEvents,
    flushForegroundHarnessEvents: engine.flushForegroundHarnessEvents,
  });
  const persistence = useWindowPersistenceAdmission(() => undefined);
  const reminders = useHarnessReminderService(
    onOpenReminder,
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
    bindResumedSessions(sessionsRef.current);
    const stop = startHarnessBridge();
    return () => stop();
  }, [sessionsRef]);

  return (
    <HarnessWindowContext.Provider
      value={{
        engine,
        views,
        persistence,
        transcripts,
        automations,
        summaries: summaries.source,
        reminderRegistrationError,
        reminders,
      }}
    >
      <HarnessInboxContext.Provider value={inboxUnseen}>
        <HarnessReminderWindowContext.Provider value={true}>
          <HarnessReminderServiceContext.Provider value={reminders}>
            {children}
          </HarnessReminderServiceContext.Provider>
        </HarnessReminderWindowContext.Provider>
      </HarnessInboxContext.Provider>
    </HarnessWindowContext.Provider>
  );
}
