import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useInputNotifications } from "@/modules/harness/hooks/useInputNotifications";
import { syncDockBadge } from "@/modules/harness/lib/dockBadge";
import { setWindowFocused } from "@/modules/harness/lib/notifications";
import type { Session } from "@/modules/harness/lib/session";

type Inputs = {
  sessions: Session[];
  sessionsRef: Readonly<{ current: Session[] }>;
  isForeground: (id: string) => boolean;
  flushHarnessEvents: () => void;
  flushForegroundHarnessEvents: () => void;
};

export function useHarnessWindowAttention(inputs: Inputs) {
  const latest = useRef(inputs);
  latest.current = inputs;
  useInputNotifications(inputs.sessions, undefined, inputs.isForeground);

  useEffect(() => {
    syncDockBadge(inputs.sessions);
  }, [inputs.sessions]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const onVisible = () => {
      if (active) latest.current.flushHarnessEvents();
    };
    document.addEventListener("visibilitychange", onVisible);
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!active) return;
        setWindowFocused(focused);
        if (!focused) return;
        latest.current.flushForegroundHarnessEvents();
        syncDockBadge(latest.current.sessionsRef.current);
      })
      .then((dispose) => {
        if (active) unlisten = dispose;
        else dispose();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      unlisten?.();
    };
  }, []);
}
