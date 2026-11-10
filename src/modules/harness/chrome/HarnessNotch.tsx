import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { captureHarnessProjectOpening } from "@/modules/surfaces/lib/harnessProjectRequest";
import { loadRecents, type RecentProject } from "@/modules/harness/lib/recents";
import {
  loadHarnessNotchEnabled,
  subscribeHarnessNotchEnabled,
} from "@/modules/harness/lib/settings";
import { useNotchStore } from "@/modules/harness/lib/notchStore";
import {
  NOTCH_ACTION_EVENT,
  NOTCH_READY_EVENT,
  NOTCH_STATE_EVENT,
  shouldShowNotchOverlay,
  snapshotForOverlay,
  type NotchAction,
} from "@/modules/harness/lib/notchBridge";
import type { LiveAgent } from "@/modules/harness/lib/liveAgents";
import { NotchEar } from "./notch/NotchEars";
import { NotchExpandedCard } from "./notch/NotchExpandedCard";
import { NotchPill } from "./notch/NotchPill";
import { NotchProjectLauncher } from "./notch/NotchProjectLauncher";

interface HarnessNotchProps {
  onOpenProject?: (path: string) => void;
  /**
   * "app" runs inside the main window: it only offers the recent-projects
   * launcher and drives the native overlay. "overlay" runs inside the
   * always-on-top notch window and draws the live agents.
   */
  mode?: "app" | "overlay";
}

const OVERLAY_EXPANDED_WIDTH = 520;
const OVERLAY_LAUNCHER_WIDTH = 440;
// Matches the hover trigger strip (w-64 x h-2.5) so the idle window stays tiny.
const OVERLAY_HOVER_WIDTH = 256;
const OVERLAY_HOVER_HEIGHT = 10;
// Two 14px ears plus a little room so the shape is never clipped by the window.
const OVERLAY_PADDING = 40;
const OVERLAY_VERTICAL_PADDING = 20;
const SNAPSHOT_THROTTLE_MS = 250;

/**
 * Main-window side of the overlay: shows or hides the native notch window from
 * app focus and live agents, feeds it snapshots and applies its actions.
 */
function useNotchOverlayHost(
  enabled: boolean,
  onOpenProject: (path: string) => void,
) {
  const liveAgents = useNotchStore((state) => state.liveAgents);
  const sessions = useNotchStore((state) => state.sessions);
  const [appFocused, setAppFocused] = useState(true);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const win = getCurrentWindow();
        const focused = await win.isFocused();
        if (!disposed) setAppFocused(focused);
        unlisten = await win.onFocusChanged(({ payload }) => {
          if (!disposed) setAppFocused(payload);
        });
      } catch {
        // Not running inside Tauri (tests, browser preview): no overlay.
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const visible = shouldShowNotchOverlay({
    enabled,
    appFocused,
  });

  useEffect(() => {
    void invoke(visible ? "notch_window_show" : "notch_window_hide").catch(
      () => undefined,
    );
  }, [visible]);

  const latest = useRef({ liveAgents, sessions });
  latest.current = { liveAgents, sessions };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publish = useCallback(() => {
    const { liveAgents: agents, sessions: all } = latest.current;
    void emit(NOTCH_STATE_EVENT, snapshotForOverlay(agents, all)).catch(
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (!visible || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      publish();
    }, SNAPSHOT_THROTTLE_MS);
  }, [visible, liveAgents, sessions, publish]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      try {
        const offReady = await listen(NOTCH_READY_EVENT, publish);
        const offAction = await listen<NotchAction>(
          NOTCH_ACTION_EVENT,
          ({ payload }) => {
            if (payload.kind === "approval") {
              useNotchStore
                .getState()
                .onApproval?.(
                  payload.sessionId,
                  payload.approvalId,
                  payload.decision,
                );
              return;
            }
            if (payload.kind === "open") {
              const win = getCurrentWindow();
              void win.unminimize().catch(() => undefined);
              void win.show().catch(() => undefined);
              void win.setFocus().catch(() => undefined);
              onOpenProject(payload.cwd);
            }
          },
        );
        if (disposed) {
          offReady();
          offAction();
          return;
        }
        unlisteners.push(offReady, offAction);
      } catch {
        // Not running inside Tauri.
      }
    })();
    return () => {
      disposed = true;
      for (const off of unlisteners) off();
    };
  }, [publish, onOpenProject]);
}

