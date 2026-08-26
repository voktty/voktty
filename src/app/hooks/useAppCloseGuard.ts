import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "@/modules/tabs";
import { leafHasForegroundProcess, leafIds } from "@/modules/terminal";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

async function anyTerminalBusy(tabs: Tab[]): Promise<boolean> {
  const leaves = tabs.flatMap((t) =>
    t.kind === "terminal" ? leafIds(t.paneTree) : [],
  );
  if (leaves.length === 0) return false;
  const checks = await Promise.all(leaves.map(leafHasForegroundProcess));
  return checks.some(Boolean);
}

export type AppCloseBlocker = {
  dirtyEditors: number;
  busyTerminal: boolean;
};

/**
 * The opt-out only covers running processes, so it stays hidden whenever the
 * same prompt is also the last warning before discarding unsaved buffers.
 */
export function canOptOutOfAppClosePrompt(blocker: AppCloseBlocker): boolean {
  return blocker.busyTerminal && blocker.dirtyEditors === 0;
}

export async function promoteSessionThenExit(
  promote: () => Promise<void>,
  exit: () => Promise<void>,
): Promise<void> {
  await promote();
  await exit();
}

export function useAppCloseGuard(
  tabsRef: RefObject<Tab[]>,
  flushAndPromoteSession: () => Promise<void>,
) {
  const [pendingAppClose, setPendingAppClose] =
    useState<AppCloseBlocker | null>(null);
  const forceClose = useRef(false);
  const closing = useRef(false);

  const finishClose = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      await promoteSessionThenExit(flushAndPromoteSession, async () => {
        forceClose.current = true;
        await invoke("app_exit_after_flush");
      });
    } catch (error) {
      closing.current = false;
      forceClose.current = false;
      const { toast } = await import("sonner");
      const { t: translate } = await import("@/modules/i18n");
      toast.error(translate("feedback.sessionSaveFailed"), {
        id: "session-save-failed",
      });
      console.error("[voktty] clean session promotion failed:", error);
    }
  }, [flushAndPromoteSession]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (forceClose.current) return;
        event.preventDefault();

        const lockedTabs = tabsRef.current.filter((t) => t.locked).length;
        if (lockedTabs > 0) {
          const { toast } = await import("sonner");
          const { t: translate } = await import("@/modules/i18n");
          toast.error(
            translate("tabs.cannotCloseAppWithLockedTabs", {
              count: lockedTabs,
              defaultValue:
                "Cannot close the application while tabs are locked. Please unlock them first.",
            }),
            { id: "locked-tabs-app-close-guard" },
          );
          return;
        }

        // Opting out skips the per-leaf IPC entirely; it never relaxes the
        // unsaved-changes guard below.
        const busyTerminal =
          usePreferencesStore.getState().confirmCloseRunningTerminal &&
          (await anyTerminalBusy(tabsRef.current));
        // Count after the await so edits made during the IPC check are seen.
        const dirtyEditors = tabsRef.current.filter(
          (t) => t.kind === "editor" && t.dirty,
        ).length;
        if (dirtyEditors > 0 || busyTerminal) {
          setPendingAppClose({ dirtyEditors, busyTerminal });
        } else {
          void finishClose();
        }
      })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [tabsRef, finishClose]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen("voktty:request-app-close", () => {
      void getCurrentWindow().close();
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const confirmAppClose = useCallback(async () => {
    const lockedTabs = tabsRef.current.filter((t) => t.locked).length;
    if (lockedTabs > 0) {
      const { toast } = await import("sonner");
      const { t: translate } = await import("@/modules/i18n");
      toast.error(
        translate("tabs.cannotCloseAppWithLockedTabs", {
          count: lockedTabs,
          defaultValue:
            "Cannot close the application while tabs are locked. Please unlock them first.",
        }),
        { id: "locked-tabs-app-close-guard" },
      );
      setPendingAppClose(null);
      return;
    }
    setPendingAppClose(null);
    await finishClose();
  }, [tabsRef, finishClose]);

  const cancelAppClose = useCallback(() => setPendingAppClose(null), []);

  return { pendingAppClose, confirmAppClose, cancelAppClose };
}
