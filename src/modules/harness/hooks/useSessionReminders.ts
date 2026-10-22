import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/modules/i18n";
import type {
  PersistenceOwner,
  PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import {
  loadNotificationsEnabled,
  NOTIFICATIONS_CHANGE_EVENT,
} from "../lib/notifications";
import { loadSoundsEnabled, SOUNDS_CHANGE_EVENT } from "../lib/sounds";
import {
  clearReminders,
  listReminders,
  REMINDER_OPEN,
  REMINDERS_CHANGED,
  setReminders,
  type ReminderTarget,
  type SessionReminder,
} from "../lib/sessionReminders";

type ReminderCallbacks = {
  onOpenSession: (
    sessionId: string,
    permit?: PersistencePermit,
  ) => Promise<void>;
  ensureSaved: (sessionIds: readonly string[]) => Promise<void>;
  getPersistenceOwner?: () => PersistenceOwner | null;
};
type ReminderAction = {
  callbacks: ReminderCallbacks;
  permit: PersistencePermit | undefined;
  isCurrent: () => boolean;
};

export function useSessionReminders(
  onOpenSession: ReminderCallbacks["onOpenSession"],
  ensureSaved: (sessionIds: readonly string[]) => Promise<void>,
  openSessionIds: readonly string[],
  getPersistenceOwner?: () => PersistenceOwner | null,
) {
  const [reminders, setItems] = useState<SessionReminder[]>([]);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const callbacks = useRef<ReminderCallbacks>({
    onOpenSession,
    ensureSaved,
    getPersistenceOwner,
  });
  callbacks.current = { onOpenSession, ensureSaved, getPersistenceOwner };
  const lifetime = useRef<object | null>(null);
  useEffect(() => {
    const owner = {};
    lifetime.current = owner;
    return () => {
      if (lifetime.current === owner) lifetime.current = null;
      revision.current++;
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

  const refreshCurrent = useCallback(async (isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    const request = ++revision.current;
    try {
      const items = await listReminders();
      if (request !== revision.current || !isCurrent()) return;
      setItems((previous) => (isCurrent() ? items : previous));
      setNow((previous) => (isCurrent() ? Date.now() : previous));
      setError((previous) => (isCurrent() ? null : previous));
    } catch (error) {
      if (request === revision.current && isCurrent()) {
        setError((previous) => (isCurrent() ? String(error) : previous));
      }
    }
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
    async (
      operation: (action: ReminderAction) => Promise<void>,
      onError: (error: unknown, isCurrent: () => boolean) => void = report,
    ) => {
      const action = capture();
      if (!action) return;
      const run = async () => {
        if (action.isCurrent()) await operation(action);
      };
      try {
        if (action.permit) await action.permit.run(run);
        else await run();
      } catch (error) {
        if (action.isCurrent()) onError(error, action.isCurrent);
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

  const openHere = useCallback(
    async (reminder: ReminderTarget, action: ReminderAction) => {
      if (action.permit)
        await action.callbacks.onOpenSession(reminder.sessionId, action.permit);
      else await action.callbacks.onOpenSession(reminder.sessionId);
      if (!action.isCurrent()) return;
      // An old notification must never clear a newer reminder for this session.
      await clearReminders([reminder.sessionId], reminder.dueAt);
      if (action.isCurrent()) await refreshCurrent(action.isCurrent);
    },
    [refreshCurrent],
  );

  useEffect(() => {
    let disposed = false;
    const setup = capture();
    const subscriptions: Array<() => void> = [];
    const configure = () => {
      if (disposed) return;
      void execute(
        async () => {
          await invoke("reminder_configure", {
            preferences: {
              notificationsEnabled: loadNotificationsEnabled(),
              sound: loadSoundsEnabled(),
            },
          });
        },
        (error, isCurrent) => {
          if (!disposed)
            setError((previous) => (isCurrent() ? String(error) : previous));
        },
      );
    };
    const takeOpen = async () => {
      if (disposed) return;
      await execute(
        async (action) => {
          const request = await invoke<ReminderTarget | null>(
            "reminder_take_pending_open",
          );
          if (request && !disposed && action.isCurrent())
            await openHere(request, action);
        },
        (error, isCurrent) => {
          if (!disposed)
            setError((previous) => (isCurrent() ? String(error) : previous));
        },
      );
    };
    const subscribe = async (event: string, handler: () => void) => {
      const unlisten = await listen(event, handler);
      if (disposed) unlisten();
      else subscriptions.push(unlisten);
    };
    void (async () => {
      try {
        await Promise.all([
          subscribe(REMINDERS_CHANGED, () => {
            if (!disposed) void refresh();
          }),
          subscribe(REMINDER_OPEN, () => {
            void takeOpen();
          }),
        ]);
        if (disposed || !setup?.isCurrent()) return;
        configure();
        await refreshCurrent(setup.isCurrent);
        if (!setup.isCurrent()) return;
        await takeOpen();
      } catch (error) {
        if (!disposed && setup?.isCurrent()) {
          setError((previous) =>
            setup.isCurrent() ? String(error) : previous,
          );
        }
      }
    })();
    const onFocus = () => {
      if (disposed) return;
      configure();
      void refresh();
      void takeOpen();
    };
    const onVisible = () => {
      if (!document.hidden) onFocus();
    };
    // The backend owns firing. This refresh catches renamed/deleted sessions,
    // missed events, and a machine waking after its scheduled time.
    const timer = window.setInterval(() => {
      if (!disposed) void refresh();
    }, 30_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NOTIFICATIONS_CHANGE_EVENT, configure);
    window.addEventListener(SOUNDS_CHANGE_EVENT, configure);
    window.addEventListener("storage", configure);
    return () => {
      disposed = true;
      subscriptions.forEach((unlisten) => unlisten());
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGE_EVENT, configure);
      window.removeEventListener(SOUNDS_CHANGE_EVENT, configure);
      window.removeEventListener("storage", configure);
    };
  }, [openHere, refresh, refreshCurrent, execute, capture]);

  const sessionIdsKey = JSON.stringify(openSessionIds);
  useEffect(() => {
    void execute(
      async () => {
        await invoke("reminder_register_window", {
          sessionIds: JSON.parse(sessionIdsKey),
        });
      },
      (error, isCurrent) =>
        setError((previous) => (isCurrent() ? String(error) : previous)),
    );
  }, [sessionIdsKey, execute]);

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
    reminders,
    due: reminders.filter((reminder) => reminder.dueAt <= now),
    error,
    refresh,
    schedule,
    cancel,
    open,
  };
}
