import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import type { HarnessQuitCapture } from "@/modules/harness/lib/appLifecycle";
import { ownHarnessWindowPersistence } from "@/modules/harness/lib/harnessWindowPersistence";
import type { PersistenceOwner } from "@/modules/harness/lib/persistenceAdmission";
import { loadCloseToTray } from "@/modules/harness/lib/settings";
import { toast } from "sonner";
import { t } from "@/modules/i18n";

type Inputs = {
  getOwner: () => PersistenceOwner | null;
  read: () => HarnessQuitCapture;
  workspace: HarnessQuitCapture;
  flush: () => void;
  skipSnapshot: boolean;
  revision: number;
};

export function useHarnessWindowPersistence(inputs: Inputs) {
  const latest = useRef(inputs);
  latest.current = inputs;
  const controller = useRef<ReturnType<
    typeof ownHarnessWindowPersistence
  > | null>(null);
  const { getOwner, revision, workspace, skipSnapshot } = inputs;

  useEffect(() => {
    const owner = getOwner();
    if (!owner) return;
    const current = ownHarnessWindowPersistence({
      owner,
      read: () => latest.current.read(),
      flush: () => latest.current.flush(),
      skipSnapshot: () => latest.current.skipSnapshot,
      closeToTray: loadCloseToTray,
      onError: () => {
        toast.error(t("feedback.sessionSaveFailed"), { id: "session-save-failed" });
      },
      target: window,
      registerClose: (listener) =>
        getCurrentWindow().onCloseRequested(listener),
      schedule: (callback, delay) => {
        const timer = window.setTimeout(callback, delay);
        return () => window.clearTimeout(timer);
      },
    });
    controller.current = current;
    return () => {
      current.release();
      if (controller.current === current) controller.current = null;
    };
  }, [getOwner]);

  useEffect(() => {
    if (revision > 0) controller.current?.resume();
  }, [revision]);

  useEffect(() => {
    controller.current?.publish(workspace, skipSnapshot);
  }, [workspace, skipSnapshot]);
}
