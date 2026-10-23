import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  HarnessReminderServiceContext,
  type ReminderSessionOpener,
} from "@/modules/harness/hooks/harnessReminderServiceContext";
import type {
  PersistenceOwner,
  PersistencePermit,
} from "@/modules/harness/lib/persistenceAdmission";
import {
  loadNotificationsEnabled,
  NOTIFICATIONS_CHANGE_EVENT,
} from "@/modules/harness/lib/notifications";
import {
  loadSoundsEnabled,
  SOUNDS_CHANGE_EVENT,
} from "@/modules/harness/lib/sounds";
import {
  clearReminders,
  listReminders,
  REMINDER_OPEN,
  REMINDERS_CHANGED,
  type ReminderTarget,
  type SessionReminder,
} from "@/modules/harness/lib/sessionReminders";

type Action = {
  open: ReminderSessionOpener | undefined;
  permit: PersistencePermit | undefined;
  isCurrent: () => boolean;
};

export function useHarnessReminderService(
  onOpenSession: ReminderSessionOpener | undefined,
  getOwner?: () => PersistenceOwner | null,
) {
  const shared = useContext(HarnessReminderServiceContext);
  const managed = shared !== null;
  const canOpen = onOpenSession !== undefined;
  const callbacks = useRef({ onOpenSession, getOwner });
  callbacks.current = { onOpenSession, getOwner };
  const [reminders, setItems] = useState<SessionReminder[]>([]);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const lifetime = useRef<object | null>(null);
  useEffect(() => {
    const owner = {};
    lifetime.current = owner;
    return () => {
      if (lifetime.current === owner) lifetime.current = null;
      revision.current++;
    };
  }, []);

  const capture = useCallback((): Action | null => {
    const owner = lifetime.current;
    const current = callbacks.current;
    const permit = current.getOwner?.()?.capture();
    if (!owner || (current.getOwner && !permit)) return null;
    return {
      open: current.onOpenSession,
      permit: permit ?? undefined,
      isCurrent: () =>
        lifetime.current === owner && (!permit || permit.isCurrent()),
    };
  }, []);

  const refreshCurrent = useCallback(async (callerCurrent: () => boolean) => {
    const owner = lifetime.current;
    const isCurrent = () =>
      owner !== null && lifetime.current === owner && callerCurrent();
    if (!isCurrent()) return;
    const request = ++revision.current;
    try {
      const items = await listReminders();
      if (request !== revision.current || !isCurrent()) return;
      setItems((previous) => (isCurrent() ? items : previous));
      setNow((previous) => (isCurrent() ? Date.now() : previous));
      setError((previous) => (isCurrent() ? null : previous));
    } catch (error) {
      if (request === revision.current && isCurrent())
        setError((previous) => (isCurrent() ? String(error) : previous));
    }
  }, []);

  useEffect(() => {
    if (managed) return;
    let disposed = false;
    let takingOpen = false;
    let pendingOpen: Action | null = null;
    const captureCurrent = (): Action | null => {
      const action = capture();
      return action
        ? { ...action, isCurrent: () => !disposed && action.isCurrent() }
        : null;
    };
    const setup = captureCurrent();
    const subscriptions: Array<() => void> = [];
    const execute = async (
      action: Action | null,
      operation: (action: Action) => Promise<void>,
    ) => {
      if (!action || disposed) return;
      const run = async () => {
        if (!disposed && action.isCurrent()) await operation(action);
      };
      try {
        if (action.permit) await action.permit.run(run);
        else await run();
      } catch (error) {
        if (!disposed && action.isCurrent())
          setError((previous) =>
            action.isCurrent() ? String(error) : previous,
          );
      }
    };
    const refresh = async () => {
      const action = captureCurrent();
      if (!disposed && action) await refreshCurrent(action.isCurrent);
    };
    const configure = () => {
      if (disposed) return;
      void execute(captureCurrent(), async () => {
        await invoke("reminder_configure", {
          preferences: {
            notificationsEnabled: loadNotificationsEnabled(),
            sound: loadSoundsEnabled(),
          },
        });
      });
    };
    const takeOpen = async () => {
      if (disposed || !canOpen) return;
      pendingOpen = captureCurrent();
      if (takingOpen || !pendingOpen) return;
      takingOpen = true;
      try {
        while (pendingOpen && !disposed) {
          const action = pendingOpen;
          pendingOpen = null;
          await execute(action, async (captured) => {
            if (!captured.open) return;
            const request = await invoke<ReminderTarget | null>(
              "reminder_take_pending_open",
            );
            if (!request || disposed || !captured.isCurrent()) return;
            const opened = captured.permit
              ? await captured.open(request.sessionId, captured.permit)
              : await captured.open(request.sessionId);
            if (opened === false || disposed || !captured.isCurrent()) return;
            await clearReminders([request.sessionId], request.dueAt);
            if (!disposed && captured.isCurrent())
              await refreshCurrent(captured.isCurrent);
          });
        }
      } finally {
        takingOpen = false;
      }
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
        if (setup.isCurrent()) await takeOpen();
      } catch (error) {
        if (!disposed && setup?.isCurrent())
          setError((previous) =>
            setup.isCurrent() ? String(error) : previous,
          );
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
      pendingOpen = null;
      for (const unlisten of subscriptions) unlisten();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGE_EVENT, configure);
      window.removeEventListener(SOUNDS_CHANGE_EVENT, configure);
      window.removeEventListener("storage", configure);
    };
  }, [managed, canOpen, capture, refreshCurrent]);

  const service = useMemo(
    () => ({
      reminders,
      due: reminders.filter((reminder) => reminder.dueAt <= now),
      error,
      refreshCurrent,
    }),
    [reminders, now, error, refreshCurrent],
  );
  return shared ?? service;
}