export function HarnessNotch({
  onOpenProject,
  mode = "app",
}: HarnessNotchProps) {
  const overlay = mode === "overlay";
  const enabled = useSyncExternalStore(
    subscribeHarnessNotchEnabled,
    loadHarnessNotchEnabled,
    () => true,
  );

  const {
    expanded,
    activeAgentId,
    idleLauncherOpen,
    liveAgents,
    sessions,
    onApproval,
    onSubmit,
    setExpanded,
    setActiveAgentId,
    setIdleLauncherOpen,
    toggleIdleLauncher,
  } = useNotchStore();

  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [topHovered, setTopHovered] = useState(false);
  const notchRef = useRef<HTMLDivElement>(null);

  // Load recent projects when idle launcher is accessed
  useEffect(() => {
    if (idleLauncherOpen || topHovered) {
      setRecentProjects(loadRecents());
    }
  }, [idleLauncherOpen, topHovered]);

  // Click outside to collapse expanded card or launcher
  useEffect(() => {
    if (!expanded && !idleLauncherOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (notchRef.current && !notchRef.current.contains(e.target as Node)) {
        setExpanded(false);
        setIdleLauncherOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded, idleLauncherOpen, setExpanded, setIdleLauncherOpen]);

  const activeAgent = useMemo(() => {
    // Inside Voktty the notch is only the project launcher.
    if (!overlay) return null;
    if (activeAgentId) {
      const match = liveAgents.find((a) => a.id === activeAgentId);
      if (match) return match;
    }
    return liveAgents[0] ?? null;
  }, [liveAgents, activeAgentId, overlay]);

  const activeSession = useMemo(() => {
    if (!activeAgent) return null;
    return sessions.find((s) => s.id === activeAgent.id) ?? null;
  }, [sessions, activeAgent]);

  const handleOpenProject = useCallback(
    (path: string) => {
      setExpanded(false);
      setIdleLauncherOpen(false);
      if (overlay) {
        const action: NotchAction = { kind: "open", cwd: path };
        void emit(NOTCH_ACTION_EVENT, action).catch(() => undefined);
        return;
      }
      if (onOpenProject) {
        onOpenProject(path);
      }
      try {
        const openHarness = captureHarnessProjectOpening();
        openHarness(path);
      } catch {
        // Fallback or no receiver yet
      }
    },
    [onOpenProject, overlay, setExpanded, setIdleLauncherOpen],
  );

  useNotchOverlayHost(
    enabled && !overlay,
    useCallback(
      (path: string) => {
        try {
          captureHarnessProjectOpening()(path);
        } catch {
          // No Harness receiver yet.
        }
        onOpenProject?.(path);
      },
      [onOpenProject],
    ),
  );

  // Idle overlay is only the hover strip: a bigger transparent window would
  // swallow clicks meant for whatever is behind it.
  const revealed =
    liveAgents.length > 0 || idleLauncherOpen || topHovered || expanded;
  useEffect(() => {
    if (!overlay) return;
    if (!revealed) {
      void invoke("notch_window_fit", {
        width: OVERLAY_HOVER_WIDTH,
        height: OVERLAY_HOVER_HEIGHT,
      }).catch(() => undefined);
      return;
    }
    const node = notchRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const state = useNotchStore.getState();
      const width = state.expanded
        ? OVERLAY_EXPANDED_WIDTH
        : state.idleLauncherOpen
          ? OVERLAY_LAUNCHER_WIDTH
          : node.offsetWidth + OVERLAY_PADDING;
      void invoke("notch_window_fit", {
        width,
        height: node.offsetHeight + OVERLAY_VERTICAL_PADDING,
      }).catch(() => undefined);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    fit();
    return () => observer.disconnect();
  }, [overlay, revealed, expanded, idleLauncherOpen]);

  if (!enabled && !overlay) return null;

  // Live agents are shown only by the native overlay: inside Voktty the
  // Harness already has them, and the overlay is for watching from outside.
  const hasRunningAgents = overlay && liveAgents.length > 0;
  const isVisible = hasRunningAgents || idleLauncherOpen || topHovered;

  return (
    <>
      {/* Invisible top hover trigger zone when notch is resting idle */}
      {!hasRunningAgents && !idleLauncherOpen && (
        <div
          onMouseEnter={() => setTopHovered(true)}
          className="fixed top-0 left-1/2 -translate-x-1/2 h-2.5 w-64 z-[9998] pointer-events-auto"
        />
      )}

      {/* Notch Shell */}
      <div
        ref={notchRef}
        onMouseLeave={() => {
          setTopHovered(false);
        }}
        className={`fixed top-0 left-1/2 -translate-x-1/2 z-[9999] flex w-max max-w-none flex-col items-center whitespace-nowrap transition-all duration-300 ease-out select-none ${
          isVisible
            ? "translate-y-0 opacity-100 pointer-events-auto"
            : "-translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        {/* Notch Physical Pill Docked to the Top Edge */}
        <div className="relative flex items-start justify-center">
          {/* Left Ear transition curve */}
          <NotchEar side="left" className="text-black" />

          {/* Center black notch capsule */}
          <div className="flex items-center justify-center bg-black text-foreground rounded-b-2xl shadow-xl shadow-black/40">
            <NotchPill
              liveAgents={overlay ? liveAgents : []}
              activeAgent={activeAgent}
              onSelectAgent={(agent: LiveAgent) => setActiveAgentId(agent.id)}
              onExpand={() => setExpanded(!expanded)}
              onOpenProject={handleOpenProject}
              onToggleLauncher={toggleIdleLauncher}
              isLauncherOpen={idleLauncherOpen}
            />
          </div>

          {/* Right Ear transition curve */}
          <NotchEar side="right" className="text-black" />
        </div>

        {/* Expanded View: Code Summary / Diff / Aprobaciones */}
        {expanded && activeSession && (
          <div className="mt-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
            <NotchExpandedCard
              session={activeSession}
              onClose={() => setExpanded(false)}
              onOpenProject={handleOpenProject}
              onApproval={onApproval ?? undefined}
              onSubmit={onSubmit ?? undefined}
            />
          </div>
        )}

        {/* Inactive Project Launcher Menu */}
        {idleLauncherOpen && !expanded && (
          <div className="mt-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
            <NotchProjectLauncher
              projects={recentProjects}
              onOpenProject={handleOpenProject}
              onClose={() => setIdleLauncherOpen(false)}
            />
          </div>
        )}
      </div>
    </>
  );
}
