import { useEffect, useState } from "react";
import { ProjectMascot } from "@/modules/harness/chrome/ProjectMascot";
import { formatLiveElapsed, type LiveAgent } from "@/modules/harness/lib/liveAgents";
import { projectName } from "@/modules/harness/lib/paths";
import { resolveTabGroupColor } from "@/modules/harness/lib/tabGroups";
import { useTranslation } from "@/modules/i18n";

interface NotchPillProps {
  liveAgents: LiveAgent[];
  activeAgent: LiveAgent | null;
  onSelectAgent: (agent: LiveAgent) => void;
  onExpand: () => void;
  onOpenProject: (cwd: string) => void;
  onToggleLauncher: () => void;
  isLauncherOpen: boolean;
}

export function NotchPill({
  liveAgents,
  activeAgent,
  onSelectAgent,
  onExpand,
  onOpenProject,
  onToggleLauncher,
  isLauncherOpen,
}: NotchPillProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!activeAgent?.startedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeAgent?.startedAt]);

  if (!activeAgent) {
    // Idle state pill
    return (
      <div className="flex items-center gap-2 px-3 py-1 text-xs select-none">
        <button
          type="button"
          onClick={onToggleLauncher}
          className="flex items-center gap-1.5 text-content/70 hover:text-content transition-colors"
          title={isLauncherOpen ? t("harness.notch.hideLauncher") : t("harness.notch.showLauncher")}
        >
          <span className="size-2 rounded-full bg-emerald-500/80 animate-pulse" />
          <span className="font-mono text-[11px] font-medium tracking-tight">
            {t("harness.notch.idleLauncher")}
          </span>
        </button>
      </div>
    );
  }

  const projectTitle = projectName(activeAgent.cwd);
  const color = resolveTabGroupColor(activeAgent.cwd);
  const elapsed = activeAgent.startedAt ? formatLiveElapsed(activeAgent.startedAt, now) : null;

  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 text-xs select-none">
      {/* Click on active mascot opens project in Harness immediately */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenProject(activeAgent.cwd);
        }}
        className="group relative flex items-center justify-center p-0.5 rounded transition-transform hover:scale-110 focus:outline-none"
        title={t("harness.notch.resumeProject", { name: projectTitle })}
      >
        <ProjectMascot
          project={activeAgent.cwd}
          active={!activeAgent.done}
          color={color}
          className="size-4 drop-shadow-sm"
        />
        {activeAgent.needsApproval && (
          <span className="absolute -top-1 -right-1 size-2 rounded-full bg-amber-500 animate-ping" />
        )}
      </button>

      {/* Main info row: click expands the summary card */}
      <button
        type="button"
        onClick={onExpand}
        className="flex items-center gap-2 text-left focus:outline-none hover:opacity-90 transition-opacity"
      >
        <span className="font-semibold text-content tracking-tight max-w-[130px] truncate">
          {projectTitle}
        </span>

        <span className="h-3 w-px bg-content/15" />

        <span
          className={`text-[11px] max-w-[180px] truncate ${
            activeAgent.needsApproval
              ? "text-amber-400 font-medium"
              : activeAgent.done
                ? "text-emerald-400"
                : "text-content/75"
          }`}
        >
          {activeAgent.needsApproval
            ? t("harness.notch.waitingForApproval")
            : activeAgent.activity}
        </span>

        {elapsed && (
          <span className="font-mono text-[10px] text-content/50 tabular-nums">
            {elapsed}
          </span>
        )}
      </button>

      {/* Multi-project secondary indicators */}
      {liveAgents.length > 1 && (
        <div className="flex items-center gap-1 pl-1 border-l border-content/15">
          {liveAgents
            .filter((a) => a.id !== activeAgent.id)
            .map((agent) => {
              const agentColor = resolveTabGroupColor(agent.cwd);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => onSelectAgent(agent)}
                  className="group relative p-0.5 rounded transition-transform hover:scale-115 focus:outline-none"
                  title={`${projectName(agent.cwd)} (${agent.activity})`}
                >
                  <ProjectMascot
                    project={agent.cwd}
                    active={!agent.done}
                    color={agentColor}
                    className="size-3.5 opacity-80 group-hover:opacity-100"
                  />
                  {agent.needsApproval && (
                    <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-400 animate-pulse" />
                  )}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
