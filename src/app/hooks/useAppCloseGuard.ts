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
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { windowCloseParticipants } from "@/modules/lifecycle/windowCloseParticipants";

type CloseParticipants = ReturnType<typeof windowCloseParticipants.capture>;

function closeScope(tabs: Tab[]): string {
  return JSON.stringify(
    tabs.map((tab) => [
      tab.tabKey,
      tab.workspaceScopeId,
      tab.spaceId,
      tab.kind,
      !!tab.locked,
      tab.kind === "editor" ? [tab.path, tab.dirty] : null,
      tab.kind === "terminal" ? leafIds(tab.paneTree) : null,
    ]),
  );
}

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
  busyHarness?: boolean;
};

/**
 * The opt-out only covers running processes, so it stays hidden whenever the
 * same prompt is also the last warning before discarding unsaved buffers.
 */
export function canOptOutOfAppClosePrompt(blocker: AppCloseBlocker): boolean {
  return (
    blocker.busyTerminal && !blocker.busyHarness && blocker.dirtyEditors === 0
  );
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
  const checking = useRef(false);
  const requestedQuit = useRef(false);
  const generation = useRef(0);
  const lifetime = useRef<object | null>(null);
  const participants = useRef<CloseParticipants | null>(null);
  const pending = useRef<AppCloseBlocker | null>(null);
  const pendingScope = useRef("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: A replacement promoter retires the old close authority.
  useLayoutEffect(() => {
    const original = {};
    lifetime.current = original;
    setPendingAppClose(null);
    return () => {
      if (lifetime.current === original) lifetime.current = null;
      generation.current++;
      participants.current?.cancel();
      participants.current = null;
      pending.current = null;
      checking.current = false;
      closing.current = false;
      forceClose.current = false;
    };
  }, [flushAndPromoteSession]);

  const finishClose = useCallback(
    async (capture: CloseParticipants, isCurrent: () => boolean) => {
      if (closing.current || !isCurrent()) return;
      closing.current = true;
      participants.current = capture;
      const scope = closeScope(tabsRef.current);
      const admitted = () =>
        isCurrent() &&
        capture.isCurrent() &&
        closeScope(tabsRef.current) === scope;
      try {
        await capture.prepare();
        if (!admitted()) throw new Error("Window close ownership changed.");
        await promoteSessionThenExit(flushAndPromoteSession, async () => {
          if (!admitted()) throw new Error("Window close ownership changed.");
          forceClose.current = true;
          await invoke("app_exit_after_flush");
        });
      } catch {
        capture.cancel();
        if (isCurrent()) {
          forceClose.current = false;
          const { toast } = await import("sonner");
          const { t: translate } = await import("@/modules/i18n");
          if (isCurrent())
            toast.error(translate("feedback.sessionSaveFailed"), {
              id: "session-save-failed",
            });
        }
      } finally {
        if (isCurrent()) closing.current = false;
      }
    },
    [flushAndPromoteSession, tabsRef],
  );

  const beginClose = useCallback(
    async (
      original: object | null,
      approved?: { blocker: AppCloseBlocker; scope: string; current: boolean },
    ) => {
      if (
        !original ||
        lifetime.current !== original ||
        checking.current ||
        closing.current
      )
        return;
      checking.current = true;
      const request = ++generation.current;
      const isCurrent = () =>
        lifetime.current === original && generation.current === request;
      let capture: CloseParticipants | undefined;
      try {
        capture = windowCloseParticipants.capture();
        if (!approved && !requestedQuit.current && capture.closeToTray) {
          participants.current = capture;
          await capture.hide();
          capture.cancel();
          return;
        }
        capture.cancel();
        const busyTerminal =
          usePreferencesStore.getState().confirmCloseRunningTerminal &&
          (await anyTerminalBusy(tabsRef.current));
        if (!isCurrent()) return;
        const lockedTabs = tabsRef.current.filter((tab) => tab.locked).length;
        if (lockedTabs) {
          const { toast } = await import("sonner");
          const { t: translate } = await import("@/modules/i18n");
          if (isCurrent())
            toast.error(
              translate("tabs.cannotCloseAppWithLockedTabs", {
                count: lockedTabs,
              }),
              { id: "locked-tabs-app-close-guard" },
            );
          pending.current = null;
          setPendingAppClose(null);
          return;
        }
        capture = windowCloseParticipants.capture();
        participants.current = capture;
        if (!capture.isCurrent())
          throw new Error("Window close ownership changed.");
        const blocker: AppCloseBlocker = {
          dirtyEditors: tabsRef.current.filter(
            (tab) => tab.kind === "editor" && tab.dirty,
          ).length,
          busyTerminal,
          busyHarness: capture.busy,
        };
        const scope = closeScope(tabsRef.current);
        const needsConfirmation =
          blocker.dirtyEditors > 0 ||
          blocker.busyTerminal ||
          blocker.busyHarness;
        const needsNewApproval =
          !approved?.current ||
          approved.scope !== scope ||
          (blocker.busyTerminal && !approved.blocker.busyTerminal) ||
          (blocker.busyHarness && !approved.blocker.busyHarness);
        if (needsConfirmation && needsNewApproval) {
          pending.current = blocker;
          pendingScope.current = scope;
          setPendingAppClose(blocker);
        } else {
          pending.current = null;
          setPendingAppClose(null);
          await finishClose(capture, isCurrent);
        }
      } catch {
        capture?.cancel();
        if (isCurrent()) {
          const { toast } = await import("sonner");
          const { t: translate } = await import("@/modules/i18n");
          if (isCurrent())
            toast.error(translate("feedback.sessionSaveFailed"), {
              id: "session-save-failed",
            });
        }
      } finally {
        if (isCurrent()) {
          checking.current = false;
          requestedQuit.current = false;
        }
      }
    },
    [tabsRef, finishClose],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const original = lifetime.current;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (disposed || lifetime.current !== original) {
          event.preventDefault();
          return;
        }
        if (forceClose.current) return;
        event.preventDefault();
        if (!pending.current) void beginClose(original);
      })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [beginClose]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen("voktty:request-app-close", () => {
      if (disposed) return;
      requestedQuit.current = true;
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
    if (!pending.current) return;
    const approved = {
      blocker: pending.current,
      scope: pendingScope.current,
      current: participants.current?.isCurrent() === true,
    };
    participants.current?.cancel();
    await beginClose(lifetime.current, approved);
  }, [beginClose]);

  const cancelAppClose = useCallback(() => {
    generation.current++;
    participants.current?.cancel();
    participants.current = null;
    pending.current = null;
    checking.current = false;
    closing.current = false;
    requestedQuit.current = false;
    setPendingAppClose(null);
  }, []);

  return { pendingAppClose, confirmAppClose, cancelAppClose };
}
