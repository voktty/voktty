import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { captureHarnessProjectOpening } from "@/modules/surfaces/lib/harnessProjectRequest";
import { loadRecents, type RecentProject } from "@/modules/harness/lib/recents";
import {
  loadHarnessNotchEnabled,
  subscribeHarnessNotchEnabled,
} from "@/modules/harness/lib/settings";
import { useNotchStore } from "@/modules/harness/lib/notchStore";
import type { LiveAgent } from "@/modules/harness/lib/liveAgents";
import { NotchEar } from "./notch/NotchEars";
import { NotchExpandedCard } from "./notch/NotchExpandedCard";
import { NotchPill } from "./notch/NotchPill";
import { NotchProjectLauncher } from "./notch/NotchProjectLauncher";

interface HarnessNotchProps {
  onOpenProject?: (path: string) => void;
}

export function HarnessNotch({ onOpenProject }: HarnessNotchProps) {
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
    if (activeAgentId) {
      const match = liveAgents.find((a) => a.id === activeAgentId);
      if (match) return match;
    }
    return liveAgents[0] ?? null;
  }, [liveAgents, activeAgentId]);

  const activeSession = useMemo(() => {
    if (!activeAgent) return null;
    return sessions.find((s) => s.id === activeAgent.id) ?? null;
  }, [sessions, activeAgent]);

  const handleOpenProject = useCallback(
    (path: string) => {
      setExpanded(false);
      setIdleLauncherOpen(false);
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
    [onOpenProject, setExpanded, setIdleLauncherOpen],
  );

  if (!enabled) return null;

  const hasRunningAgents = liveAgents.length > 0;
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
        className={`fixed top-0 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center transition-all duration-300 ease-out select-none ${
          isVisible
            ? "translate-y-0 opacity-100 pointer-events-auto"
            : "-translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        {/* Notch Physical Pill Docked to the Top Edge */}
        <div className="relative flex items-center justify-center">
          {/* Left Ear transition curve */}
          <NotchEar side="left" className="text-black/90 dark:text-black/95 drop-shadow-sm" />

          {/* Center black notch capsule */}
          <div className="flex items-center justify-center bg-black/90 dark:bg-black/95 text-foreground rounded-b-2xl shadow-xl shadow-black/40 border-b border-x border-white/10 backdrop-blur-xl">
            <NotchPill
              liveAgents={liveAgents}
              activeAgent={activeAgent}
              onSelectAgent={(agent: LiveAgent) => setActiveAgentId(agent.id)}
              onExpand={() => setExpanded(!expanded)}
              onOpenProject={handleOpenProject}
              onToggleLauncher={toggleIdleLauncher}
              isLauncherOpen={idleLauncherOpen}
            />
          </div>

          {/* Right Ear transition curve */}
          <NotchEar side="right" className="text-black/90 dark:text-black/95 drop-shadow-sm" />
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
