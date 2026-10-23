import { useMemo, useRef } from "react";
import type { useHarnessSessionEngine } from "@/modules/harness/hooks/useHarnessSessionEngine";
import type { PersistenceOwner } from "@/modules/harness/lib/persistenceAdmission";
import type { createHarnessWindowSessionHolds } from "@/modules/harness/lib/harnessWindowSessionHolds";

type Engine = ReturnType<typeof useHarnessSessionEngine>;
export type HarnessViewEngine = Omit<Engine, "cancelScheduledHarnessEvents">;

export function useHarnessViewEngine(
  engine: Engine,
  getOwner: () => PersistenceOwner | null,
  holds: ReturnType<typeof createHarnessWindowSessionHolds>,
): HarnessViewEngine {
  const latest = useRef(engine);
  latest.current = engine;
  const actions = useMemo(() => {
    const guard =
      <Args extends unknown[], Result>(
        read: (current: Engine) => (...args: Args) => Result,
        fallback: Result,
      ) =>
      (...args: Args): Result => {
        const permit = getOwner()?.capture();
        if (!permit?.isCurrent()) return fallback;
        return read(latest.current)(...args);
      };
    return {
      captureSessionLifetime(id: string) {
        const permit = getOwner()?.capture();
        const current = latest.current.captureSessionLifetime(id);
        return () => !!permit?.isCurrent() && current();
      },
      flushHarnessEvents: guard(
        (current) => current.flushHarnessEvents,
        undefined,
      ),
      flushForegroundHarnessEvents: guard(
        (current) => current.flushForegroundHarnessEvents,
        undefined,
      ),
      updateSession: guard((current) => current.updateSession, undefined),
      updateSessions: guard((current) => current.updateSessions, undefined),
      admitSession: guard((current) => current.admitSession, undefined),
      removeSession: guard(
        (current) =>
          (...args: Parameters<Engine["removeSession"]>) => {
            holds.invalidateOpening(args[0]);
            current.removeSession(...args);
          },
        undefined,
      ),
      applySessionDeltas: guard(
        (current) =>
          (...args: Parameters<Engine["applySessionDeltas"]>) => {
            for (const delta of args[0])
              if (delta.kind === "remove") {
                const session = current.readSession(delta.id);
                if (delta.expected && delta.expected !== session) continue;
                if (
                  delta.shouldRemove &&
                  (!session || !delta.shouldRemove(session))
                )
                  continue;
                holds.invalidateOpening(delta.id);
              }
            current.applySessionDeltas(...args);
          },
        undefined,
      ),
      invalidateSessionTurn: guard(
        (current) => current.invalidateSessionTurn,
        undefined,
      ),
      onModelChange: guard((current) => current.onModelChange, undefined),
      onModelSettingsChange: guard(
        (current) => current.onModelSettingsChange,
        undefined,
      ),
      onRuntimeModeChange: guard(
        (current) => current.onRuntimeModeChange,
        undefined,
      ),
      onSubmit: guard((current) => current.onSubmit, undefined),
      onUpdatePlan: guard((current) => current.onUpdatePlan, undefined),
      onBuildPlan: guard((current) => current.onBuildPlan, undefined),
      onDeleteQueuedMessage: guard(
        (current) => current.onDeleteQueuedMessage,
        undefined,
      ),
      onQueuedMessageEditingChange: guard(
        (current) => current.onQueuedMessageEditingChange,
        undefined,
      ),
      onEditQueuedMessage: guard(
        (current) => current.onEditQueuedMessage,
        undefined,
      ),
      onSteerQueuedMessage: guard(
        (current) => current.onSteerQueuedMessage,
        undefined,
      ),
      onResumeQueue: guard((current) => current.onResumeQueue, undefined),
      onCompactContext: guard((current) => current.onCompactContext, false),
      onStop: guard((current) => current.onStop, undefined),
      onApproval: guard((current) => current.onApproval, undefined),
      onQuestionReply: guard((current) => current.onQuestionReply, undefined),
      onQuestionInteraction: guard(
        (current) => current.onQuestionInteraction,
        undefined,
      ),
      stopSessionForRemoval: guard(
        (current) => current.stopSessionForRemoval,
        Promise.resolve(undefined),
      ),
    };
  }, [getOwner, holds]);
  return {
    sessions: engine.sessions,
    sessionsRef: engine.sessionsRef,
    readSession: engine.readSession,
    ...actions,
  };
}
