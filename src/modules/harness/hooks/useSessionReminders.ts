import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef } from "react";
import { t } from "@/modules/i18n";
import { useHarnessReminderWindow } from "@/modules/harness/hooks/useHarnessReminderWindow";
import { useHarnessReminderService } from "@/modules/harness/hooks/useHarnessReminderService";
import type { ReminderSessionOpener } from "@/modules/harness/hooks/harnessReminderServiceContext";
import type {
  PersistenceOwner,
  PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import {
  clearReminders,
  setReminders,
  type ReminderTarget,
} from "@/modules/harness/lib/sessionReminders";

type ReminderCallbacks = {
  ensureSaved: (sessionIds: readonly string[]) => Promise<void>;
  getPersistenceOwner?: () => PersistenceOwner | null;
};
type ReminderAction = {
  callbacks: ReminderCallbacks;
  permit: PersistencePermit | undefined;
  isCurrent: () => boolean;
};

export function useSessionReminders(
  onOpenSession: ReminderSessionOpener,
  ensureSaved: (sessionIds: readonly string[]) => Promise<void>,
  openSessionIds: readonly string[],
  getPersistenceOwner?: () => PersistenceOwner | null,
) {
  const registrationError = useHarnessReminderWindow(
    openSessionIds,
    getPersistenceOwner,
  );
  const service = useHarnessReminderService(onOpenSession, getPersistenceOwner);
  const { refreshCurrent } = service;
  const callbacks = useRef<ReminderCallbacks>({
    ensureSaved,
    getPersistenceOwner,
  });
  callbacks.current = { ensureSaved, getPersistenceOwner };
  const lifetime = useRef<object | null>(null);
  useEffect(() => {
    const owner = {};
    lifetime.current = owner;
    return () => {
      if (lifetime.current === owner) lifetime.current = null;
    };
  }, []);

  const capture = useCallback((): ReminderAction | null => {
    const owner = lifetime.current;
    const current = callbacks.current;
    const permit = current.getPersistenceOwner?.()?.capture();
    if (!owner || (current.getPersistenceOwner && !permit)) return null;
    return {
      callbacks: current,
      permit: permit ?? undefined,
      isCurrent: () =>
        lifetime.current === owner && (!permit || permit.isCurrent()),
    };
  }, []);

  const refresh = useCallback(async () => {
    const action = capture();
    if (action) await refreshCurrent(action.isCurrent);
  }, [capture, refreshCurrent]);

  const report = useCallback((error: unknown) => {
    void message(String(error), {
      title: t("harness.reminders.reminder"),
      kind: "error",
    });
  }, []);

  const execute = useCallback(
    async (operation: (action: ReminderAction) => Promise<void>) => {
      const action = capture();
      if (!action) return;
      const run = async () => {
        if (action.isCurrent()) await operation(action);
      };
      try {
        if (action.permit) await action.permit.run(run);
        else await run();
      } catch (error) {
        if (action.isCurrent()) report(error);
      }
    },
    [capture, report],
  );

  const schedule = useCallback(
    async (ids: readonly string[], dueAt: number) => {
      const selection = [...ids];
      await execute(async ({ callbacks: current, isCurrent }) => {
        await current.ensureSaved(selection);
        if (!isCurrent()) return;
        await setReminders(selection, dueAt);
        if (isCurrent()) await refreshCurrent(isCurrent);
      });
    },
    [execute, refreshCurrent],
  );

  const cancel = useCallback(
    async (ids: readonly string[], expectedDueAt?: number) => {
      const selection = [...ids];
      await execute(async ({ isCurrent }) => {
        await clearReminders(selection, expectedDueAt);
        if (isCurrent()) await refreshCurrent(isCurrent);
      });
    },
    [execute, refreshCurrent],
  );

  const open = useCallback(
    async (reminder: ReminderTarget) => {
      const target = { sessionId: reminder.sessionId, dueAt: reminder.dueAt };
      await execute(async () => {
        await invoke("reminder_open", {
          sessionId: target.sessionId,
          dueAt: target.dueAt,
        });
      });
    },
    [execute],
  );

  return {
    reminders: service.reminders,
    due: service.due,
    error: service.error ?? registrationError,
    refresh,
    schedule,
    cancel,
    open,
  };
}
