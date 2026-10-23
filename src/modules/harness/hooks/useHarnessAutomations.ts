import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { useHarnessSessionEngine } from "@/modules/harness/hooks/useHarnessSessionEngine";
import {
  automationWrite,
  claimDueAutomations,
  recoverAutomationRuns,
  updateAutomationRun,
  type Automation,
  type AutomationRun,
  type AutomationRunStatus,
} from "@/modules/harness/lib/automations";
import {
  claimInboxAutomationRuns,
  linkedWorkItemFromAutomationEvent,
} from "@/modules/harness/lib/automationEvents";
import type { InboxItem } from "@/modules/harness/lib/githubTasks";
import { resolveModel } from "@/modules/harness/lib/models";
import type {
  PersistenceOwner,
  PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import { looksLikeProject } from "@/modules/harness/lib/recents";
import {
  formatSessionTitle,
  HARNESS_LABEL,
  newSession,
  type LinkedWorkItem,
  type Session,
} from "@/modules/harness/lib/session";
import {
  loadSessionFolders,
  placeSessionInFolder,
  saveSessionFolders,
} from "@/modules/harness/lib/sessionFolders";

type Engine = Pick<
  ReturnType<typeof useHarnessSessionEngine>,
  | "sessionsRef"
  | "readSession"
  | "admitSession"
  | "onSubmit"
  | "captureSessionLifetime"
>;
type Inputs = {
  engine: Engine;
  sessions: Session[];
  getOwner: () => PersistenceOwner | null;
  revision: number;
  onCreated?: (session: Session, isCurrent: () => boolean) => void;
};
type LaunchOptions = { prompt?: string; linkedWorkItem?: LinkedWorkItem };
type LaunchResult = { session: Session; isCurrent: () => boolean };
type ActiveRun = {
  runId: string;
  current: () => boolean;
  sessionCurrent?: () => boolean;
  launch: Promise<LaunchResult | undefined>;
  started: boolean;
  finishing?: boolean;
};

function qualifiedPermit(
  permit: PersistencePermit,
  alive: () => boolean,
): PersistencePermit {
  const isCurrent = () => alive() && permit.isCurrent();
  return {
    ...permit,
    isCurrent,
    run: (write) =>
      isCurrent()
        ? permit.run(async () => {
            if (isCurrent()) await write();
          })
        : Promise.resolve(false),
  };
}

export function useHarnessAutomations(inputs: Inputs) {
  const latest = useRef(inputs);
  latest.current = inputs;
  const [cutoff] = useState(Date.now);
  const lifetime = useRef<object | null>(null);
  const active = useRef(new Map<string, ActiveRun>());
  const completed = useRef(new Map<string, string>());
  const recovery = useRef<{ done: boolean; pending?: Promise<void> }>({
    done: false,
  });
  const polling = useRef<Promise<void> | null>(null);
  const inbox = useRef<Promise<void> | null>(null);

  const capture = useCallback(() => {
    const owner = lifetime.current;
    const permit = latest.current.getOwner()?.capture();
    return owner && permit
      ? qualifiedPermit(permit, () => lifetime.current === owner)
      : null;
  }, []);

  const start = useCallback(
    (
      automation: Automation,
      run: AutomationRun,
      permit: PersistencePermit,
      options?: LaunchOptions,
    ): Promise<LaunchResult | undefined> => {
      if (!permit.isCurrent()) return Promise.resolve(undefined);
      automation = {
        ...automation,
        modelSettings: automation.modelSettings
          ? { ...automation.modelSettings }
          : undefined,
      };
      run = { ...run };
      options = options
        ? {
            ...options,
            linkedWorkItem: options.linkedWorkItem
              ? { ...options.linkedWorkItem }
              : undefined,
          }
        : undefined;
      const id = run.sessionId || run.id;
      const existing = active.current.get(id);
      if (existing)
        return existing.runId === run.id
          ? existing.launch
          : Promise.resolve(undefined);
      const completedSessionId = completed.current.get(run.id);
      if (completedSessionId) {
        const session = latest.current.engine.readSession(completedSessionId);
        const sessionCurrent =
          latest.current.engine.captureSessionLifetime(completedSessionId);
        return Promise.resolve(
          session
            ? {
                session,
                isCurrent: () => permit.isCurrent() && sessionCurrent(),
              }
            : undefined,
        );
      }
      if (active.current.size >= 256) return Promise.resolve(undefined);
      const previous = latest.current.engine.readSession(id);
      if (!previous && latest.current.engine.sessionsRef.current.length >= 256)
        return Promise.resolve(undefined);
      if (
        previous &&
        (previous.automationId !== automation.id ||
          previous.cwd !== automation.cwd ||
          previous.busy)
      )
        return Promise.resolve(undefined);
      const owner = lifetime.current;
      const previousCurrent = previous
        ? latest.current.engine.captureSessionLifetime(id)
        : () => latest.current.engine.readSession(id) === undefined;
      const entry: ActiveRun = {
        runId: run.id,
        current: () => owner !== null && lifetime.current === owner,
        launch: Promise.resolve(undefined),
        started: false,
      };
      active.current.set(id, entry);
      entry.launch = (async () => {
        try {
          const running = await automationWrite(permit, () =>
            updateAutomationRun(run.id, "running", { sessionId: id }),
          );
          if (!running || !permit.isCurrent()) return undefined;
          const engine = latest.current.engine;
          if (!previousCurrent()) return undefined;
          const session: Session = engine.readSession(id) ?? {
            ...newSession(
              automation.harness,
              automation.cwd,
              resolveModel(automation.harness, automation.model).id,
              automation.runtimeMode,
              automation.modelSettings,
            ),
            id,
            automationId: automation.id,
            linkedWorkItem:
              options?.linkedWorkItem ?? linkedWorkItemFromAutomationEvent(run),
            title: formatSessionTitle(
              automation.harness,
              automation.name || HARNESS_LABEL[automation.harness],
            ),
          };
          const folderId = automation.sessionFolderId;
          if (folderId && looksLikeProject(session.cwd)) {
            const folders = placeSessionInFolder(
              loadSessionFolders(session.cwd),
              { kind: "existing", folderId },
              id,
            );
            saveSessionFolders(session.cwd, folders.folders);
          }
          if (!permit.isCurrent() || !previousCurrent()) return undefined;
          engine.admitSession(session, "immediate");
          entry.sessionCurrent = engine.captureSessionLifetime(id);
          entry.started = true;
          const prompt = options?.prompt || run.prompt || automation.prompt;
          engine.onSubmit(id, prompt);
          const sessionCurrent = entry.sessionCurrent;
          const isCurrent = () => permit.isCurrent() && sessionCurrent();
          if (isCurrent()) {
            try {
              latest.current.onCreated?.(session, isCurrent);
            } catch {
              /* A view observer cannot cancel an admitted turn. */
            }
          }
          return { session, isCurrent };
        } catch {
          return undefined;
        } finally {
          if (!entry.started && active.current.get(id) === entry)
            active.current.delete(id);
        }
      })();
      return entry.launch;
    },
    [],
  );

  const launch = useCallback(
    (automation: Automation, run: AutomationRun, options?: LaunchOptions) => {
      const permit = capture();
      return permit
        ? start(automation, run, permit, options)
        : Promise.resolve(undefined);
    },
    [capture, start],
  );

  const finishRuns = useCallback(
    (
      sessions = latest.current.engine.sessionsRef.current,
      revision = latest.current.revision,
    ) => {
      if (
        sessions !== latest.current.engine.sessionsRef.current ||
        revision !== latest.current.revision
      )
        return;
      for (const [id, entry] of active.current) {
        if (!entry.started || entry.finishing) continue;
        if (!entry.current()) {
          active.current.delete(id);
          continue;
        }
        const session = latest.current.engine.readSession(id);
        if (entry.sessionCurrent?.() && session?.busy) continue;
        const permit = capture();
        if (!permit) continue;
        const status: AutomationRunStatus = !entry.sessionCurrent?.()
          ? "cancelled"
          : session?.blocks.some((block) => block.notice === "error")
            ? "failed"
            : "succeeded";
        entry.finishing = true;
        void automationWrite(permit, () =>
          updateAutomationRun(entry.runId, status),
        )
          .then((saved) => {
            if (
              !saved ||
              !permit.isCurrent() ||
              active.current.get(id) !== entry
            )
              return;
            active.current.delete(id);
            completed.current.set(entry.runId, id);
            while (completed.current.size > 256) {
              const oldest = completed.current.keys().next().value;
              if (oldest === undefined) break;
              completed.current.delete(oldest);
            }
          })
          .catch(() => undefined)
          .finally(() => {
            entry.finishing = false;
          });
      }
    },
    [capture],
  );
  useEffect(
    () => finishRuns(inputs.sessions, inputs.revision),
    [finishRuns, inputs.sessions, inputs.revision],
  );

  useEffect(() => {
    const owner = {};
    lifetime.current = owner;
    const alive = () => lifetime.current === owner;
    const poll = async () => {
      if (!alive()) return;
      if (polling.current) await polling.current;
      if (!alive()) return;
      const permit = capture();
      if (!permit) return;
      finishRuns();
      const task = (async () => {
        if (recovery.current.pending) await recovery.current.pending;
        if (!permit.isCurrent()) return;
        if (!recovery.current.done) {
          const recovering = (async () => {
            const claims = await automationWrite(permit, () =>
              recoverAutomationRuns(cutoff),
            );
            if (!claims || !permit.isCurrent()) return;
            recovery.current.done = true;
            for (const claim of claims) {
              if (!permit.isCurrent()) return;
              await start(claim.automation, claim.run, permit);
            }
          })();
          recovery.current.pending = recovering;
          try {
            await recovering;
          } finally {
            if (recovery.current.pending === recovering)
              recovery.current.pending = undefined;
          }
        }
        if (!recovery.current.done || !permit.isCurrent() || document.hidden)
          return;
        const claims = await claimDueAutomations(Date.now(), permit);
        for (const claim of claims) {
          if (!permit.isCurrent()) return;
          await start(claim.automation, claim.run, permit);
        }
      })().catch(() => undefined);
      polling.current = task;
      try {
        await task;
      } finally {
        if (polling.current === task) polling.current = null;
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      if (!polling.current) void poll();
    }, 15000);
    return () => {
      if (lifetime.current === owner) lifetime.current = null;
      window.clearInterval(timer);
    };
  }, [capture, cutoff, start, finishRuns]);

  const onInboxAppeared = useCallback(
    async (items: InboxItem[]) => {
      if (items.length === 0 || inbox.current) return;
      const permit = capture();
      if (!permit) return;
      const task = (async () => {
        const claims = await claimInboxAutomationRuns(
          items,
          Date.now(),
          permit,
        );
        for (const claim of claims) {
          if (!permit.isCurrent()) return;
          await start(claim.automation, claim.run, permit, claim);
        }
      })().catch(() => undefined);
      inbox.current = task;
      try {
        await task;
      } finally {
        if (inbox.current === task) inbox.current = null;
      }
    },
    [capture, start],
  );

  return useMemo(
    () => ({ launch, onInboxAppeared }),
    [launch, onInboxAppeared],
  );
}
