import { invoke } from "@tauri-apps/api/core";
import { useContext, useEffect, useRef, useState } from "react";
import { HarnessReminderWindowContext } from "@/modules/harness/hooks/harnessReminderWindowContext";
import { normalizeHarnessSessionViewReport } from "@/modules/harness/lib/harnessSessionViews";
import type { PersistenceOwner } from "@/modules/harness/lib/persistenceAdmission";

type Registration = {
  sessionIds: readonly string[];
  isCurrent: () => boolean;
  run: (write: () => Promise<void>) => Promise<unknown>;
};

export function useHarnessReminderWindow(
  sessionIds: readonly string[],
  getOwner?: () => PersistenceOwner | null,
  revision = 0,
) {
  const managed = useContext(HarnessReminderWindowContext);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef<object | null>(null);
  const lane = useRef<{
    pending: Registration | null;
    running: boolean;
  }>({ pending: null, running: false });
  const key = JSON.stringify({
    sessionIds: normalizeHarnessSessionViewReport({
      referencedSessionIds: sessionIds,
    }).referencedSessionIds,
    revision,
  });

  useEffect(() => {
    const owner = {};
    lifetime.current = owner;
    return () => {
      if (lifetime.current !== owner) return;
      lifetime.current = null;
      lane.current.pending = null;
    };
  }, []);

  useEffect(() => {
    if (managed) return;
    const owner = lifetime.current;
    const permit = getOwner?.()?.capture();
    if (!owner || (getOwner && !permit)) return;
    let active = true;
    const isCurrent = () =>
      active && lifetime.current === owner && (!permit || permit.isCurrent());
    const registration: Registration = {
      sessionIds: JSON.parse(key).sessionIds,
      isCurrent,
      run: (write) => (permit ? permit.run(write) : write()),
    };
    const queue = lane.current;
    queue.pending = registration;
    const drain = async () => {
      if (queue.running) return;
      queue.running = true;
      try {
        while (queue.pending) {
          const request = queue.pending;
          queue.pending = null;
          if (!request.isCurrent()) continue;
          try {
            await request.run(async () => {
              if (!request.isCurrent()) return;
              await invoke("reminder_register_window", {
                sessionIds: request.sessionIds,
              });
            });
            if (request.isCurrent())
              setError((previous) => (request.isCurrent() ? null : previous));
          } catch (error) {
            if (request.isCurrent())
              setError((previous) =>
                request.isCurrent() ? String(error) : previous,
              );
          }
        }
      } finally {
        queue.running = false;
      }
    };
    void drain();
    return () => {
      active = false;
      if (queue.pending === registration) queue.pending = null;
    };
  }, [key, getOwner, managed]);

  return managed ? null : error;
}
